/**
 * 資料存取：新增一筆出勤設定（一間公司的第一筆，等同「建立」）。
 *
 * **唯一性由資料庫的唯一鍵擋，不做「先 SELECT 再 INSERT」**（§4.3）：呼叫端（`impl/
 * attendance-settings.update.service.ts`）已經在同一交易內查過一次「這間公司有沒有設定」，
 * 但那次查詢與這次 insert 之間仍有併發窗口——兩個人同時對同一間「還沒有設定」的公司送出
 * 第一次 `update`，都會查到 `null`，然後都嘗試 insert。這裡攔住第二個。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceSettings } from '../../../../db/schema/index.ts'
import {
  isDuplicateAttendanceSettingsCompany,
  type AttendanceSettingsInsertOutcome,
} from '../domain/attendance-settings-duplicate.ts'
import type { AttendanceSettingsToggles } from '../domain/attendance-settings-model.ts'

export type NewAttendanceSettings = AttendanceSettingsToggles & {
  readonly id: string
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。同時作為 createdAt 與 updatedAt。 */
  readonly now: string
}

export const insertAttendanceSettings = async (
  runner: QueryRunner,
  companyId: string,
  settings: NewAttendanceSettings,
): Promise<AttendanceSettingsInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(attendanceSettings, (scopedCompanyId) => ({
      id: settings.id,
      companyId: scopedCompanyId,
      requireClockInBeforeClockOut: settings.requireClockInBeforeClockOut,
      allowEmployeeCancellation: settings.allowEmployeeCancellation,
      allowCorrectionRequest: settings.allowCorrectionRequest,
      correctionRequiresApproval: settings.correctionRequiresApproval,
      gpsEnabled: settings.gpsEnabled,
      gpsRequired: settings.gpsRequired,
      createdAt: settings.now,
      updatedAt: settings.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateAttendanceSettingsCompany(error)) return 'duplicate-company'
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋，保留堆疊與成因。
    throw error
  }
}
