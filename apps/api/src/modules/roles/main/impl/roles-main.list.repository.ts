/**
 * 資料存取：角色清單的一頁 ＋ 總筆數。
 */
import { asc, count, desc, eq, isNull, like, or, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { roles } from '../../../../db/schema/index.ts'
import { toKeywordPattern } from '../domain/role-list-view.ts'
import type { RoleListPage, RoleListQuery } from '../domain/role-model.ts'

/**
 * 排序欄位 → 資料表欄位。
 *
 * 只認白名單內的值，其餘一律落到 `code`：路由的 schema 已經擋過一次，這裡是第二道
 * ——把外部字串接進 `ORDER BY` 是 SQL injection 與全表掃描的入口（§1.4），
 * 而「schema 擋過了所以這裡可以直接用」這個假設，在有人加了新欄位卻只改一邊時就不成立了。
 */
const sortColumn = (field: string) => {
  switch (field) {
    case 'name':
      return roles.name
    case 'status':
      return roles.status
    case 'createdAt':
      return roles.createdAt
    case 'updatedAt':
      return roles.updatedAt
    default:
      return roles.code
  }
}

/**
 * 篩選條件。
 *
 * `isNull(roles.deletedAt)` 是**預設查詢一律要加**的那一條（§4.3）：忘了加，已刪除的角色會
 * 重新出現在清單與可選項裡，等於刪除從未生效。公司範圍不在這裡——它由 `TenantDatabase` 補上，
 * 讓「不帶公司條件」寫不出來（§4.2）。
 */
const buildConditions = (query: RoleListQuery): readonly (SQL | undefined)[] => {
  const conditions: (SQL | undefined)[] = [isNull(roles.deletedAt)]

  if (query.keyword !== null && query.keyword !== '') {
    const pattern = toKeywordPattern(query.keyword)
    conditions.push(or(like(roles.code, pattern), like(roles.name, pattern)))
  }

  if (query.status !== null) {
    conditions.push(eq(roles.status, query.status))
  }

  return conditions
}

/**
 * 取一頁角色。
 *
 * 分頁與總筆數分成兩次查詢，不用視窗函式一次取回：兩者的 `WHERE` 完全相同，
 * 而總筆數不受 `LIMIT` 影響——寫成同一句反而要多一層子查詢，`EXPLAIN` 也跟著變得看不懂（§4.5）。
 * 兩次查詢都吃 `ix_roles_company_status`（以 `company_id` 開頭）。
 *
 * `currentPage` 超出範圍時自然回空陣列與正確的 `pagination`，不另外判斷、也不回 404（§1.4）。
 */
export const listRolePage = async (
  runner: QueryRunner,
  companyId: string,
  query: RoleListQuery,
): Promise<RoleListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const conditions = buildConditions(query)
  const direction = query.sort.order === 'desc' ? desc : asc

  const items = await tenant
    .select(
      { id: roles.id, code: roles.code, name: roles.name, status: roles.status, isSystem: roles.isSystem },
      roles,
      ...conditions,
    )
    // 第二排序鍵固定為 id：只依 name／status 排序時，值相同的列在不同頁的順序不保證，
    // 於是同一筆資料會同時出現在第 1 頁與第 2 頁，而另一筆一頁都沒出現。
    .orderBy(direction(sortColumn(query.sort.field)), asc(roles.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await tenant.select({ total: count() }, roles, ...conditions)
  const [totalRow] = totals

  return { items, totalCount: totalRow?.total ?? 0 }
}
