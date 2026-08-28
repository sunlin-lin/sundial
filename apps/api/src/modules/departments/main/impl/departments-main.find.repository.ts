/**
 * 資料存取：依 id 取單一部門的完整內容。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { departments } from '../../../../db/schema/index.ts'
import type { DepartmentDetail } from '../domain/department-model.ts'

/**
 * @returns 查無資料回 `null`。**別家公司的部門也回 `null`**，而且走的是同一行程式碼
 *   ——公司條件由 `TenantDatabase` 寫進 `WHERE`（§4.2），因此「不存在」與「屬於其他公司」
 *   想寫出不一致的回應都寫不出來（§3.2）。
 *
 * **本函式同時服務三種呼叫者，這是刻意的重用，不是巧合**：
 * 1. `get` 端點的查詢本體；
 * 2. `create`／`update` 對「新的上層是否存在且同公司」的驗證——把候選 `parentId` 當成
 *    `departmentId` 傳進來即可，成功找到就代表它存在、屬於本公司、且尚未被軟刪除；
 * 3. `create`／`update`／`delete` 寫入後在同一交易內讀回最新內容以組裝回應（§3.1.2 的
 *    「讀不回來即系統錯誤」防線）。
 */
export const findDepartmentDetail = async (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
): Promise<DepartmentDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const [row] = await tenant.select(
    {
      id: departments.id,
      parentId: departments.parentId,
      code: departments.code,
      name: departments.name,
      description: departments.description,
      status: departments.status,
      createdAt: departments.createdAt,
      updatedAt: departments.updatedAt,
    },
    departments,
    eq(departments.id, departmentId),
    // §4.3：軟刪除的部門等同不存在，否則刪掉的部門還能被讀出來繼續編輯，或被選成新的上層。
    eq(departments.deletedSeq, 0),
    isNull(departments.deletedAt),
  )

  return row ?? null
}
