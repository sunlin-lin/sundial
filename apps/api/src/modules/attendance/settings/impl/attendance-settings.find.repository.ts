/**
 * 資料存取：查詢一間公司目前的出勤設定。
 *
 * 查無資料回 `null`（§1.3「查無資料不是 404」），**別家公司的設定也回 `null`**，且兩者走的是
 * 同一行程式碼（§3.2）：公司條件由 `TenantDatabase` 寫進 `WHERE`，「存在但不屬於你」與
 * 「不存在」想寫出不一樣的回應都寫不出來。
 *
 * 這支函式同時服務兩種呼叫端：`get` 端點直接回傳它的結果；`update` 的 service 也呼叫它，
 * 用來判斷「這間公司是不是第一次存設定」（決定 insert 還是 update）。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceSettings } from '../../../../db/schema/index.ts'
import type { AttendanceSettingsDetail } from '../domain/attendance-settings-model.ts'

export const findAttendanceSettings = async (
  runner: QueryRunner,
  companyId: string,
): Promise<AttendanceSettingsDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant.select(
    {
      id: attendanceSettings.id,
      requireClockInBeforeClockOut: attendanceSettings.requireClockInBeforeClockOut,
      allowEmployeeCancellation: attendanceSettings.allowEmployeeCancellation,
      allowCorrectionRequest: attendanceSettings.allowCorrectionRequest,
      correctionRequiresApproval: attendanceSettings.correctionRequiresApproval,
      gpsEnabled: attendanceSettings.gpsEnabled,
      gpsRequired: attendanceSettings.gpsRequired,
      createdAt: attendanceSettings.createdAt,
      updatedAt: attendanceSettings.updatedAt,
    },
    attendanceSettings,
  )
  return rows[0] ?? null
}
