/**
 * 資料存取：更新既有的出勤設定。
 *
 * **這裡刻意不檢查影響列數**（與 `departments-main.update-profile.repository.ts` 同一個理由，
 * 處置逐字相同）：§4.4 的「條件式 UPDATE ＋ 檢查影響列數」是為了偵測**狀態變更**的併發衝突，
 * 而這六個開關都是使用者直接設定的明文值，不是需要保護的狀態機——兩個管理者前後幾秒各自
 * 儲存一次，後寫的覆蓋先寫的是預期行為（最後儲存的畫面內容生效），不是需要回報衝突的錯誤。
 * 這張表也沒有軟刪除（`db/schema/attendance-settings.ts` 檔頭已說明理由），因此連
 * 「寫回一筆已刪除的列」這個要另外擋的情況都不存在。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceSettings } from '../../../../db/schema/index.ts'
import type { AttendanceSettingsToggles } from '../domain/attendance-settings-model.ts'

export type AttendanceSettingsProfileUpdate = AttendanceSettingsToggles & {
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const updateAttendanceSettingsProfile = async (
  runner: QueryRunner,
  companyId: string,
  id: string,
  update: AttendanceSettingsProfileUpdate,
): Promise<void> => {
  const tenant = new TenantDatabase(runner, companyId)

  await tenant.update(
    attendanceSettings,
    {
      requireClockInBeforeClockOut: update.requireClockInBeforeClockOut,
      allowEmployeeCancellation: update.allowEmployeeCancellation,
      allowCorrectionRequest: update.allowCorrectionRequest,
      correctionRequiresApproval: update.correctionRequiresApproval,
      gpsEnabled: update.gpsEnabled,
      gpsRequired: update.gpsRequired,
      updatedAt: update.now,
    },
    eq(attendanceSettings.id, id),
  )
}
