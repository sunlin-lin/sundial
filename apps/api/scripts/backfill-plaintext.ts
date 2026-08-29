/**
 * 回填腳本：把 `employees`／`employee_dependents` 舊的加密欄位解密，寫進新的明文欄位。
 *
 * **為什麼是腳本，不是 migration。** 解密需要應用程式的 `FieldCipher` 與金鑰環
 * （`db/field-encryption.ts`），而 migration 由 drizzle-kit CLI 執行——那支 CLI 只認得
 * schema 定義與 SQL，完全不會、也不該載入應用程式的加解密邏輯與金鑰材料。
 *
 * **這一輪的定位：只做「可回頭」的那一半。** 舊的 `*_encrypted`／`*_hash` 欄位這一輪原封不動
 * 保留（見 `db/schema/employees.ts`／`db/schema/employee-dependents.ts` 檔頭），本腳本只新增
 * 資料、不刪除任何東西——即使回填算錯了，舊密文還在，永遠可以重新核對、重新回填。
 * 下一輪確認回填無誤之後，才會有另一個變更把舊欄位真的 `DROP` 掉。
 *
 * ## 可重複執行
 *
 * 每一批只挑 `identity_number`（明文欄位）仍是 `NULL` 的列——也就是「還沒回填過」的列。
 * 已經成功回填的列，`identity_number` 不再是 `NULL`，之後重跑就不會再選中它，因此重跑是
 * 安全的：全部回填完的表，重跑一次會是「處理 0 列」，不會重複寫入也不會報錯。
 *
 * ## 逐批處理，且用 keyset（seek）分頁，不是 `OFFSET`
 *
 * 每批固定筆數（見 {@link BATCH_SIZE}），撈完立刻處理、立刻寫回，不會把整張表一次撈進記憶體。
 * **刻意不用 `OFFSET` 分頁**：這支腳本會在處理過程中把「符合 `identity_number IS NULL`」的列
 * 一批批變成「不符合」，如果還用 `OFFSET` 累加，下一批的 `OFFSET` 會把「因為上一批處理完而從
 * 結果集裡消失的列」對應的位置空出來，後面排隊的列被往前遞補，`OFFSET` 却還是照原訂位置往後跳
 * ——會有一整批列被跳過、永遠不會被處理到，而且不會有任何錯誤訊息。正確作法是 keyset 分頁：
 * 每批記住這一批最後一筆的 `id`，下一批用 `id > 上一批最後的 id` 接著查，不管上一批的列是否
 * 已經離開篩選結果，下一批的起點都精準接在後面，不會漏、也不會重複。
 *
 * ## 解密失敗的處置
 *
 * 單一列解密失敗時，**不會**讓整支腳本立刻中止、也**不會**把它當成處理過（更新一個空值或跳過
 * 不記錄）——那樣做的後果，要嘛是一筆壞資料擋住其餘幾千筆健康資料的回填，要嘛是得到一張「看起來
 * 全部處理完、實際上偷偷少了幾筆」的表（後者正是本輪計畫書明文警告要避免的事）。實際作法：
 *
 * 1. 失敗的那一列**整列不寫入**（不寫入部分欄位、也不寫入預設值），並記下表名、id、是哪一欄
 *    解密失敗、原始錯誤訊息；
 * 2. **繼續處理同一批與後續批次的其餘列**——keyset 分頁的游標仍然照常往前推進（見上一節），
 *    失敗的列不會讓分頁卡住、也不會被重複挑到；
 * 3. **整支腳本跑完後，只要曾經有任何一列失敗，就以非 0 結束碼中止**（`process.exitCode = 1`），
 *    並把每一筆失敗列的識別碼與原因完整印出來。失敗的列因為 `identity_number` 沒有被寫入，
 *    仍然是 `NULL`——重新排除問題（例如金鑰環少了一把舊金鑰）之後，重跑本腳本會自動再選到它。
 *
 * 執行方式：`bun run --filter @sundial/api backfill:plaintext`（根目錄），
 * 或 `cd apps/api && bun --env-file=../../.env run scripts/backfill-plaintext.ts`。
 */
import { and, asc, eq, gt, isNull, type SQL } from 'drizzle-orm'
import { createDatabase, type Database } from '../src/db/client.ts'
import {
  assertFieldEncryptionKeys,
  createFieldCipher,
  createKeyRing,
  type FieldCipher,
} from '../src/db/field-encryption.ts'
import { employeeDependents, employees } from '../src/db/schema/index.ts'
import { normalizeIdentityNumber } from '../src/shared/identity-normalization.ts'

/** 每批處理的列數。不必調大：批次大小只影響往返次數，不影響最終會不會處理完。 */
const BATCH_SIZE = 200

/** 一筆解密失敗的紀錄。 */
type BackfillFailure = {
  readonly table: string
  readonly id: string
  readonly field: string
  readonly message: string
}

const requireEnv = (key: string): string => {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(`環境變數 ${key} 未設定，回填腳本無法建立欄位加解密器`)
  }
  return value
}

/**
 * 建立欄位加解密器。**只讀回填會用到的三個金鑰環變數**，不像 `shared/config.ts` 的
 * `loadConfig()` 那樣要求整份 `AppConfig`（access token 密鑰、session 壽命……）齊全
 * ——那些與回填無關，本腳本不該因為它們沒設而連不起來。
 */
const buildCipher = (): FieldCipher => {
  const material = {
    keys: requireEnv('FIELD_ENCRYPTION_KEYS'),
    activeKeyId: requireEnv('FIELD_ENCRYPTION_ACTIVE_KEY_ID'),
    blindIndexKey: requireEnv('FIELD_BLIND_INDEX_KEY'),
  }
  // 與 `index.ts` 同一個順序：先自檢、再建金鑰環——金鑰壞掉時炸出來的才是這句寫得清楚的訊息，
  // 不是 `createKeyRing` 內部的解碼錯誤。
  assertFieldEncryptionKeys(material)
  return createFieldCipher(createKeyRing(material))
}

/**
 * 解密一個欄位；失敗時記錄下來並回傳 `null`，不拋出——拋出會讓同一批裡排在後面的列、
 * 以及後續批次全部沒有機會處理，是本檔案頭「解密失敗的處置」明確要避免的事。
 */
const decryptField = (
  cipher: FieldCipher,
  encrypted: Buffer,
  table: string,
  id: string,
  field: string,
  failures: BackfillFailure[],
): string | null => {
  try {
    return cipher.decrypt(encrypted)
  } catch (error) {
    failures.push({ table, id, field, message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

type EmployeeBackfillRow = {
  readonly id: string
  readonly identityNumberEncrypted: Buffer | null
  readonly birthdayEncrypted: Buffer | null
  readonly phoneEncrypted: Buffer | null
  readonly emailEncrypted: Buffer | null
  readonly addressEncrypted: Buffer | null
}

/**
 * 回填 `employees`。
 *
 * @returns 成功寫入明文欄位的列數（不含失敗的列——失敗的列記在 `failures`，不計入這個數字）。
 */
const backfillEmployees = async (
  database: Database,
  cipher: FieldCipher,
  failures: BackfillFailure[],
): Promise<number> => {
  let processed = 0
  let cursor: string | null = null

  for (;;) {
    const conditions: SQL[] = [isNull(employees.identityNumber)]
    if (cursor !== null) conditions.push(gt(employees.id, cursor))

    const rows: readonly EmployeeBackfillRow[] = await database
      .select({
        id: employees.id,
        identityNumberEncrypted: employees.identityNumberEncrypted,
        birthdayEncrypted: employees.birthdayEncrypted,
        phoneEncrypted: employees.phoneEncrypted,
        emailEncrypted: employees.emailEncrypted,
        addressEncrypted: employees.addressEncrypted,
      })
      .from(employees)
      .where(and(...conditions))
      .orderBy(asc(employees.id))
      .limit(BATCH_SIZE)

    if (rows.length === 0) return processed

    for (const row of rows) {
      // 舊的必要加密欄位本身是 NULL：這一輪之前它們全部是 NOT NULL，只有系統性資料異常
      // 才會走到這裡（例如手動改過資料庫）。記成失敗，交給人工介入，不猜一個值頂替。
      if (
        row.identityNumberEncrypted === null ||
        row.birthdayEncrypted === null ||
        row.phoneEncrypted === null ||
        row.addressEncrypted === null
      ) {
        failures.push({
          table: 'employees',
          id: row.id,
          field: '(identity_number_encrypted / birthday_encrypted / phone_encrypted / address_encrypted)',
          message: '舊的加密欄位本身是 NULL，這一列不像是走過舊寫入路徑的資料，需要人工核對',
        })
        continue
      }

      const identityNumber = decryptField(
        cipher,
        row.identityNumberEncrypted,
        'employees',
        row.id,
        'identityNumber',
        failures,
      )
      const birthday = decryptField(cipher, row.birthdayEncrypted, 'employees', row.id, 'birthday', failures)
      const phone = decryptField(cipher, row.phoneEncrypted, 'employees', row.id, 'phone', failures)
      const email =
        row.emailEncrypted === null
          ? null
          : decryptField(cipher, row.emailEncrypted, 'employees', row.id, 'email', failures)
      const address = decryptField(cipher, row.addressEncrypted, 'employees', row.id, 'address', failures)

      // email 允許是 null（沒填），其餘四欄任一個解密失敗就整列不寫入。
      if (identityNumber === null || birthday === null || phone === null || address === null) continue

      await database
        .update(employees)
        .set({
          // 正規化一次：舊的密文本來就是正規化後的值加密而來，這裡再做一次是防禦性的
          // ——理由與 `domain/employee-secrets.ts` 的 `toStoredColumns` 相同，不假設歷史資料
          // 一定乾淨。
          identityNumber: normalizeIdentityNumber(identityNumber),
          birthday,
          phone,
          email,
          address,
        })
        .where(eq(employees.id, row.id))

      processed += 1
    }

    const lastRow = rows[rows.length - 1]
    if (lastRow !== undefined) cursor = lastRow.id
  }
}

type DependentBackfillRow = {
  readonly id: string
  readonly identityNumberEncrypted: Buffer | null
  readonly birthdayEncrypted: Buffer | null
}

/** 回填 `employee_dependents`。形狀與 {@link backfillEmployees} 同構，欄位少兩個。 */
const backfillDependents = async (
  database: Database,
  cipher: FieldCipher,
  failures: BackfillFailure[],
): Promise<number> => {
  let processed = 0
  let cursor: string | null = null

  for (;;) {
    const conditions: SQL[] = [isNull(employeeDependents.identityNumber)]
    if (cursor !== null) conditions.push(gt(employeeDependents.id, cursor))

    const rows: readonly DependentBackfillRow[] = await database
      .select({
        id: employeeDependents.id,
        identityNumberEncrypted: employeeDependents.identityNumberEncrypted,
        birthdayEncrypted: employeeDependents.birthdayEncrypted,
      })
      .from(employeeDependents)
      .where(and(...conditions))
      .orderBy(asc(employeeDependents.id))
      .limit(BATCH_SIZE)

    if (rows.length === 0) return processed

    for (const row of rows) {
      if (row.identityNumberEncrypted === null || row.birthdayEncrypted === null) {
        failures.push({
          table: 'employee_dependents',
          id: row.id,
          field: '(identity_number_encrypted / birthday_encrypted)',
          message: '舊的加密欄位本身是 NULL，這一列不像是走過舊寫入路徑的資料，需要人工核對',
        })
        continue
      }

      const identityNumber = decryptField(
        cipher,
        row.identityNumberEncrypted,
        'employee_dependents',
        row.id,
        'identityNumber',
        failures,
      )
      const birthday = decryptField(cipher, row.birthdayEncrypted, 'employee_dependents', row.id, 'birthday', failures)

      if (identityNumber === null || birthday === null) continue

      await database
        .update(employeeDependents)
        .set({ identityNumber: normalizeIdentityNumber(identityNumber), birthday })
        .where(eq(employeeDependents.id, row.id))

      processed += 1
    }

    const lastRow = rows[rows.length - 1]
    if (lastRow !== undefined) cursor = lastRow.id
  }
}

const main = async (): Promise<void> => {
  const cipher = buildCipher()
  const database = createDatabase({
    host: process.env['DB_HOST'] ?? '127.0.0.1',
    port: Number(process.env['DB_PORT'] ?? '3306'),
    user: process.env['DB_USER'] ?? '',
    password: process.env['DB_PASSWORD'] ?? '',
    database: process.env['DB_NAME'] ?? '',
  })

  const failures: BackfillFailure[] = []

  const employeesProcessed = await backfillEmployees(database, cipher, failures)
  const dependentsProcessed = await backfillDependents(database, cipher, failures)

  const totalProcessed = employeesProcessed + dependentsProcessed

  process.stdout.write(
    [
      '回填完成：',
      `  employees          處理 ${employeesProcessed} 列`,
      `  employee_dependents 處理 ${dependentsProcessed} 列`,
      `  合計                處理 ${totalProcessed} 列、解密失敗 ${failures.length} 列`,
      '',
    ].join('\n'),
  )

  if (failures.length > 0) {
    process.stderr.write(
      ['以下 ' + String(failures.length) + ' 列解密失敗，未寫入明文欄位，重新排除問題後可以直接重跑本腳本：', ''].join(
        '\n',
      ),
    )
    for (const failure of failures) {
      process.stderr.write(`  [${failure.table}] id=${failure.id} 欄位=${failure.field}：${failure.message}\n`)
    }
    process.exitCode = 1
    return
  }

  process.exitCode = 0
}

await main()

// 連線池會讓行程繼續掛著（池內連線是 active handle），明確結束才不會讓指令看起來像卡住
// （理由與 `seed-dev.ts` 同構）。用 `process.exitCode` 而不是 `process.exit(n)`：
// 前者讓已排入佇列的 stdout/stderr 寫入先真正落地，後者可能在緩衝區清空前就切斷行程。
process.exit(process.exitCode ?? 0)
