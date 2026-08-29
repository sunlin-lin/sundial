/**
 * 唯一鍵違反的判讀（零 IO 純函式）。比照 `departments/main/domain/department-duplicate.ts`。
 *
 * §4.3：唯一性檢查禁止用「先 SELECT 再 INSERT」取代資料庫唯一鍵——兩個併發請求會同時查到
 * 「沒有」，然後都寫進去。正確作法是直接寫入並攔截唯一鍵違反。
 *
 * 這裡撞到的不是「代碼重複」而是「這間公司已經有一筆設定了」：兩個人同時對一間**還沒有存過
 * 設定**的公司送出第一次 `update`，都會在 `findAttendanceSettings` 讀到 `null`，然後都嘗試
 * insert。先到的成功，後到的撞 `uq_attendance_settings_company_id`——這正是這張表「一間公司
 * 一筆」的唯一保證發揮作用的時刻（完整推論見 `db/schema/attendance-settings.ts` 檔頭）。
 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

/** `attendance_settings` 的公司唯一鍵（migration 與 `db/schema/attendance-settings.ts` 逐字相同的名稱）。 */
const ATTENDANCE_SETTINGS_COMPANY_UNIQUE_INDEX = 'uq_attendance_settings_company_id'

export type AttendanceSettingsInsertOutcome = 'inserted' | 'duplicate-company'

export const isDuplicateAttendanceSettingsCompany = (error: unknown): boolean =>
  isUniqueViolation(error, ATTENDANCE_SETTINGS_COMPANY_UNIQUE_INDEX)
