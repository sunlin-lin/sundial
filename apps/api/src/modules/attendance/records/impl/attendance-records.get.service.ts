/**
 * 業務動作：查詢單筆打卡明細，依呼叫者身分決定回不回座標（計畫 §4.2）。
 *
 * **這是本專案第一次出現「同一支 `get` 端點依呼叫者身分回傳不同欄位」的模式**，這個分支
 * **沒有任何工具在擋**——`check:layers` 管的是 import 邊界，不管一支端點對不同呼叫者回傳的
 * 欄位是否正確。完整規則見 `domain/attendance-record-visibility.ts` 檔頭；
 * `__tests__/attendance-records.endpoints.test.ts` 的 `get` 測試至少涵蓋三種情境（本人／
 * 有權限查他人／無權限查他人），且斷言回應物件的鍵存不存在，不是斷言值。
 *
 * **查無資料回 `data: null`，不是業務錯誤**（§1.3、§3.1.3）：跨公司存取（`recordId` 屬於別家
 * 公司）與「這筆記錄根本不存在」在 `findAttendanceRecordDetail` 內部已經是同一條路徑
 * （`TenantDatabase` 的公司範圍過濾），因此這裡也不需要、也不該對兩者給出不同的回應（§3.2）。
 *
 * **這裡只決定「看不看得到座標」（回傳一個 `visible` 旗標），不決定回應物件的鍵存不存在**
 * ——鍵存不存在是 JSON 形狀的映射問題，留給 `attendance-records.handler.ts` 依這個旗標組裝
 * `data`（§1.8.0：handler 負責把業務資料收成端點的 `data` 形狀）。
 *
 * **純查詢，不開交易**（§4.4：交易邊界只在有寫入時才需要）。
 */
import {
  VIEW_OTHERS_COORDINATES_PERMISSION_CODES,
  resolveCoordinateVisibility,
} from '../domain/attendance-record-visibility.ts'
import { listPermissionCodes } from '../../../company-users/index.ts'
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceRecordsContext } from '../domain/attendance-record-context.ts'
import type {
  AttendanceRecordCoordinates,
  AttendanceRecordDetail,
  GetAttendanceRecordInput,
} from '../domain/attendance-record-model.ts'
import { findAttendanceRecordDetail, findEmployeeIdForCompanyUser } from '../attendance-records.repository.ts'

export type AttendanceRecordView = {
  readonly detail: AttendanceRecordDetail
  readonly coordinates: AttendanceRecordCoordinates
}

export const getAttendanceRecord = async (
  context: AttendanceRecordsContext,
  input: GetAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordView | null>> => {
  const record = await findAttendanceRecordDetail(context.db, context.companyId, input.recordId)
  if (record === null) return succeed(null)

  const requesterEmployeeId = await findEmployeeIdForCompanyUser(
    context.db,
    context.companyId,
    context.operatorCompanyUserId,
  )
  const isOwnRecord = requesterEmployeeId !== null && requesterEmployeeId === record.employeeId

  // 查自己的不需要多查一次權限碼——一律可見（計畫 §4.2）。只有查別人的才需要知道呼叫者的權限。
  let hasViewOthersPermission = false
  if (!isOwnRecord) {
    const permissionCodes = await listPermissionCodes(context.db, context.companyId, context.operatorCompanyUserId)
    hasViewOthersPermission = VIEW_OTHERS_COORDINATES_PERMISSION_CODES.some((code) => permissionCodes.has(code))
  }

  const visibility = resolveCoordinateVisibility(record.employeeId, requesterEmployeeId, hasViewOthersPermission)
  const coordinates: AttendanceRecordCoordinates = visibility.visible
    ? { visible: true, latitude: record.latitude, longitude: record.longitude }
    : { visible: false }

  return succeed({ detail: record, coordinates })
}
