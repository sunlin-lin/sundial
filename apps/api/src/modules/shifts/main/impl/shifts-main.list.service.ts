/**
 * 業務動作：查詢班別清單。
 *
 * 查詢類端點**沒有業務錯誤**（§3.1.3）：查無資料是一個正常且有效的答案，回空清單而不是錯誤
 * ——當成錯誤的話，前端就得為「這組條件查不到資料」寫錯誤處理。跨公司存取同樣落在這條路徑上：
 * 公司條件寫在 `WHERE` 裡，別家公司的班別在查詢階段就等同於不存在（§3.2、§4.2）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { ShiftsMainContext } from '../domain/shift-context.ts'
import type { ShiftListPage, ShiftListQuery } from '../domain/shift-model.ts'
import { listShiftPage } from '../shifts-main.repository.ts'

export const listShifts = async (
  context: ShiftsMainContext,
  query: ShiftListQuery,
): Promise<ServiceResult<ShiftListPage>> => succeed(await listShiftPage(context.db, context.companyId, query))
