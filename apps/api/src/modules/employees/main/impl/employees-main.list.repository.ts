/**
 * 資料存取：員工清單的一頁 ＋ 總筆數。
 *
 * **含目前有效職稱、目前有效部門、目前任職資料與帳號狀態**（UI 定案 `docs/ui/
 * 20-employee-list.md` §1）：全部批次算，理由與作法見 {@link listEmployeePage} 檔頭。
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, like, or, lte, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import {
  companyUsers,
  departments,
  employeeDepartmentHistories,
  employeeEmployments,
  employeeJobTitleHistories,
  employees,
  jobTitles,
  type CompanyUserStatusValue,
  type EmploymentStatusValue,
  type EmploymentTypeCodeValue,
} from '../../../../db/schema/index.ts'
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

/** 這一批「目前任職」的一列（見 {@link findCurrentEmployments} 的定義）。 */
type CurrentEmploymentRow = {
  readonly id: string
  readonly employeeId: string
  readonly employmentTypeCode: EmploymentTypeCodeValue
  readonly hireDate: string
  readonly status: EmploymentStatusValue
}

/**
 * 批次算出「目前任職」：**到職日最新的一筆未刪除任職紀錄，不論在職或離職**（定義理由見
 * `domain/employee-model.ts` 的 `EmployeeListItem.employmentTypeCode` 檔頭）。
 *
 * `uq_employee_employments_employee_hire_date` 保證同一員工的未刪除任職紀錄到職日不重複，
 * 因此「取到職日最大的一筆」不會有平手，用 `Map` 逐列比大小即可，不必依賴資料庫排序。
 *
 * @param employeeIds `null` 代表不限員工（供篩選條件解析整間公司使用），空陣列則直接回空 `Map`
 *   而不送出查詢——呼叫端不必先判斷「這一頁是不是剛好沒有資料」。
 */
const findCurrentEmployments = async (
  runner: QueryRunner,
  companyId: string,
  employeeIds: readonly string[] | null,
): Promise<ReadonlyMap<string, CurrentEmploymentRow>> => {
  if (employeeIds !== null && employeeIds.length === 0) return new Map()

  const tenant = new TenantDatabase(runner, companyId)
  const conditions: (SQL | undefined)[] = [eq(employeeEmployments.deletedSeq, 0), isNull(employeeEmployments.deletedAt)]
  if (employeeIds !== null) conditions.push(inArray(employeeEmployments.employeeId, [...employeeIds]))

  const rows = await tenant.select(
    {
      id: employeeEmployments.id,
      employeeId: employeeEmployments.employeeId,
      employmentTypeCode: employeeEmployments.employmentTypeCode,
      hireDate: employeeEmployments.hireDate,
      status: employeeEmployments.status,
    },
    employeeEmployments,
    ...conditions,
  )

  const latestByEmployeeId = new Map<string, CurrentEmploymentRow>()
  for (const row of rows) {
    const current = latestByEmployeeId.get(row.employeeId)
    if (current === undefined || row.hireDate > current.hireDate) latestByEmployeeId.set(row.employeeId, row)
  }
  return latestByEmployeeId
}

/**
 * 批次查出一批任職「今天生效中」的部門 id（`employee_department_histories`）。
 * 同一個任職同一時間只會有一筆有效部門（寫入端的鎖與唯一鍵保證，見該表 schema 檔頭），
 * 理論上不會多筆，但即使意外多筆也只取遍歷到的最後一筆——不影響正確性。
 */
const findCurrentDepartmentIdsByEmploymentIds = async (
  runner: QueryRunner,
  companyId: string,
  employmentIds: readonly string[],
  today: string,
): Promise<ReadonlyMap<string, string>> => {
  if (employmentIds.length === 0) return new Map()

  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant.select(
    { employmentId: employeeDepartmentHistories.employmentId, departmentId: employeeDepartmentHistories.departmentId },
    employeeDepartmentHistories,
    inArray(employeeDepartmentHistories.employmentId, [...employmentIds]),
    lte(employeeDepartmentHistories.effectiveFrom, today),
    or(isNull(employeeDepartmentHistories.effectiveTo), gte(employeeDepartmentHistories.effectiveTo, today)),
  )
  return new Map(rows.map((row) => [row.employmentId, row.departmentId]))
}

/** 批次查部門名稱。`departments.company_id` 必填，直接用 `TenantDatabase.select`。 */
const findDepartmentNamesByIds = async (
  runner: QueryRunner,
  companyId: string,
  departmentIds: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  if (departmentIds.length === 0) return new Map()

  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant.select(
    { id: departments.id, name: departments.name },
    departments,
    inArray(departments.id, [...departmentIds]),
  )
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** 批次查一批任職「今天生效中」的職稱 id，形狀與 {@link findCurrentDepartmentIdsByEmploymentIds} 同構。 */
const findCurrentJobTitleIdsByEmploymentIds = async (
  runner: QueryRunner,
  companyId: string,
  employmentIds: readonly string[],
  today: string,
): Promise<ReadonlyMap<string, string>> => {
  if (employmentIds.length === 0) return new Map()

  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant.select(
    { employmentId: employeeJobTitleHistories.employmentId, jobTitleId: employeeJobTitleHistories.jobTitleId },
    employeeJobTitleHistories,
    inArray(employeeJobTitleHistories.employmentId, [...employmentIds]),
    lte(employeeJobTitleHistories.effectiveFrom, today),
    or(isNull(employeeJobTitleHistories.effectiveTo), gte(employeeJobTitleHistories.effectiveTo, today)),
  )
  return new Map(rows.map((row) => [row.employmentId, row.jobTitleId]))
}

/**
 * 批次查職稱名稱。**`job_titles.company_id` 可為 NULL（系統預設，見該表 schema 檔頭）**，因此
 * 改用 `selectFrom` 自組 `company_id = 本公司 OR company_id IS NULL`——`TenantDatabase.select`
 * 的預設 scope 天生找不到 NULL 列。不加狀態／軟刪除條件：職稱後來被停用或刪除，不改變「這位
 * 員工當時被指派了這個職稱」這個歷史事實。
 */
const findJobTitleNamesByIds = async (
  runner: QueryRunner,
  companyId: string,
  jobTitleIds: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  if (jobTitleIds.length === 0) return new Map()

  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant
    .selectFrom({ id: jobTitles.id, name: jobTitles.name }, jobTitles)
    .where(
      and(inArray(jobTitles.id, [...jobTitleIds]), or(eq(jobTitles.companyId, companyId), isNull(jobTitles.companyId))),
    )
  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * 批次查帳號狀態。`company_users.employee_id` 可為 NULL（非員工協作者），但這裡永遠以一組
 * 具體的員工 id 查詢，`IN (...)` 天生比對不到 NULL，回傳列的 `employeeId` 保證非空
 * ——`row.employeeId ?? null` 只是安撫型別，不是真的會用到 `null` 分支。
 */
const findAccountStatusesByEmployeeIds = async (
  runner: QueryRunner,
  companyId: string,
  employeeIds: readonly string[],
): Promise<ReadonlyMap<string, CompanyUserStatusValue>> => {
  if (employeeIds.length === 0) return new Map()

  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant.select(
    { employeeId: companyUsers.employeeId, status: companyUsers.status },
    companyUsers,
    inArray(companyUsers.employeeId, [...employeeIds]),
  )
  const statusByEmployeeId = new Map<string, CompanyUserStatusValue>()
  for (const row of rows) {
    if (row.employeeId !== null) statusByEmployeeId.set(row.employeeId, row.status)
  }
  return statusByEmployeeId
}

/**
 * 依查詢條件解出符合資格的員工 id 清單。**三個篩選條件都沒有指定時回 `null`（不限制）**，
 * 這時完全不會多送出任何查詢——後面的 `buildConditions` 看到 `null` 就不會加 `IN (...)`。
 *
 * 篩選比對的是「目前任職」／「目前有效部門」，定義與批次顯示欄位完全相同（同一套規則只寫一次，
 * 不讓「篩選出來的」與「畫面上顯示的」用兩套不同的判準）。**這裡查的是整間公司**，不是這一頁
 * ——分頁必須先知道「誰符合條件」才能切頁，因此這幾條查詢的成本隨公司規模而非頁面筆數成長，
 * 但仍然是「一次查完」而不是逐列查詢，見 {@link listEmployeePage} 檔頭的查詢次數說明。
 */
const resolveEligibleEmployeeIds = async (
  runner: QueryRunner,
  companyId: string,
  query: EmployeeListQuery,
  today: string,
): Promise<readonly string[] | null> => {
  if (query.departmentId === null && query.employmentStatus === null && query.accountStatus === null) return null

  let eligible: Set<string> | null = null
  const intersect = (matchedIds: Iterable<string>): void => {
    const matchedSet = new Set(matchedIds)
    eligible = eligible === null ? matchedSet : new Set([...eligible].filter((id) => matchedSet.has(id)))
  }

  // 任職狀態與部門篩選都要先知道整間公司「目前任職」是哪一筆，因此共用同一次查詢。
  if (query.departmentId !== null || query.employmentStatus !== null) {
    const currentEmployments = await findCurrentEmployments(runner, companyId, null)

    if (query.employmentStatus !== null) {
      const status = query.employmentStatus
      intersect(
        [...currentEmployments.values()]
          .filter((employment) => employment.status === status)
          .map((employment) => employment.employeeId),
      )
    }

    if (query.departmentId !== null) {
      const departmentId = query.departmentId
      const employmentIds = [...currentEmployments.values()].map((employment) => employment.id)
      const departmentByEmploymentId = await findCurrentDepartmentIdsByEmploymentIds(
        runner,
        companyId,
        employmentIds,
        today,
      )
      intersect(
        [...currentEmployments.values()]
          .filter((employment) => departmentByEmploymentId.get(employment.id) === departmentId)
          .map((employment) => employment.employeeId),
      )
    }
  }

  if (query.accountStatus !== null) {
    const tenant = new TenantDatabase(runner, companyId)
    const rows = await tenant.select(
      { employeeId: companyUsers.employeeId },
      companyUsers,
      eq(companyUsers.status, query.accountStatus),
    )
    intersect(rows.flatMap((row) => (row.employeeId === null ? [] : [row.employeeId])))
  }

  // 前面的 guard 已經保證至少跑過一次 `intersect`，`eligible` 在這裡必然不是 `null`。
  return eligible === null ? [] : [...eligible]
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
 *
 * `eligibleEmployeeIds` 是 {@link resolveEligibleEmployeeIds} 算出來的結果：`null` 代表沒有
 * 部門／任職狀態／帳號狀態篩選，不加任何限制。
 */
const buildConditions = (
  query: EmployeeListQuery,
  eligibleEmployeeIds: readonly string[] | null,
): readonly (SQL | undefined)[] => {
  const conditions: (SQL | undefined)[] = [eq(employees.deletedSeq, 0), isNull(employees.deletedAt)]

  if (query.keyword !== null && query.keyword !== '') {
    const pattern = toKeywordPattern(query.keyword)
    conditions.push(or(like(employees.employeeCode, pattern), like(employees.name, pattern)))
  }

  if (eligibleEmployeeIds !== null) conditions.push(inArray(employees.id, [...eligibleEmployeeIds]))

  return conditions
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
 * ## 總查詢次數：沒有篩選時固定 8 次，每加一種篩選條件最多 ＋1（部門篩選 ＋2），不隨頁面筆數或
 * 公司規模成長成 N+1（§4.5）
 *
 * 沒有部門／任職狀態／帳號狀態篩選時：
 *   1. 員工分頁一次
 *   2. 員工總數一次
 *   3. 這一頁員工的「目前任職」一次（{@link findCurrentEmployments}，含僱用類型、到職日、狀態，
 *      三個欄位不必再多查——它們就是這次查詢 select 出來的欄位）
 *   4. 這批任職「今天生效中」的部門歷史一次
 *   5. 部門名稱一次
 *   6. 這批任職「今天生效中」的職稱歷史一次
 *   7. 職稱名稱一次
 *   8. 這一頁員工的帳號狀態一次
 * 全部隨「這一頁最多 `perPage`（上限 100）位員工」成長，不隨公司總員工數成長。
 *
 * 篩選條件會在第 1、2 步之前**額外**呼叫 {@link resolveEligibleEmployeeIds}：任職狀態篩選 ＋1
 * （查整間公司「目前任職」一次）；部門篩選 ＋2（任職狀態篩選那一次查詢與部門篩選共用，
 * 部門篩選另外再查一次該批任職的部門歷史）；帳號狀態篩選 ＋1（查整間公司帳號狀態一次）。
 * 三種篩選同時使用時最多 8＋3＝11 次。**這幾次額外查詢隨公司規模成長，不隨頁面筆數成長**
 * ——與既有的「總筆數」查詢是同一種性質（一次查完全部符合條件的列，不是逐列查詢），
 * 因此仍然符合 §4.5 對 N+1 的要求：往返次數（round trip）不隨資料筆數增加，只有單次查詢
 * 回傳的列數會增加。
 */
export const listEmployeePage = async (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  today: string,
  query: EmployeeListQuery,
): Promise<EmployeeListPage> => {
  const tenant = new TenantDatabase(runner, companyId)

  const eligibleEmployeeIds = await resolveEligibleEmployeeIds(runner, companyId, query, today)
  // 篩選條件解出「沒有任何員工符合」：直接回空頁，不必再送出分頁與總數查詢。
  if (eligibleEmployeeIds !== null && eligibleEmployeeIds.length === 0) {
    return { items: [], totalCount: 0 }
  }

  const conditions = buildConditions(query, eligibleEmployeeIds)
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

  const employeeIds = rows.map((row) => row.id)
  const currentEmployments = await findCurrentEmployments(runner, companyId, employeeIds)
  const employmentIds = [...currentEmployments.values()].map((employment) => employment.id)

  const departmentByEmploymentId = await findCurrentDepartmentIdsByEmploymentIds(
    runner,
    companyId,
    employmentIds,
    today,
  )
  const departmentIds = [...new Set(departmentByEmploymentId.values())]
  const departmentNameById = await findDepartmentNamesByIds(runner, companyId, departmentIds)

  const jobTitleByEmploymentId = await findCurrentJobTitleIdsByEmploymentIds(runner, companyId, employmentIds, today)
  const jobTitleIds = [...new Set(jobTitleByEmploymentId.values())]
  const jobTitleNameById = await findJobTitleNamesByIds(runner, companyId, jobTitleIds)

  const accountStatusByEmployeeId = await findAccountStatusesByEmployeeIds(runner, companyId, employeeIds)

  // 解密後**當場遮罩**，明文不離開資料存取層（§5.1，見 `domain/employee-secrets.ts`）。
  return {
    items: rows.map((row) => {
      const employment = currentEmployments.get(row.id) ?? null
      const departmentId = employment === null ? null : (departmentByEmploymentId.get(employment.id) ?? null)
      const jobTitleId = employment === null ? null : (jobTitleByEmploymentId.get(employment.id) ?? null)

      return {
        ...toMaskedSummary(cipher, row),
        jobTitleName: jobTitleId === null ? null : (jobTitleNameById.get(jobTitleId) ?? null),
        departmentName: departmentId === null ? null : (departmentNameById.get(departmentId) ?? null),
        employmentTypeCode: employment === null ? null : employment.employmentTypeCode,
        hireDate: employment === null ? null : employment.hireDate,
        employmentStatus: employment === null ? null : employment.status,
        accountStatus: accountStatusByEmployeeId.get(row.id) ?? null,
      }
    }),
    totalCount: totalRow?.total ?? 0,
  }
}
