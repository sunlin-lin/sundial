/**
 * 資料存取：員工清單的一頁 ＋ 總筆數。
 */
import { asc, count, desc, eq, isNull, like, or, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { employees } from '../../../../db/schema/index.ts'
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
 */
export const listEmployeePage = async (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
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

  // 解密後**當場遮罩**，明文不離開資料存取層（§5.1，見 `domain/employee-secrets.ts`）。
  return { items: rows.map((row) => toMaskedSummary(cipher, row)), totalCount: totalRow?.total ?? 0 }
}
