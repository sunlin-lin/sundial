/** 唯一鍵違反的判讀（零 IO 純函式）。理由與 `attendance/records/domain/
 * attendance-record-duplicate.ts` 同構——唯一鍵是「同一工作日、同一類型只能有一筆待審核申請」
 * 這條規則最後、也是唯一的一道保險（§4.3：唯一性檢查禁止用「先 SELECT 再 INSERT」取代資料庫
 * 唯一鍵，見 `db/schema/attendance-correction-requests.ts` 檔頭「重複申請的唯一鍵」段落）。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

const ATTENDANCE_CORRECTION_REQUEST_UNIQUE_INDEX = 'uq_attendance_correction_requests_employee_work_date_type_seq'

export type AttendanceCorrectionRequestInsertOutcome = 'inserted' | 'duplicate'

export const isDuplicateAttendanceCorrectionRequest = (error: unknown): boolean =>
  isUniqueViolation(error, ATTENDANCE_CORRECTION_REQUEST_UNIQUE_INDEX)
