# 資料庫操作參考

適用技術：`drizzle-orm`（`mysql2` 驅動）＋ MariaDB，遷移工具為 `drizzle-kit`。本檔對應
`docs/dev-standards-backend.md` §4，把規則轉成「照著寫」的具體步驟與真實程式碼，「為什麼」只
帶一句並附章節號，完整理由回頭讀規範原文。所有範例都抄自專案現有程式碼，路徑寫在每段開頭。

裸 `db`／`tx`（`drizzle`／`mysql2` 的原始連線或交易物件）只能出現在 `db/client.ts` 內部。
**任何模組的 repository 一律透過 `TenantDatabase`（或收到的 `QueryRunner`/`TransactionRunner`）
存取資料庫**，不得自己組 `WHERE company_id = ...`。這是全篇最高優先的一條，其餘規則是它的延伸。

## 目錄

1. [Migration 流程](#1-migration-流程)
2. [多公司資料隔離（最高優先）](#2-多公司資料隔離最高優先)
3. [軟刪除](#3-軟刪除)
4. [交易邊界](#4-交易邊界)
5. [索引與 N+1](#5-索引與-n1)
6. [禁止 ORM 關聯查詢，一律顯式 select + join](#6-禁止-orm-關聯查詢一律顯式-select--join)
7. [金額與工時的型別](#7-金額與工時的型別)
8. [drizzle 表定義的標準寫法](#8-drizzle-表定義的標準寫法)
9. [檢查清單](#9-檢查清單)

## 1. Migration 流程

規範依據：§4.1。

1. 改 `apps/api/src/db/schema/<表名>.ts`（新表另建檔案，並在 `db/schema/index.ts` 補匯出；帶
   公司範圍的表要補進該檔的 `CompanyScopedTable` 聯集與 `companyScopedTablesInDeleteOrder`，見 §2）。
2. 產生 migration：

   ```bash
   cd apps/api
   bun run db:generate   # 執行 drizzle-kit generate，設定見 drizzle.config.ts
   ```

   `apps/api/drizzle.config.ts` 用 `requireEnv` 逼 `DB_HOST`／`DB_PORT`／`DB_USER`／`DB_PASSWORD`／
   `DB_NAME` 全部必填，缺一個就在設定檔**載入階段**直接丟錯——即使 `generate` 本身不需要連上
   資料庫也一樣。第一次執行卡在一句看似與這次任務無關的「環境變數未設定」訊息時，先確認
   `.env` 存在，不是指令本身壞了。

   會在 `apps/api/drizzle/` 產出 `NNNN_<描述>.sql`，並同步更新
   `apps/api/drizzle/meta/_journal.json` 與 `apps/api/drizzle/meta/NNNN_snapshot.json`：

   - `_journal.json` 的 `entries` 每筆四個欄位：`idx`（嚴格等於陣列位置，從 0 起不跳號）、
     `tag`（等於這支 `.sql` 檔名去掉副檔名）、`when`（產生時間戳，毫秒）、`breakpoints`。
   - **`NNNN_snapshot.json` 是整個資料庫當下的全量快照，不是這次改動的差異**——它記錄這一版
     全部的表與全部的欄位，不只是這次新增或修改的那幾個。這是 `db:generate` 自己維護的檔案，
     不要手動編輯它（手寫時最直覺的錯誤就是只寫這次改動的欄位，漏掉其他表——見下方「鐵律」
     為什麼這條路本身就不該走）。
   - snapshot 的 `id`／`prevId` 是一條鏈：本次的 `prevId` 必須等於上一份 snapshot 的 `id`，
     drizzle-kit 靠這條鏈確認「基準版本沒有斷過」，這條鏈同樣由工具自己維護。

3. 檢查產出：新增欄位是允許 NULL、還是帶 `default`——這是兩種不同的因應方式（前者放行「沒填」，
   後者替沒填的列補一個值），不是同一件事可以互換的兩種寫法。真正會炸的地雷組合是**對已有資料
   的表加 `NOT NULL` 又沒有 `default`**：既有資料列沒有值可回填，DDL 直接失敗或鎖表；純新建的
   表不受此限，因為建表當下還沒有既有資料列。另外檢查：帶公司範圍的新表索引是否以 `company_id`
   開頭（§5）。
4. 跑完整性掃描：

   ```bash
   bun run check:migration-journal
   ```

   雙向比對 `drizzle/*.sql` 與 `_journal.json` 的 `entries`，並檢查 `idx` 嚴格遞增、每筆 entry
   是否有對應 `meta/NNNN_snapshot.json`。**這步不可省**：`drizzle-kit migrate` 讀的是
   `_journal.json`，不是資料夾檔案清單——漏補 entry 時 `db:migrate` 照樣印
   `migrations applied successfully`，實際上零個動作、表沒建立，且沒有任何錯誤訊息。

5. 套用：

   ```bash
   bun run db:migrate          # 開發資料庫
   bun run db:migrate:test     # 測試資料庫（多載一份 .env.test）
   ```

鐵律：

- ❌ 禁止手動連線資料庫執行 DDL——手改過的資料庫與 migration 歷史分岔後，新環境建不起來。
- ❌ 禁止修改或刪除已合併進 main 的 migration 檔，修正一律新增新檔（CI 比對既有檔 diff）。
- ✅ 真的需要手寫 SQL 內容（schema 沒有變動，例如純 `INSERT` 的權限碼 seed）時，用
  `bun run db:generate -- --custom` 產生一支空白 migration，**不要自己動 `_journal.json`
  或 `NNNN_snapshot.json`**。`drizzle-kit generate --help` 印出的說明是「Prepare empty
  migration file for custom SQL」——這個旗標讓 drizzle-kit 自己算 journal entry 與
  snapshot（schema 沒變，snapshot 內容照抄前一份，只有 `id`／`prevId` 這條鏈是工具重新算
  出來的），開發者只需要把 SQL 寫進產生出來的 `.sql` 檔。真實先例：
  `apps/api/drizzle/0026_seed_permission_codes_employments_withholding.sql`／
  `0029_seed_permission_codes_job_titles_positions.sql`；比對它們與前一份的
  `meta/NNNN_snapshot.json` 只有 `id`／`prevId` 換新、JSON 鍵序略有差異，表格內容語意相同。
  **手寫 migration 的正確作法不是「手寫並補齊 journal 與 snapshot」，是「用工具產生骨架，
  自己只寫 SQL 內容」。**
  **不要走的路**：直接手寫 `.sql` 再手動編輯兩個 JSON 檔——snapshot 的 `id`／`prevId` 這組
  UUID 鏈手寫時無法正確偽造，而 `check:migration-journal` 只驗證檔名存在（entry 對得上一支
  `.sql`、`idx` 對得上一份 `snapshot.json`），**不驗證 snapshot 內容或這條鏈是否正確**——
  假鏈能通過這支掃描，卻會在下一次真的跑 `db:generate` 時對不上基準，導致後續 migration
  整組重新產生。
- ✅ 每支 migration 必須能在空資料庫從頭跑到尾。

## 2. 多公司資料隔離（最高優先）

規範依據：§4.2。實作：`apps/api/src/db/client.ts`。

### 2.1 封裝在哪裡

`TenantDatabase` 是**唯一**能查詢帶 `company_id` 表的路：建構時綁定 `companyId`，
`select`／`selectDistinct`／`update`／`insert`／`insertMany`／`delete` 每個方法都自動把
`eq(table.companyId, this.#companyId)` 加進 `WHERE`，「不帶公司條件」在型別上寫不出來。

```ts
// apps/api/src/db/client.ts
export class TenantDatabase {
  constructor(runner: QueryRunner, companyId: string) { ... }
  select<TTable extends CompanyScopedTable, TColumns>(columns: TColumns, table: TTable, ...conditions) {
    return this.#runner.select(columns).from(table).where(this.scope(table, ...conditions))
  }
  insert<TTable extends CompanyScopedTable>(table: TTable, buildValues: (companyId: string) => MySqlInsertValue<TTable>) {
    return this.#runner.insert(table).values(buildValues(this.#companyId))
  }
}
```

哪些表可被接受，由 `db/schema/index.ts` 的 `CompanyScopedTable` **列舉**決定（不是「有
`company_id` 欄位」的結構型別判斷）。新增一張帶公司範圍的表，必須手動加進這裡：

```ts
export type CompanyScopedTable = typeof roles | typeof employees | typeof jobTitles | ...
```

全域表（`users`、`permissions`）與公司主檔本身（`companies`）不在此聯集——`companies.id` 就是
公司範圍本身。

### 2.2 單表查詢

```ts
// apps/api/src/modules/employees/main/impl/employees-main.mark-deleted.repository.ts
const tenant = new TenantDatabase(runner, companyId)
await tenant.update(
  employees,
  { deletedAt: deletion.now, deletedSeq: deletion.deletedSeq, updatedAt: deletion.now },
  eq(employees.id, employeeId),
  eq(employees.deletedSeq, 0),
  isNull(employees.deletedAt),
)
```

### 2.3 JOIN 查詢：每張帶公司範圍的表都要帶條件，用 `scopeAll`

```ts
// apps/api/src/modules/company-users/roles/impl/company-users-roles.list-active-assignments.repository.ts
const tenant = new TenantDatabase(runner, companyId)
const rows = await tenant
  .selectFrom({ assignmentId: companyUserRoles.id, roleCode: roles.code, ... }, companyUserRoles)
  .innerJoin(roles, eq(roles.id, companyUserRoles.roleId))
  .where(
    tenant.scopeAll(
      [companyUserRoles, roles],   // join 進來的每張帶公司範圍的表都列進去
      eq(companyUserRoles.companyUserId, companyUserId),
      eq(companyUserRoles.revokedSeq, 0),
      isNull(roles.deletedAt),
    ),
  )
```

`selectFrom` 只做到 `FROM`（drizzle 要求 `JOIN` 接在 `FROM` 與 `WHERE` 之間）；`scopeAll` 對每
張表都補公司條件，呼叫端寫不出「別家公司」這個值，只可能漏列某張表——review 看得見的漏，不是
看不出來的錯值。

```ts
// ✅ 正確
.where(tenant.scopeAll([companyUserRoles, roles], eq(companyUserRoles.companyUserId, id)))
// ❌ 錯誤：手寫公司條件，只顧了其中一張表——roles 完全沒有公司條件，跨公司的角色一樣 join 得上
.where(and(eq(companyUserRoles.companyId, companyId), eq(companyUserRoles.companyUserId, id)))
```

全域表（`users`、`permissions`）join 進來不加公司條件，但要靠「已帶公司條件的表」串接進來（如
靠 `company_users` 間接鎖住），不能是唯一的 join 目標。

### 2.3.1 `scopeAll` 遇到 `LEFT JOIN`：悄悄變成 `INNER JOIN`，沒有工具在擋

`scopeAll` 把傳進去的每一張表的 `company_id` 條件全部塞進同一個 `WHERE`：

```ts
// apps/api/src/db/client.ts
scopeAll(tables: readonly CompanyScopedTable[], ...conditions: readonly (SQL | undefined)[]): SQL | undefined {
  return and(...tables.map((table) => eq(table.companyId, this.#companyId)), ...conditions)
}
```

**這在「JOIN 清單全部是 `INNER JOIN`」時是安全的**：`INNER JOIN` 落空的列本來就不會出現在結果
裡，公司條件放 `WHERE` 或放 `ON` 沒有差別，§2.3 的範例正是這種情況。但只要清單裡有一張是
`LEFT JOIN`，把它的 `company_id` 條件放進 `WHERE` 就會把這個 `LEFT JOIN` 悄悄變成事實上的
`INNER JOIN`：`LEFT JOIN` 沒配到的那一列，該表所有欄位（含 `company_id`）都是 `NULL`，
`NULL = 公司ID` 在 SQL 裡恆為假，`WHERE` 直接把整列濾掉——**不會有任何錯誤，只是那一列從結果
裡消失**。

實際踩過的例子：`attendance/records/list-by-date`（每日全員打卡明細）要 `LEFT JOIN` 部門歷史與
部門——查不到部門歸屬的員工，當天的打卡仍要照樣顯示（`departmentName` 給 `NULL` 即可），不能
因為查無部門就讓這名員工那天的打卡整列從列表消失。若沿用 `selectFrom` + `scopeAll([attendanceRecords,
employees, employeeDepartmentHistories, departments], ...)`，後兩張表的公司條件會被塞進
`WHERE`，查不到部門的那一列就會被靜靜濾掉——症狀是「少了幾列」，不是報錯，很容易被誤判成「這名
員工今天沒打卡」。

正確寫法（實際程式碼）：改用裸 `runner`，`LEFT JOIN` 的公司條件放進該 JOIN 自己的 `ON`，
`WHERE` 只留錨點資料表與業務篩選條件：

```ts
// apps/api/src/modules/attendance/records/impl/attendance-records.list-by-date.repository.ts
const buildDepartmentHistoryJoinCondition = (companyId: string, workDate: string) =>
  and(
    eq(employeeDepartmentHistories.companyId, companyId), // 公司條件放 ON，不是 WHERE
    eq(employeeDepartmentHistories.employmentId, attendanceRecords.employmentId),
    lte(employeeDepartmentHistories.effectiveFrom, workDate),
    or(isNull(employeeDepartmentHistories.effectiveTo), gte(employeeDepartmentHistories.effectiveTo, workDate)),
  )

const rows = await runner
  .select({/* ... */})
  .from(attendanceRecords)
  .innerJoin(
    employees,
    and(eq(employees.id, attendanceRecords.employeeId), eq(employees.companyId, attendanceRecords.companyId)),
  )
  .leftJoin(employeeDepartmentHistories, buildDepartmentHistoryJoinCondition(companyId, query.workDate))
  .leftJoin(
    departments,
    and(eq(departments.id, employeeDepartmentHistories.departmentId), eq(departments.companyId, companyId)),
  )
  .where(conditions) // 只有 attendanceRecords.companyId 與業務篩選條件，見下方
```

```ts
const buildConditions = (companyId: string, query: ListAttendanceRecordsByDateQuery): SQL | undefined =>
  and(
    eq(attendanceRecords.companyId, companyId), // 錨點表的公司條件才放這裡
    eq(attendanceRecords.workDate, query.workDate),
    query.departmentId === null ? undefined : eq(employeeDepartmentHistories.departmentId, query.departmentId),
  )
```

**判準：**

- **JOIN 清單全部是 `INNER JOIN`，或單表查詢** → 用 `TenantDatabase.selectFrom` + `scopeAll`
  （§2.3），公司條件放 `WHERE` 沒有問題。
- **JOIN 清單裡有任何一個 `LEFT JOIN`（或 `RIGHT JOIN`／`FULL JOIN`）** → 不能用 `scopeAll`；
  改用裸 `runner`，公司條件依 JOIN 性質分別擺放：`LEFT JOIN` 的表放進該 JOIN 自己的 `ON`
  （落空的列不該被這個條件濾掉）；`INNER JOIN` 的表（含錨點表）放 `WHERE` 或 `ON` 結果相同，
  上面的例子選擇除了錨點表以外都放 `ON`，只是為了讓「查詢起點」與「JOIN 帶進來的表」在程式碼
  上一眼分清楚，不是規則要求。
- **這個坑沒有任何工具在擋。** `check:layers`、`check:n-plus-one` 都不檢查「`LEFT JOIN` 的公司
  條件放對地方沒有」，寫錯不是編譯錯誤、也不會讓測試變紅——查詢照樣成功執行，只是被誤放進
  `WHERE` 的那幾張表一旦落空，對應的列就從結果裡靜靜消失。被濾掉的資料在資料庫裡好端端存在，
  只是這一次查詢看不到；發現這個坑通常是有人回報「某某人的資料不見了」，而不是任何自動化檢查
  先舉手。

### 2.4 `companyId` 的唯一來源

- 只能來自已驗證的 token／session，禁止取自 request body 或 header。
- access token 的 `companyId` 只能在發證元件寫入，型別上不得為 `null`。
- `companyCode`（使用者鍵入、待驗證）≠ `companyId`（內部識別碼、伺服器推導）：`companyCode`
  只允許出現在登入端點的 body，驗證通過後仍由伺服器從解析結果取 `companyId`。

### 2.5 排除適用範圍：身分解析查詢

登入時用「公司代號 ＋ 帳號」找出 `companyId`，這一步天生沒有 `companyId` 可帶——它是產生那個
條件的地方。三項邊界缺一不算數：條件換成公司代號＋帳號；只能出現在認證模組的
`*.repository.ts`；`select` 出來的欄位只能是公司範圍本身，不得含業務欄位。

```ts
// apps/api/src/modules/sessions/main/impl/sessions-main.resolve-identity.repository.ts
// 全專案唯一一支不帶 company_id 條件的查詢。
const rows = await runner
  .select({
    companyId: companyUsers.companyId,
    userId: users.id,
    companyUserId: companyUsers.id,
    passwordHash: users.passwordHash,
  })
  .from(companyUsers)
  .innerJoin(companies, eq(companies.id, companyUsers.companyId))
  .innerJoin(users, eq(users.id, companyUsers.userId))
  .where(
    and(
      eq(companies.companyCode, companyCode),
      eq(companies.status, CompanyStatus.Active),
      eq(users.username, username),
      eq(companyUsers.status, CompanyUserStatus.Active),
    ),
  )
  .limit(1)
```

新寫一支「先查某欄位再判斷公司」的查詢**不會**自動算身分解析查詢——必須落在認證模組、只吐公司
範圍欄位，否則就是披著身分解析外皮的萬用查詢。

### 2.6 自我參照的父子關聯

`parent_id` 這類自我參照必須驗證雙方同公司，否則跨公司串樹之後統計會把別家公司資料算進去。

## 3. 軟刪除

規範依據：§4.3。

### 3.1 欄位形狀（固定配套）

```ts
// apps/api/src/db/schema/job-titles.ts
deletedAt: datetime('deleted_at', { mode: 'string' }),
deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
```

唯一鍵必須把 `deletedSeq` 併進去：

```ts
uniqueIndex('uq_job_titles_company_code').on(table.companyId, table.code, table.deletedSeq),
```

理由：MariaDB 唯一索引中 `NULL` 互不相等，`UNIQUE(company_id, code, deleted_at)` 會讓未刪除
資料失去唯一性。改用 `deletedSeq NOT NULL DEFAULT 0`，軟刪除時寫入非零值（如時間戳），代碼可
重新使用，且併發下唯一鍵仍有效。

### 3.2 查詢一定要帶的條件

```ts
// apps/api/src/modules/employees/main/impl/employees-main.list.repository.ts
const conditions: (SQL | undefined)[] = [eq(employees.deletedSeq, 0), isNull(employees.deletedAt)]
```

兩個欄位一起比對不是重複：`deleted_seq = 0` 是索引與唯一鍵真正參與的那一個；
`deleted_at IS NULL` 是軟刪除語意的本體，也是掃描腳本檢查的對象。兩者永遠一起寫入、一起清除。

```ts
// ❌ 錯誤：忘記排除已刪除資料，刪除等於從未生效
const rows = await tenant.select({ id: employees.id, name: employees.name }, employees)
```

需要包含已刪除資料時，用明確的 `includeDeleted` 參數並附註解。例外：稽核歷程類 join（如角色
指派紀錄要顯示「當時使用的角色」）刻意不加 `deleted_at IS NULL`，理由要寫在程式碼裡。

### 3.3 禁止實體 DELETE、禁止先查再寫

有歷史意義的資料一律軟刪除／標記撤銷，不得 `DELETE`（純關聯表整組替換例外，仍要走
`TenantDatabase.delete` 封裝）。唯一性檢查禁止「先 `SELECT` 再 `INSERT`」——直接寫入、攔截驅動
的唯一鍵違反，並包進 `try/catch` 轉成 409（`code='300'`）：

```ts
// apps/api/src/db/driver-error.ts —— drizzle-orm 0.44 把 mysql2 錯誤包進 error.cause，
// errno 落在 cause 上，本函式沿 cause 鏈往下找。DUPLICATE_ENTRY_ERRNO = 1062。
export const isUniqueViolation = (error: unknown, indexName: string): boolean => {
  const driverError = findDriverError(error)
  if (driverError?.['errno'] !== DUPLICATE_ENTRY_ERRNO) return false
  const message = driverError['sqlMessage']
  return typeof message !== 'string' || message.includes(indexName)
}

// apps/api/src/modules/employees/main/domain/employee-duplicate.ts
export const classifyEmployeeDuplicate = (error: unknown): EmployeeDuplicateOutcome | null => {
  if (isUniqueViolation(error, EMPLOYEE_CODE_UNIQUE_INDEX)) return 'duplicate-code'
  if (isUniqueViolation(error, EMPLOYEE_IDENTITY_UNIQUE_INDEX)) return 'duplicate-identity-number'
  return null // 認不得的一律原樣重拋（系統錯誤）
}
```

```ts
// ❌ 錯誤：先查後寫，併發下兩個請求會同時通過檢查
const existing = await findByCode(code)
if (existing !== null) return fail('重複')
await insert({ code })
```

## 4. 交易邊界

規範依據：§4.4。實作：`apps/api/src/db/client.ts` 的 `TransactionRunner`。

### 4.1 屬於哪一層

**交易邊界屬於 service 層，repository 不自開交易**——否則多個動作要合併成一筆交易時，巢狀交易
無法變成原子操作。連線池與交易物件滿足同一個 `QueryRunner` 型別，因此同一段 repository 程式碼
在交易內外是同一種寫法。

跨模組編排、會參與呼叫端交易的動作，簽章收更窄的 `TransactionRunner`：

```ts
// apps/api/src/db/client.ts
export type TransactionRunner = QueryRunner & Pick<DbTransaction, 'rollback'>
```

`rollback` 只有交易物件才有，傳裸連線池進來會是**編譯錯誤**，不必靠掃描腳本讀 AST 才能發現。

### 4.2 一次寫多表：唯一開交易的地方在編排入口

真實範例：`apps/api/src/modules/employees/onboarding/`——「一次到職」橫跨員工、任職、部門歸屬、
職稱歷史、職務歷史、扣繳設定、登入帳號、角色指派八張表。

編排入口（`employees-onboarding.service.ts`）是唯一呼叫 `context.db.transaction(...)` 的地方：

```ts
export const createOnboarding = async (context, input) => {
  let failure: ServiceResult<OnboardingResult> | null = null
  try {
    return await context.db.transaction(async (tx) => {
      const result = await createOnboardingInTransactionImpl(tx, context, input)
      if (result.ok) return result
      // drizzle 的 db.transaction(cb) 只依 cb 是否 reject 決定 commit/rollback，
      // 不看回傳值內容——回傳 { ok: false } 一樣會被當成「正常結束」而 COMMIT。
      failure = result
      return tx.rollback() // 型別是 never；丟出 drizzle 的 TransactionRollbackError
    })
  } catch (error) {
    if (failure !== null) return failure
    throw error // 其餘一律是真正的系統錯誤，原樣往上拋
  }
}
```

**這是最容易踩的坑：業務失敗的 `{ ok: false }` 不是例外，`db.transaction()` 只看
`reject`／`resolve`。** 一旦某一步失敗卻只是把結果原樣 `return`，前面已寫入的資料會全部
COMMIT，只有失敗那一步缺席。

被編排的子動作（員工、任職、部門歸屬、職稱、職務、扣繳、帳號、角色共八張表）全部收同一個
`tx: TransactionRunner` 依序呼叫，任一步失敗立刻 `return fail(employeeResult.errors)` 不再往
下（見 `employees-onboarding.create.service.ts`）。每一步各自在自己的實作裡呼叫
`recordAudit(tx, ...)`，編排入口不再呼叫一次；`recordAudit` 的簽章收 `TransactionRunner`，因此
「稽核與業務寫入不同交易」在編譯期就報錯。

### 4.3 條件式 UPDATE：狀態變更禁止先讀再寫

```ts
// ✅ 正確：把「預期的目前狀態」寫進 WHERE，檢查影響列數
const r = await tx
  .update(records)
  .set({ status: NEXT_STATUS })
  .where(and(eq(records.companyId, companyId), eq(records.id, id), eq(records.status, EXPECTED_STATUS)))
if (r.affectedRows === 0) {
  errors.push({ group: ErrorGroup.Conflict, code: '<領域>.state-changed', msg: '資料狀態已變更，請重新載入' })
  return { ok: false, errors }
}

// ❌ 錯誤：先讀再寫，兩人同時操作會讓副作用被套用兩次
const row = await findById(id)
if (row.status === EXPECTED_STATUS) await update(id, { status: NEXT_STATUS })
```

影響列數用 `readAffectedRows`（`db/driver-result.ts`）取，不要猜結果形狀：

```ts
export const readAffectedRows = (result: unknown): number => {
  const header = asRecord(Array.isArray(result) ? result[0] : result)
  const affectedRows = header?.['affectedRows']
  if (typeof affectedRows !== 'number') throw new Error('資料庫驅動未回傳 affectedRows（§4.4）')
  return affectedRows
}
```

取不到必須拋出（系統錯誤）：猜 0 會讓每次正常變更被誤報成衝突，猜 1 會讓真正的併發衝突靜靜通過。

### 4.4 期間重疊的鎖：粒度＝擁有者，用 `SELECT ... FOR UPDATE`

`UNIQUE` 索引只擋「同一天建立兩筆」，擋不住「不同天但期間重疊」，因此寫入前對擁有者上鎖：

```ts
// apps/api/src/modules/employments/main/impl/employments-main.find-employee-for-update.repository.ts
export const findEmployeeForUpdate = async (runner: QueryRunner, companyId: string, employeeId: string) => {
  const rows = await new TenantDatabase(runner, companyId)
    .select(
      { id: employees.id },
      employees,
      eq(employees.id, employeeId),
      eq(employees.deletedSeq, 0),
      isNull(employees.deletedAt),
    )
    .limit(1)
    .for('update')
  return rows[0] ? { id: rows[0].id } : null
}
```

`runner` 必須是交易物件，否則 `FOR UPDATE` 的鎖在語句結束時就釋放。鎖的是「擁有者」
（如 `employees`），不是正在寫入、此刻還不存在那一列的表。

### 4.5 交易內禁止的事

交易期間持有列鎖，一次外部逾時就會連鎖鎖住整張表：**交易內禁止呼叫外部 HTTP、寄信、寫檔或
長時間計算**。

## 5. 索引與 N+1

規範依據：§4.5。

- 每一張帶 `company_id` 的表，索引必須以 `company_id` 開頭：`(company_id, created_at)`、
  `(company_id, status)`。新增列表查詢／篩選條件時同一個 PR 補支撐索引，附 `EXPLAIN` 結果。

  ```ts
  index('ix_job_titles_company_status').on(table.companyId, table.status),
  ```

- 禁止在迴圈中逐筆查詢：

  ```ts
  // ✅ 正確：先蒐集鍵，一次查完再組裝
  const ownerIds = list.map((row) => row.ownerId)
  const owners = await db
    .select()
    .from(ownersTable)
    .where(and(eq(ownersTable.companyId, cid), inArray(ownersTable.id, ownerIds)))
  const ownerById = new Map(owners.map((r) => [r.id, r]))
  for (const row of list) row.owner = ownerById.get(row.ownerId) ?? null

  // ❌ 錯誤：N+1
  for (const row of list) row.owner = await findOwner(row.ownerId)
  ```

  `Promise.all(arr.map(async ...))` 不是解法：仍是 N 次資料庫往返、N 個連線池 slot。症狀從
  「這支端點比較慢」變成「連線池被瞬間佔滿，其他無關端點開始逾時」，且只看得到「連線逾時」：

  ```ts
  // ❌ 錯誤：看起來是平行處理，實際上仍是 N 次往返、N 個連線池 slot
  await Promise.all(
    list.map(async (row) => {
      row.owner = await findOwner(row.ownerId)
    }),
  )
  ```

  `apps/api/scripts/check-n-plus-one.ts` 用 AST 判斷「迴圈體內是否有資料庫呼叫的 `await`」，
  涵蓋 `for`／`.forEach(async ...)`／`.map(async ...)`／遞迴函式。真正需要迴圈（固定次數、與
  資料量無關）時豁免：

  ```ts
  // n-plus-one-ok: 固定對九個資料集各同步一次，次數不隨資料量成長
  for (const dataset of FIXED_NINE_DATASETS) await syncOne(dataset)
  ```

  冒號後面沒有理由的豁免會被當成違規報出來。

## 6. 禁止 ORM 關聯查詢，一律顯式 select + join

規範依據：§4.6。

**禁止使用 Drizzle 的 relational query API（`db.query.*` 搭配 `with`）。** 連線建立時就切斷：

```ts
// apps/api/src/db/client.ts —— 刻意不把 schema 傳給 drizzle()，傳了才會有 db.query.* 這套 API。
export const createDatabase = (config: DatabaseConfig): Database => drizzle(createPool({ ... }))
```

跨表讀取一律顯式 `select` ＋ `join`，同一張表出現兩次時用 `alias`：

```ts
// ✅ 正確：apps/api/src/modules/company-users/roles/impl/company-users-roles.list-page.repository.ts
const assignedByMember = alias(companyUsers, 'assigned_by_member')
const assignedByAccount = alias(users, 'assigned_by_account')

const rows = await runner
  .select({ id: companyUserRoles.id, roleCode: roles.code, assignedByName: assignedByAccount.username })
  .from(companyUserRoles)
  .innerJoin(roles, and(eq(roles.id, companyUserRoles.roleId), eq(roles.companyId, companyUserRoles.companyId)))
  .innerJoin(
    assignedByMember,
    and(
      eq(assignedByMember.id, companyUserRoles.assignedBy),
      eq(assignedByMember.companyId, companyUserRoles.companyId),
    ),
  )
  .innerJoin(assignedByAccount, eq(assignedByAccount.id, assignedByMember.userId))
  .where(conditions)
```

```ts
// ❌ 錯誤：寫不出來，不是「掃描腳本會抓」——db.query 的型別是 DrizzleTypeError（見上方
// db/client.ts 的引用），接下去取 .companyUserRoles 這個屬性名本身就是編譯錯誤。
const rows = await db.query.companyUserRoles.findMany({
  with: { role: true, assignedByMember: { with: { account: true } } },
})
```

兩條理由，且不是因為 N+1（relational API 產出單一查詢，不會製造 N+1，那是 §5 的範圍）：顯式
JOIN 的 SQL 與程式碼幾乎一對一，`EXPLAIN` 直接貼得出來，review 時看得懂實際會掃哪些表、用哪個
索引；relational API 需要另外維護一份關聯宣告，那是 schema 之外的第二份真相，會慢慢與 schema
漂移而不會有任何地方變紅。

分頁與總筆數兩次查詢必須用完全相同的 `FROM`／`JOIN`／`WHERE`，即使某個 `INNER JOIN` 看起來對
`COUNT` 沒必要——只要它可能篩掉列，少了它總筆數就會跟分頁列對不起來。

## 7. 金額與工時的型別

規範依據：§4.7。

- 金額禁止用 `float`／`double`／JS `number` 運算，DB 型別用 `decimal` 並指定精度：

  ```ts
  // apps/api/src/db/schema/regulatory-records.ts
  amount: decimal('amount', { precision: 18, scale: 4, mode: 'string' }),
  rate: decimal('rate', { precision: 18, scale: 8, mode: 'string' }),
  ```

  `mode: 'string'` 是關鍵：drizzle 讀 `decimal` 回傳字串，**禁止 `Number(...)` 後再計算**——
  轉成 float 的那一刻精度就沒了。連線設定同樣禁止驅動自作主張轉型：

  ```ts
  // apps/api/src/db/client.ts
  decimalNumbers: false,   // 讀 decimal 一律拿字串
  supportBigNumbers: true,
  bigNumberStrings: false,
  ```

- 工時一律以整數「分鐘」儲存與運算，只在輸出時換算為小時；小數小時加總會在月結累積誤差。
- 四捨五入規則集中在單一模組，每個呼叫點明確指定用途，不要散落各處各自 `Math.round`。

## 8. drizzle 表定義的標準寫法

以 `apps/api/src/db/schema/job-titles.ts`、`employee-job-title-histories.ts`、
`employee-employments.ts` 為範本。

### 8.1 主鍵與時間欄位

```ts
id: char('id', { length: 36 }).primaryKey(),          // UUID，固定 36 字元
createdAt: datetime('created_at', { mode: 'string' }).notNull(),
updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
deletedAt: datetime('deleted_at', { mode: 'string' }),          // 可軟刪除的表才有
deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
```

`datetime` 一律帶 `{ mode: 'string' }`，不用 `mode: 'date'`——時間以字串來回，時區問題交給
`db/time-zone-guard.ts` 在連線層統一把關（見 8.4），不要讓 JS `Date` 物件在應用層各自轉換。

### 8.2 公司欄位、外鍵、索引

```ts
// apps/api/src/db/schema/employee-job-title-histories.ts
companyId: char('company_id', { length: 36 }).notNull(),
employmentId: char('employment_id', { length: 36 }).notNull(),
jobTitleId: char('job_title_id', { length: 36 }).notNull(),
```

```ts
;(table) => [
  uniqueIndex('uq_employee_job_title_histories_employment_from').on(
    table.companyId,
    table.employmentId,
    table.effectiveFrom,
  ),
  index('ix_employee_job_title_histories_company_employment').on(table.companyId, table.employmentId), // §5：以 company_id 開頭
  foreignKey({
    name: 'fk_employee_job_title_histories_company',
    columns: [table.companyId],
    foreignColumns: [companies.id],
  }),
  // 複合外鍵：同時保證「任職存在」與「任職屬於同一家公司」
  foreignKey({
    name: 'fk_employee_job_title_histories_employment',
    columns: [table.companyId, table.employmentId],
    foreignColumns: [employeeEmployments.companyId, employeeEmployments.id],
  }),
]
```

**能用複合外鍵鎖住「同公司」就一定要用。** 只有被參照表的 `company_id` 可為 `NULL`（系統預設
列，如 `job_titles`／`job_positions`）時才退回單欄外鍵，並在 schema 檔頭寫清楚為什麼——複合
外鍵在系統預設列上永遠比對不到 `company_id = 本公司`，會把合法寫入擋下來。

### 8.3 狀態值不用 DB ENUM

```ts
export const JobTitleStatus = { Active: 'ACTIVE', Inactive: 'INACTIVE' } as const
export type JobTitleStatusValue = (typeof JobTitleStatus)[keyof typeof JobTitleStatus]
status: varchar('status', { length: 32 }).$type<JobTitleStatusValue>().notNull(),
```

### 8.4 全域自檢

- `db/time-zone-guard.ts`：啟動時檢查 `SELECT @@session.time_zone` 必須是 `+08:00`，不符拒絕
  啟動——時區設錯會讓所有寫入時間靜靜偏移，不會有任何錯誤或測試變紅。
- `db/field-encryption.ts`：啟動時驗證加密金鑰環合法。個資欄位（身分證、電話、地址、生日、
  Email）一律走 `FieldCipher.encrypt`／`decrypt`，查詢比對用 `blindIndex` 產生的 `*_hash`
  欄位，不能拿密文比對（每次加密 IV 不同，密文永遠不相等）。
- `db/field-masking.ts`：對外回應一律先遮罩（`maskIdentityNumber`、`maskPhone`、`maskEmail`……），
  完整明文不離開資料存取層。

## 9. 檢查清單

### 9.1 新增一張表

- [ ] 欄位獨立成 `db/schema/<表名>.ts`，`id` 用 `char(36)` 主鍵，時間欄位用
      `datetime(..., { mode: 'string' })`。
- [ ] 若帶 `company_id`：決定必填或可為 NULL（可為 NULL＝系統預設＋公司自訂並存，比照
      `job_titles`），並在檔頭寫清楚理由。
- [ ] 若有歷史意義需要軟刪除：補 `deletedAt`／`deletedSeq`，唯一鍵把 `deletedSeq` 併進去。
- [ ] 外鍵：能用複合外鍵鎖同公司就用；退回單欄外鍵時寫清楚為什麼。
- [ ] 索引：帶 `company_id` 的表，至少一條索引以 `company_id` 開頭。
- [ ] 在 `db/schema/index.ts` 匯出；若帶公司範圍，加進 `CompanyScopedTable` 聯集與
      `companyScopedTablesInDeleteOrder`（想清楚刪除順序：子表先於父表）。
- [ ] `bun run db:generate` → 檢查產出 → `bun run check:migration-journal` → `bun run db:migrate`。

### 9.2 只新增／修改既有表的一個欄位

比新增一張表輕量得多，不必走整份 9.1 清單——這裡才是「加個欄位」實際會用到的路徑：

- [ ] 型別比照同類欄位選。純排序用的欄位是最常見的簡單案例：

  ```ts
  // apps/api/src/db/schema/permissions.ts
  sortOrder: int('sort_order').notNull().default(0),
  ```

  整數、`notNull` 加 `default(0)`——新增資料不必先想好排序值，既有資料一律視為排在最前面。

- [ ] 決定 nullable 或 `default`（見上方 9.1 前的地雷組合說明：既有資料的表加 `NOT NULL` 又沒
      `default` 會直接失敗）。
- [ ] 這個欄位會不會被查詢條件或排序使用；會的話，補一條以 `company_id` 開頭的索引（§5）。
- [ ] `db/schema/index.ts` 的 `CompanyScopedTable` 聯集與 `companyScopedTablesInDeleteOrder`
      **不需要動**——這兩處只有新增一張表時才要調整，改既有表的欄位不影響它們。
- [ ] 若這個欄位要讓前端拿到：repository 的 `select` 清單、domain 型別、handler 的映射函式、
      routes 的 response schema 都要跟著補。§1.8.0 禁止把 repository 回傳值直接指派給
      `data`，這四處都是逐一手動列欄位／組裝——**表加了欄位，API 契約不會自動變**。
- [ ] `bun run db:generate` → 檢查產出 → `bun run check:migration-journal` → `bun run db:migrate`。

### 9.3 寫一支查詢

- [ ] 透過 `TenantDatabase`（或收到的 `QueryRunner`/`TransactionRunner`），不直接碰裸 `db`。
- [ ] 單表用 `select`／`update`／`insert`；JOIN **全部是 `INNER JOIN`** 用 `selectFrom` +
      `scopeAll([涉及的帶公司範圍表], ...)`；JOIN 清單裡**只要有一個 `LEFT JOIN`**，改用裸
      `runner`，`LEFT JOIN` 的公司條件放進該 JOIN 的 `ON`，不要放 `scopeAll`／`WHERE`（§2.3.1，
      這個坑不會報錯，症狀是查詢悄悄少了幾列）。
- [ ] 帶軟刪除欄位的表，`WHERE` 一定同時比對 `eq(deletedSeq, 0)` 與 `isNull(deletedAt)`，除非
      是刻意的稽核歷程查詢（要寫註解）。
- [ ] 狀態變更用條件式 `UPDATE`（預期狀態放進 `WHERE`），用 `readAffectedRows` 檢查影響列數，
      0 列轉成 Conflict 錯誤，不拋例外。
- [ ] 期間可能重疊的資料，寫入前對擁有者那一列 `SELECT ... FOR UPDATE`（交易內）。
- [ ] 唯一性一律「先寫入、攔截 `errno=1062`」，不做「先 `SELECT` 再 `INSERT`」。
- [ ] 分頁列表：分頁與總筆數用完全相同的 `FROM`／`JOIN`／`WHERE`；`ORDER BY` 加第二排序鍵
      （通常是 `id`）避免同值列跨頁重複或消失。
- [ ] 排序／篩選欄位若來自使用者輸入，經白名單映射到實際欄位，不直接把字串接進 `ORDER BY`。
- [ ] 迴圈裡不得出現資料庫呼叫的 `await`（含 `.map(async ...)`／`Promise.all`）；多筆關聯資料
      先蒐集鍵、`inArray` 一次查完、`Map` 對應回去。
- [ ] 一律顯式 `select` ＋ `join`，不使用 `db.query.*` 或 `with:`。
- [ ] 金額用 `decimal`（字串），不 `Number(...)`；工時用整數分鐘。
- [ ] 若這支查詢會被多個模組編排進同一筆交易，簽章收 `TransactionRunner`，不是 `QueryRunner`。
- [ ] 開交易一律在 service 層（且是編排入口，不是被編排的子動作），repository 不自開交易。
