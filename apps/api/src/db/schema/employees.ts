/**
 * `employees`：員工個人主檔（資料字典 `02-employee-payroll-cost.md` 第 12–46 行）。
 *
 * **設計理由（照抄字典）：** 員工主檔只保存公司內的人員身分與個資，任職、部門、職稱、職務及薪資
 * 另行管理，避免會變動的雇用狀態覆蓋固定身分資料，也讓離職後回任仍沿用同一人員。
 * 因此本表**明確不含** `status`、`hire_date`、`leave_date`。
 *
 * 與資料字典不同的每一處都寫在對應欄位或索引的註解上，並附上為什麼。
 *
 * ## 敏感欄位改回明文（架構變更，過渡狀態，尚未 drop 舊欄位）
 *
 * 應用層欄位加密（AES-256-GCM）已移除，敏感個資改存明文，改由資料庫端靜態加密負責
 * （代價與現況見 `docs/dev-standards-backend.md` §5.1）。**這一輪只做「可回頭」的那一半**：
 *
 * - 新增五個明文欄位（`identity_number`／`birthday`／`phone`／`email`／`address`），
 *   程式碼一律讀寫這幾欄。
 * - 舊的 `*_encrypted`／`identity_number_hash` 欄位**原封不動保留**，只是從 `NOT NULL`
 *   改成可為 `NULL`——新寫入的列不再產生密文，這幾欄對新資料而言就是「沒有值」。
 *   舊資料的密文照舊留著，供回填腳本（`apps/api/scripts/backfill-plaintext.ts`）解密比對，
 *   也保留「回填算錯了還能拿舊密文重新核對」這條退路。
 * - 唯一鍵的角色由 `identity_number_hash` 交棒給明文 `identity_number`（見下方
 *   `uq_employees_company_identity_plain`）；舊的 `uq_employees_company_identity` 不動，
 *   對尚未回填（`identity_number` 為 `NULL`）的舊列仍然有效——MariaDB 的 `NULL` 在唯一索引
 *   裡互不相等，回填前的新舊列不會互相卡住。
 * - **下一輪**確認回填無誤後，才會真的 `DROP` 這幾個舊欄位與舊的唯一鍵——這一輪刻意不做，
 *   萬一回填有遺漏，舊密文還在就還能救。
 */
import { Buffer } from 'node:buffer'
import {
  bigint,
  char,
  customType,
  date,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { BLIND_INDEX_BYTE_LENGTH, ENCRYPTED_OVERHEAD_MAX_BYTES } from '../field-encryption.ts'
import { companies } from './companies.ts'

/**
 * 二進位欄位的自訂型別。
 *
 * **不能用 drizzle 內建的 `binary()`／`varbinary()`**：那兩個的 TypeScript 型別是 `string`，
 * 而它們的 `mapFromDriverValue` 對驅動回傳的 Buffer 做的是 `value.toString()`
 * ——預設以 UTF-8 解碼。加密後的位元組**不是合法的 UTF-8**，這一步會把不合法的序列
 * 靜靜換成 U+FFFD，於是寫進去的密文與讀回來的位元組不同，解密必定失敗，
 * 而失敗會發生在讀取的那一刻、離成因很遠的地方。自訂型別讓 Buffer 原樣進出，沒有這一層轉換。
 *
 * `data` 與 `driverData` 都是 `Buffer`：mysql2 對 `BINARY`／`VARBINARY` 回傳的就是 Buffer，
 * 寫入時也接受 Buffer，因此不需要任何 `mapTo`／`mapFrom`——沒有轉換就沒有轉換寫錯的可能。
 */
const encryptedBytes = customType<{
  data: Buffer
  driverData: Buffer
  config: { length: number }
  configRequired: true
}>({
  dataType: (config) => `varbinary(${config.length})`,
})

/** 固定長度的二進位欄位（blind index 用）。理由同 {@link encryptedBytes}。 */
const fixedBytes = customType<{
  data: Buffer
  driverData: Buffer
  config: { length: number }
  configRequired: true
}>({
  dataType: (config) => `binary(${config.length})`,
})

/**
 * 性別代碼。
 *
 * **不用 DB ENUM**（通用規範 §1.4、比照 `CompanyType`）：MariaDB 改 ENUM 要 `ALTER TABLE` 重建，
 * 在大表上是鎖表操作；代碼值的唯一來源是這個 const object，DB 端只存字串，
 * 應用層以聯集字面值驗證（§2：固定代碼欄位必須用聯集字面值，不可只寫 `t.String()`）。
 *
 * **誠實註明：資料字典只寫「性別代碼」，沒有列舉值，這兩個值是本次自行決定的。**
 * 只列 `MALE`／`FEMALE`，是因為員工個資的下游用途是勞保、健保與勞退申報，
 * 那些主管機關的格式只接受二分；先放一個 `OTHER` 進來，會讓申報時無值可對應，
 * 而那時候資料已經存在了、改不掉。
 * 逃生出口是「不用 DB ENUM」本身：業務端定案要新增代碼時，改本檔一行即可，**不需要 DDL**。
 */
export const Gender = {
  Male: 'MALE',
  Female: 'FEMALE',
} as const

export type GenderValue = (typeof Gender)[keyof typeof Gender]

/**
 * 加密欄位的寬度 ＝ 明文最大 UTF-8 位元組數 ＋ {@link ENCRYPTED_OVERHEAD_MAX_BYTES}（62）。
 *
 * 逐欄算出來而不是「一律開 1024」：`VARBINARY` 雖然只佔實際長度，但**索引與暫存表用的是宣告寬度**，
 * 而且一個算得出來的數字讓「明文上限改了要不要同步改欄位」變成一個看得見的問題。
 * 明文上限來自 `employees-main.routes.ts` 的 schema，兩邊必須一起改。
 */
const encryptedWidth = (maxPlaintextBytes: number): number => maxPlaintextBytes + ENCRYPTED_OVERHEAD_MAX_BYTES

/** 中文一字最多 3 個 UTF-8 位元組；emoji 等增補平面字元 4 個。地址與姓名一律以 4 估算，寧可寬一點。 */
const BYTES_PER_CHARACTER = 4

export const employees = mysqlTable(
  'employees',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** FK → `companies.id`（見下方 `fk_employees_company`）。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    /** 公司內員工編號；可修改，但不得與同公司其他員工重複（見 `uq_employees_company_code`）。 */
    employeeCode: varchar('employee_code', { length: 64 }).notNull(),
    /** 顯示名稱。與 `employee_code` 同為 `keyword` 可比對的兩個欄位——其餘欄位都加密了，LIKE 不了。 */
    name: varchar('name', { length: 128 }).notNull(),
    gender: varchar('gender', { length: 32 }).$type<GenderValue>().notNull(),
    /**
     * 身分證加密值（**舊欄位，過渡狀態**，見檔頭「敏感欄位改回明文」）。
     *
     * 改成 `nullable`：新寫入的列不再產生密文，這一欄只有回填前建立的舊資料才有值。
     * 舊資料的值保留給回填腳本核對，**下一輪**確認回填無誤後才會真的 `DROP` 這一欄。
     */
    identityNumberEncrypted: encryptedBytes('identity_number_encrypted', { length: encryptedWidth(32) }),
    /**
     * 身分證查詢 Hash（**舊欄位，過渡狀態**）。唯一鍵的角色已由明文 `identity_number` 接手
     * （見下方 `uq_employees_company_identity_plain`），這一欄與它建立的舊唯一鍵原封不動保留，
     * 只是不再對新資料寫入新值。
     */
    identityNumberHash: fixedBytes('identity_number_hash', { length: BLIND_INDEX_BYTE_LENGTH }),
    /** 出生年月日加密值（**舊欄位，過渡狀態**）。明文是 `YYYY-MM-DD`（10 位元組）。 */
    birthdayEncrypted: encryptedBytes('birthday_encrypted', { length: encryptedWidth(16) }),
    /** 電話加密值（**舊欄位，過渡狀態**）。明文上限 32 碼（含分機與國碼寫法）。 */
    phoneEncrypted: encryptedBytes('phone_encrypted', { length: encryptedWidth(32) }),
    /** Email 加密值（**舊欄位，過渡狀態**）。字典標為選填，因此本來就是 nullable。 */
    emailEncrypted: encryptedBytes('email_encrypted', { length: encryptedWidth(254) }),
    /** 地址加密值（**舊欄位，過渡狀態**）。明文上限 255 個字元，以每字元 4 位元組估算。 */
    addressEncrypted: encryptedBytes('address_encrypted', {
      length: encryptedWidth(255 * BYTES_PER_CHARACTER),
    }),
    /**
     * 身分證字號，明文（新欄位，取代 `identityNumberEncrypted`／`identityNumberHash`）。
     *
     * 長度 10：與舊欄位規劃的明文上限相同（見 routes 的 `IdentityNumber` 樣式，涵蓋國民身分證、
     * 新舊式居留證統一證號，三種格式都是 10 碼 ASCII）——不需要加密欄位那種「明文位元組數 ＋
     * 額外開銷」的估算，plain `varchar` 的長度就是字元數上限本身。
     *
     * **暫時 nullable**：既有資料要靠回填腳本補上，回填完成、下一輪拿掉舊欄位時才會一併轉
     * `NOT NULL`（本表已有既有資料，直接宣告 `NOT NULL` 又沒有 `DEFAULT` 會讓這次 migration
     * 當場失敗，見 `docs/dev-standards-backend.md` §4.1 的「地雷組合」）。
     */
    identityNumber: varchar('identity_number', { length: 10 }),
    /**
     * 出生年月日，明文，`YYYY-MM-DD`（新欄位，取代 `birthdayEncrypted`）。
     *
     * 用 `date`（`mode: 'string'`）而不是 `varchar`：這是行事曆日期不是時間戳，其餘同性質欄位
     * （如 `employee_dependents.effective_date`）也是這樣宣告。暫時 nullable，理由同
     * `identityNumber`。
     */
    birthday: date('birthday', { mode: 'string' }),
    /**
     * 電話，明文（新欄位，取代 `phoneEncrypted`）。長度 32：與舊欄位規劃的明文上限相同
     * （見 routes 的 `Phone`，含國碼、分機、市話寫法）。暫時 nullable，理由同 `identityNumber`。
     */
    phone: varchar('phone', { length: 32 }),
    /**
     * Email，明文（新欄位，取代 `emailEncrypted`）。長度 254：RFC 5321 的位址長度上限，
     * 與舊欄位規劃的明文上限相同。字典標為選填，因此本來就是 `nullable`，與其餘四欄
     * 「暫時 nullable、之後會轉 NOT NULL」的過渡狀態不同——這一欄的 nullable 是永久的業務語意。
     */
    email: varchar('email', { length: 254 }),
    /**
     * 地址，明文（新欄位，取代 `addressEncrypted`）。長度 255：與舊欄位規劃的明文字元數上限
     * 相同（見 routes 的 `Address`）——plain `varchar` 的長度單位是字元數，不必再乘以
     * `BYTES_PER_CHARACTER` 那種位元組估算，那是加密欄位（`VARBINARY`）才需要的換算。
     * 暫時 nullable，理由同 `identityNumber`。
     */
    address: varchar('address', { length: 255 }),
    // datetime 一律 mode: 'string'，存的就是台北牆鐘時間，不做任何換算（§6）。
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /**
     * **與資料字典不同：新增欄位。** 軟刪除與唯一鍵的衝突（§4.3，已定案）。
     *
     * 字典的約束是 `UNIQUE(company_id, employee_code)`，而本表同時有 `deleted_at` 軟刪除。
     * 直覺的作法 `UNIQUE(company_id, employee_code, deleted_at)` 在 MariaDB 完全無效——
     * UNIQUE 索引中 `NULL` 互不相等，所有未刪除的員工 `deleted_at` 都是 NULL，
     * 於是它們彼此不衝突，同一個員工編號可以重複建立好幾筆，而約束看起來是有設的。
     * 改成 `NOT NULL DEFAULT 0` 的 `deleted_seq`（軟刪除時一併寫入非零值，例如刪除時間戳），
     * 有效資料就全部落在 `deleted_seq = 0` 這一組內，唯一性才真的成立。
     *
     * 另外兩條路都不可行：沿用單純的 `UNIQUE(company_id, employee_code)` 會讓離職刪除過的
     * 員工編號永遠不能再用；把唯一性交給應用層檢查則在併發下必然失守
     * ——兩個請求同時查到「沒有」然後都寫進去（§4.3）。
     */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    /**
     * **與資料字典不同：多一個 `deleted_seq` 欄位。** 字典寫 `UNIQUE(company_id, employee_code)`，
     * 這是它在軟刪除下的正確形式，理由見 `deletedSeq` 的說明（§4.3）。
     */
    uniqueIndex('uq_employees_company_code').on(table.companyId, table.employeeCode, table.deletedSeq),
    /**
     * **舊唯一鍵，過渡狀態，原封不動保留**（見檔頭「敏感欄位改回明文」）。字典沒有規定身分證
     * 唯一，但同一家公司不可能有兩位員工是同一個人——沒有這條約束時，重複建立只能靠應用層
     * 「先查再寫」擋，而那在併發下必然失守（§4.3）。
     *
     * 這一鍵原本建在 `identity_number_hash`（blind index）而不是加密值上：加密值每次的 IV
     * 都不同，同一個身分證寫兩次會得到兩串不同的位元組，唯一鍵一次也擋不到。**現在唯一鍵的
     * 角色已由下方 `uq_employees_company_identity_plain` 接手**——新寫入的列 `identity_number_hash`
     * 是 `NULL`，這條舊鍵對它們不生效（MariaDB 的 `NULL` 互不相等），只對回填前的舊資料仍然
     * 有效。下一輪 drop 舊欄位時這條鍵會一併移除。
     */
    uniqueIndex('uq_employees_company_identity').on(table.companyId, table.identityNumberHash, table.deletedSeq),
    /**
     * **新唯一鍵，接手 `uq_employees_company_identity` 的角色**（見檔頭「敏感欄位改回明文」）。
     * 明文 `identity_number` 不再有 blind index 那個問題——它本身就是可以直接比對的值，唯一鍵
     * 直接建在明文欄位上即可。
     *
     * 帶 `deleted_seq` 的理由與舊鍵、與員工編號那條相同：離職刪除後，同一個人再入職要能重新
     * 建立。回填前 `identity_number` 是 `NULL`，這條鍵對舊資料不生效（互不相等），
     * 因此與上面那條舊鍵在回填完成前不會互相干擾；回填完成後兩條鍵會同時約束同一批資料，
     * 直到下一輪拿掉舊鍵為止。
     */
    uniqueIndex('uq_employees_company_identity_plain').on(table.companyId, table.identityNumber, table.deletedSeq),
    /**
     * **與資料字典不同：新增唯一鍵。** 比照 `roles.uq_roles_company_id`，供日後其他表
     * （`employee_employments`、`company_users.employee_id` 等）建立複合外鍵
     * `(company_id, employee_id) → employees(company_id, id)` 指向。
     *
     * MariaDB 的外鍵必須指向被參照端的唯一索引，而 `employees` 原本只有 `id` 是唯一的
     * ——只指向 `id` 的話，「這筆任職紀錄的 company_id 與員工的 company_id 一致」就沒有任何約束擋著，
     * 只能靠應用層記得比對，而漏掉一次就是跨公司關聯，且查詢有回資料、不會觸發任何錯誤。
     */
    uniqueIndex('uq_employees_company_id').on(table.companyId, table.id),
    /**
     * 員工清單的預設查詢：公司範圍 ＋ 排除已刪除 ＋ 依姓名排序或以姓名比對關鍵字。
     * 以 `company_id` 開頭（§4.5）；`deleted_seq` 排第二是因為 §4.3 要求每一次查詢都帶它，
     * 那個條件若不在索引裡，篩出來的列還要逐列回表判斷。
     */
    index('ix_employees_company_name').on(table.companyId, table.deletedSeq, table.name),
    foreignKey({ name: 'fk_employees_company', columns: [table.companyId], foreignColumns: [companies.id] }),
  ],
)
