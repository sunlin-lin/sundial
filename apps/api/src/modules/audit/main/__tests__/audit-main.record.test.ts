/**
 * `recordAudit` 的寫入行為測試（§7.1、計畫 §7 Stage 1）。
 *
 * **這一支非連資料庫不可**：要驗的正是「稽核與業務同生共死」（計畫 §5），
 * 而交易的回滾語意沒有任何替身測得出來——用假的 runner 去測，測到的只有那個假 runner
 * 記得幾次呼叫，交易根本沒有參與（§7.3：禁止 mock 掉被測邏輯本身）。
 *
 * **從模組入口打進去，不碰 `impl/`**（§0.4）：`impl/` 底下的檔案只能被同一次目錄的入口檔 import，
 * 測試也不例外。
 *
 * 沒有端點測試：本輪不開任何端點（計畫 §6、§8），沒有 routes 與 handler 可以打。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司，彼此看不到對方的稽核紀錄，
 * 因此不需要 truncate，也不會產生「只在特定執行順序下失敗」的測試。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { AuditActorType, auditLogs, companies, companyUsers, users } from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { buildAuditChanges, recordAudit } from '../audit-main.service.ts'

/**
 * 直接讀環境變數組出資料庫設定，不走 `shared/config.ts`。
 *
 * `loadConfig()` 會一併要求 `ACCESS_TOKEN_SECRET`／`PORT` 這些與本測試完全無關的變數，
 * 少一個就會讓整批測試以一個看不出成因的訊息失敗。連的是不是測試資料庫由 `test-setup.ts`
 * 的 preload 守衛（§7.4），這裡不重複那道檢查。
 */
const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

let database: Database

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
})

/** 建立一家公司與一位成員，供外鍵指向。 */
const registerCompany = async (): Promise<{ companyId: string; companyUserId: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const now = clock.now()

  // §7.3 的例外：`companies`、`users` 與 `company_users` 目前**沒有任何正式流程**可以建立
  //（那幾個模組尚未落地），只能直接寫入。註明理由是規範的要求，不是慣例。
  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `測試公司-${companyId.slice(0, 8)}`,
    shortName: null,
    registeredPostalCode: null,
    registeredCity: null,
    registeredDistrict: null,
    registeredAddress: null,
    actualPostalCode: null,
    actualCity: null,
    actualDistrict: null,
    actualAddress: null,
    invoicePostalCode: null,
    invoiceCity: null,
    invoiceDistrict: null,
    invoiceAddress: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })
  await database.insert(users).values({
    id: userId,
    username: `audit-${userId}`,
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  await database.insert(companyUsers).values({
    id: companyUserId,
    companyId,
    userId,
    employeeId: null,
    status: 'ACTIVE',
    activatedAt: now,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  return { companyId, companyUserId }
}

/** 顯式列出欄位而不是 `select()` 全撈（§2）：測試要斷言什麼，這一行就先講清楚。 */
const readAuditLogs = (companyId: string) =>
  database
    .select({
      actorTypeCode: auditLogs.actorTypeCode,
      actorCompanyUserId: auditLogs.actorCompanyUserId,
      action: auditLogs.action,
      subjectTable: auditLogs.subjectTable,
      subjectId: auditLogs.subjectId,
      changes: auditLogs.changes,
      effectiveDate: auditLogs.effectiveDate,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.companyId, companyId))

/**
 * `changes` 讀回來的正規化。
 *
 * MariaDB 的 `JSON` 實際上是帶 check constraint 的 `LONGTEXT`，因此驅動回傳的是字串；
 * 而 drizzle 的 mysql `json` 欄位只在寫入方向做序列化，讀取方向不還原。
 * 兩種形狀都收，測試才不會在「哪一天驅動開始幫忙 parse」時莫名其妙變紅——
 * 那是資料庫與驅動的事，不是本模組的行為。
 */
const parseChanges = (raw: unknown): unknown => (typeof raw === 'string' ? JSON.parse(raw) : raw)

/**
 * 跑一個注定失敗的交易，回傳它拋出的錯誤。
 *
 * **刻意用 try／catch 而不是 `expect(...).rejects`**：在 bun 1.3.5 上，
 * 「交易內做過 INSERT、之後才拋例外」的那個 promise 交給 `.rejects` 會讓測試卡住直到逾時。
 * 這與本模組無關——換成裸 drizzle 的 insert 一樣會卡，而同一段程式碼用 try／catch 就正常。
 * 寫在這裡是為了讓下一個人不必再花一次時間去二分它，也不要「順手改回 `.rejects`」。
 *
 * 回傳錯誤而不是在裡面斷言：呼叫端要驗的錯誤各不相同（一個驗是不是同一個物件、
 * 一個驗訊息裡有哪個欄位名），而「有沒有失敗」這件事在這裡就先擋掉了——
 * 交易若意外成功，這支會拋出，不會讓後面那條「查不到紀錄」的斷言變成一條假的綠燈。
 */
const runFailingTransaction = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('這個交易應該要失敗才對，實際上成功了')
}

const employeeProfile = {
  employeeCode: 'E001',
  name: '王小明',
  gender: 'MALE',
  identityNumber: 'A123456789',
  birthday: '1990-05-21',
  phone: '0912345678',
  email: 'someone@example.com',
  address: '台北市信義區信義路五段7號',
}

describe('recordAudit 與呼叫端的交易同生共死（計畫 §5）', () => {
  test('交易 rollback 時不留紀錄', async () => {
    const { companyId, companyUserId } = await registerCompany()
    const subjectId = crypto.randomUUID()
    const failure = new Error('業務寫入失敗，整個交易必須回滾')

    // 由呼叫端開交易、由呼叫端決定失敗——這正是正式流程的形狀：
    // 業務 service 開交易，稽核只是交易裡的其中一次寫入。
    const thrown = await runFailingTransaction(() =>
      database.transaction(async (tx) => {
        await recordAudit(tx, {
          companyId,
          actor: { type: 'company-user', companyUserId },
          action: 'employees.main.update',
          subjectTable: 'employees',
          subjectId,
          changes: buildAuditChanges('employees', employeeProfile, { ...employeeProfile, employeeCode: 'E002' }),
          effectiveDate: null,
          now: clock.now(),
        })
        throw failure
      }),
    )

    // 斷言拋出來的就是業務那顆例外：如果稽核寫入自己先炸了（例如政策或欄位對不上），
    // 這條測試會變成「因為別的原因所以沒有紀錄」，而它看起來一樣是綠的。
    expect(thrown).toBe(failure)

    // 稽核若自己另開連線，這裡會查到一筆——那就是一筆「稽核說改過、資料實際沒改」的幽靈紀錄，
    // 而查稽核的人沒有任何辦法分辨它是真的還是幽靈。
    expect(await readAuditLogs(companyId)).toHaveLength(0)
  })

  test('交易 commit 後紀錄在，且欄位逐項正確', async () => {
    // 這一條是上一條的必要配對：沒有它的話，「rollback 後查不到」也可能是因為
    // `recordAudit` 根本沒寫進去——兩條測試會同時是綠的，而稽核完全沒有在運作。
    const { companyId, companyUserId } = await registerCompany()
    const subjectId = crypto.randomUUID()

    await database.transaction(async (tx) => {
      await recordAudit(tx, {
        companyId,
        actor: { type: 'company-user', companyUserId },
        action: 'employees.main.update',
        subjectTable: 'employees',
        subjectId,
        changes: buildAuditChanges('employees', employeeProfile, {
          ...employeeProfile,
          employeeCode: 'E002',
          identityNumber: 'B234567890',
        }),
        effectiveDate: null,
        now: clock.now(),
      })
    })

    const rows = await readAuditLogs(companyId)
    expect(rows).toHaveLength(1)

    const row = rows[0]
    expect(row?.actorTypeCode).toBe(AuditActorType.CompanyUser)
    expect(row?.actorCompanyUserId).toBe(companyUserId)
    expect(row?.action).toBe('employees.main.update')
    expect(row?.subjectTable).toBe('employees')
    expect(row?.subjectId).toBe(subjectId)
    expect(row?.effectiveDate).toBeNull()
    // 操作時間就是呼叫端注入的那一個「現在」，不是稽核自己再取一次（計畫 §3.3、§6.2）。
    expect(row?.createdAt).toBe(clock.now())
    // 身分證只留 `changed: true`，號碼**不在**稽核裡——這是逐欄政策在真正的寫入路徑上的驗證，
    // 不只是純函式的回傳值。
    expect(parseChanges(row?.changes)).toEqual([
      { field: 'employeeCode', before: 'E001', after: 'E002' },
      { field: 'identityNumber', changed: true },
    ])
    expect(JSON.stringify(row?.changes)).not.toContain('B234567890')
  })

  test('系統事件（無操作者）寫成 actor_type_code=2 且成員欄位為 NULL', async () => {
    // 沒有人可以負責的事件（排程、憑證重用偵測）必須與「某個人做的」分得出來：
    // 塞一個假的成員 ID 會讓稽核指向一個根本不在場的操作者。
    const { companyId } = await registerCompany()

    await database.transaction(async (tx) => {
      await recordAudit(tx, {
        companyId,
        actor: { type: 'system' },
        action: 'sessions.main.refresh-token-reuse',
        subjectTable: 'employees',
        subjectId: crypto.randomUUID(),
        changes: [],
        effectiveDate: null,
        now: clock.now(),
      })
    })

    const rows = await readAuditLogs(companyId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.actorTypeCode).toBe(AuditActorType.System)
    expect(rows[0]?.actorCompanyUserId).toBeNull()
  })

  test('未分類的欄位讓整個交易失敗，而不是寫進一筆少一欄的紀錄', async () => {
    const { companyId, companyUserId } = await registerCompany()

    const thrown = await runFailingTransaction(() =>
      database.transaction(async (tx) => {
        await recordAudit(tx, {
          companyId,
          actor: { type: 'company-user', companyUserId },
          action: 'employees.main.update',
          subjectTable: 'employees',
          subjectId: crypto.randomUUID(),
          // 政策未分類 → 拋例外（系統錯誤）。這裡刻意在交易**內**才算 changes，
          // 為的是驗「政策違規不會留下半筆紀錄」，而不只是「純函式會拋」。
          changes: buildAuditChanges('employees', employeeProfile, {
            ...employeeProfile,
            passportNumber: 'X1234567',
          }),
          effectiveDate: null,
          now: clock.now(),
        })
      }),
    )

    expect(String(thrown)).toContain('passportNumber')
    expect(await readAuditLogs(companyId)).toHaveLength(0)
  })
})
