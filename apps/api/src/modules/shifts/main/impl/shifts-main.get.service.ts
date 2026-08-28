/**
 * 業務動作：查詢單一班別。
 *
 * 查無資料回 `null`（§1.3「查無資料不是 404」），**別家公司的班別也回 `null`**，且兩者走的是
 * 同一行程式碼（§3.2）：公司條件由 `TenantDatabase` 寫進 `WHERE`，「存在但不屬於你」與
 * 「不存在」想寫出不一樣的回應都寫不出來。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { ShiftsMainContext } from '../domain/shift-context.ts'
import type { ShiftDetail, ShiftTargetInput } from '../domain/shift-model.ts'
import { findShiftDetail } from '../shifts-main.repository.ts'

export const getShift = async (
  context: ShiftsMainContext,
  input: ShiftTargetInput,
): Promise<ServiceResult<ShiftDetail | null>> => succeed(await findShiftDetail(context.db, context.companyId, input.id))
