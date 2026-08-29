/**
 * 資料存取：員工清單的一頁 ＋ 總筆數。
 *
 * **含目前有效職稱**（`EmployeeListItem.jobTitleName`，計畫 §3.2、UI 定案 `docs/ui/
 * 20-employee-list.md` §1）：批次算，理由與作法見 {@link listEmployeePage} 檔頭。
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, like, or, lte, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { employeeEmployments, employeeJobTitleHistories, employees, jobTitles } from '../../../../db/schema/index.ts'
import { toKeywordPattern } from '../../../../shared/list-view.ts'
import type { EmployeeListPage, EmployeeListQuery } from '../domain/employee-model.ts'
import { toMaskedSummary } from '../domain/employee-secrets.ts'

/**
 * 排序欄位 → 資料表欄位。
 *
 * 只認白名單內的值，其餘一律落到 `employee_code`：路由的 schema 已經擋過一次，這裡是第二道
 * ——把外部字串接進 `ORDER BY` 是 SQL injection 與全表掃描的入口（§1.4），
 * 而「schema 擋過了所以這裡可以直接用」這個假設，在有人加了新欄位卻只改一邊時就不成立了。
 */
const sortColumn = (field: string) => {
  switch (field) {
    case 'name':
      return employees.name
    case 'createdAt':
      return employees.createdAt
    case 'updatedAt':
      return employees.updatedAt
    default:
      return employees.employeeCode
  }
}

/**
 * 篩選條件。
 *
 * **軟刪除同時比對兩個欄位**，這不是重複：
 * - `deleted_seq = 0` 是**索引用得上**的那一個（`ix_employees_company_name` 的第二段），
 *   也是唯一鍵真正的參與者（§4.3）；
 * - `deleted_at IS NULL` 是這張表軟刪除語意的本體，也是 §4.3 那條「查詢帶 `deleted_at` 的表時
 *   `where` 必須出現 `deletedAt`」掃描檢查看得到的東西。
 * 兩者永遠一起寫入、一起清除，因此不會出現只滿足其中一個的列。
 *
 * 公司範圍不在這裡——它由 `TenantDatabase` 補上，讓「不帶公司條件」寫不出來（§4.2）。
 *
 * **`keyword` 只比對 `name` 與 `employee_code`**：其餘欄位在資料庫裡是密文，而每次寫入的 IV
 * 都不同，同一個明文的位元組每次都不一樣——`LIKE` 在上面連完全相符都比不出來。
 * 這是加密欄位的固有性質，不是還沒做完的功能。
 */
const buildConditions = (query: EmployeeListQuery): readonly (SQL | undefined)[] => {
  const conditions: (SQL | undefined)[] = [eq(employees.deletedSeq, 0), isNull(employees.deletedAt)]

  if (query.keyword !== null && query.keyword !== '') {
    const pattern = toKeywordPattern(query.keyword)
    conditions.push(or(like(employees.employeeCode, pattern), like(employees.name, pattern)))
  }

  return conditions
}

/**
 * 批次算出「這批員工目前有效的職稱名稱」，回傳 `employeeId → jobTitleName` 的對應。
 *
 * **三次批次查詢，不隨頁面筆數以外的任何東西成長**（§4.5：先蒐集鍵、一次查完、記憶體裡用 `Map`
 * 對應回去，不在迴圈裡逐一查詢）：
 * 1. 這批員工目前有效的任職（`status = 'ACTIVE'`）。
 * 2. 這批任職裡，`effectiveFrom <= today` 且（`effectiveTo` 為 NULL 或 `>= today`）的職稱歷史
 *    ——「目前有效」的定義與 `employee_job_title_histories` 的鎖粒度（同一任職同一時間僅一筆）
 *    一致，理論上每個任職最多對到一筆，但即使查詢意外回多筆，這裡也只取第一筆，不影響正確性
 *    （鎖與唯一鍵已經在寫入端擋掉這個情況，這裡的「取第一筆」只是防禦性寫法）。
 * 3. 這批職稱的名稱（`job_titles.name`）。
 *
 * @returns 查無有效職稱的員工不會出現在回傳的 `Map` 裡，呼叫端以 `?? null` 處理。
 */
const listCurrentJobTitleNames = async (
  tenant: TenantDatabase,
  companyId: string,
  employeeIds: readonly string[],
  today: string,
): Promise<ReadonlyMap<string, string>> => {
  if (employeeIds.length === 0) return new Map()

  // 1. 目前有效任職。`employee_employments.company_id` 必填，用 `TenantDatabase.select`
  // （會自動補上公司條件），不必像 `job_titles` 那樣繞道 `selectFrom`。
  const employmentRows = await tenant.select(
    { employeeId: employeeEmployments.employeeId, id: employeeEmployments.id },
    employeeEmployments,
    inArray(employeeEmployments.employeeId, [...employeeIds]),
    eq(employeeEmployments.status, 'ACTIVE'),
    eq(employeeEmployments.deletedSeq, 0),
    isNull(employeeEmployments.deletedAt),
  )
  if (employmentRows.length === 0) return new Map()

  const employmentIdByEmployeeId = new Map(employmentRows.map((row) => [row.employeeId, row.id]))
  const employmentIds = [...new Set(employmentRows.map((row) => row.id))]

  // 2. 這批任職裡目前生效的職稱歷史。`employee_job_title_histories.company_id` 同樣必填。
  const historyRows = await tenant.select(
    { employmentId: employeeJobTitleHistories.employmentId, jobTitleId: employeeJobTitleHistories.jobTitleId },
    employeeJobTitleHistories,
    inArray(employeeJobTitleHistories.employmentId, employmentIds),
    lte(employeeJobTitleHistories.effectiveFrom, today),
    or(isNull(employeeJobTitleHistories.effectiveTo), gte(employeeJobTitleHistories.effectiveTo, today)),
  )
  if (historyRows.length === 0) return new Map()

  const jobTitleIdByEmploymentId = new Map(historyRows.map((row) => [row.employmentId, row.jobTitleId]))
  const jobTitleIds = [...new Set(historyRows.map((row) => row.jobTitleId))]

  // 3. 職稱名稱。**`job_titles.company_id` 可為 NULL（系統預設，見該表 schema 檔頭）**，因此
  // 這裡改用 `selectFrom` 自組 `company_id = 本公司 OR company_id IS NULL`，理由與
  // `job-titles-main.find.repository.ts` 檔頭同構——`TenantDatabase.select` 的預設 scope
  // 天生找不到 NULL 列。不加狀態／軟刪除條件：職稱後來被停用或刪除，不改變「這位員工當時被
  // 指派了這個職稱」這個歷史事實，清單仍然顯示名稱（比照 `departments` 對「停用不動歷史」的
  // 既有處置）。
  const jobTitleRows = await tenant
    .selectFrom({ id: jobTitles.id, name: jobTitles.name }, jobTitles)
    .where(and(inArray(jobTitles.id, jobTitleIds), or(eq(jobTitles.companyId, companyId), isNull(jobTitles.companyId))))
  const nameByJobTitleId = new Map(jobTitleRows.map((row) => [row.id, row.name]))

  const nameByEmployeeId = new Map<string, string>()
  for (const [employeeId, employmentId] of employmentIdByEmployeeId) {
    const jobTitleId = jobTitleIdByEmploymentId.get(employmentId)
    if (jobTitleId === undefined) continue
    const name = nameByJobTitleId.get(jobTitleId)
    if (name !== undefined) nameByEmployeeId.set(employeeId, name)
  }
  return nameByEmployeeId
}

/**
 * 取一頁員工。
 *
 * 分頁與總筆數分成兩次查詢，不用視窗函式一次取回：兩者的 `WHERE` 完全相同，
 * 而總筆數不受 `LIMIT` 影響——寫成同一句反而要多一層子查詢，`EXPLAIN` 也跟著變得看不懂（§4.5）。
 * 兩次查詢都吃 `ix_employees_company_name`（以 `company_id` 開頭，§4.5）。
 *
 * **只 select 清單真的要用的五欄**（§2 禁止 `select *`／禁止直接回 Drizzle row）：
 * 把生日、電話、地址一起撈出來，等於每列多解三次密，而清單根本不顯示它們。
 *
 * `currentPage` 超出範圍時自然回空陣列與正確的 `pagination`，不另外判斷、也不回 404（§1.4）。
 *
 * **總查詢次數固定為 5（不含連線建立）：員工分頁一次、員工總數一次、目前有效任職一次、目前有效
 * 職稱一次、職稱名稱一次**——全部隨「這一頁最多 `perPage`（上限 100）位員工」成長，不隨公司總
 * 員工數成長，符合 §4.5 對 N+1 的要求（一次 `WHERE ... IN (...)` 查完，不在迴圈裡逐一查詢）。
 */
export const listEmployeePage = async (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  today: string,
  query: EmployeeListQuery,
): Promise<EmployeeListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const conditions = buildConditions(query)
  const direction = query.sort.order === 'desc' ? desc : asc

  const rows = await tenant
    .select(
      {
        id: employees.id,
        employeeCode: employees.employeeCode,
        name: employees.name,
        gender: employees.gender,
        identityNumberEncrypted: employees.identityNumberEncrypted,
      },
      employees,
      ...conditions,
    )
    // 第二排序鍵固定為 id：只依 name 排序時，同名的列在不同頁的順序不保證，
    // 於是同一位員工會同時出現在第 1 頁與第 2 頁，而另一位一頁都沒出現。
    .orderBy(direction(sortColumn(query.sort.field)), asc(employees.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await tenant.select({ total: count() }, employees, ...conditions)
  const [totalRow] = totals

  const jobTitleNameByEmployeeId = await listCurrentJobTitleNames(
    tenant,
    companyId,
    rows.map((row) => row.id),
    today,
  )

  // 解密後**當場遮罩**，明文不離開資料存取層（§5.1，見 `domain/employee-secrets.ts`）。
  return {
    items: rows.map((row) => ({
      ...toMaskedSummary(cipher, row),
      jobTitleName: jobTitleNameByEmployeeId.get(row.id) ?? null,
    })),
    totalCount: totalRow?.total ?? 0,
  }
}
