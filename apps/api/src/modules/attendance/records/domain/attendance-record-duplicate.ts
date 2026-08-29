/** 唯一鍵違反的判讀（零 IO 純函式）。理由與 `employments/job-title-histories/domain/
 * job-title-history-duplicate.ts` 同構——唯一鍵是配對／重複檢查之外最後一道保險（計畫 §4.5）。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

const ATTENDANCE_RECORD_UNIQUE_INDEX = 'uq_attendance_records_employee_work_date_type_seq'

export type AttendanceRecordInsertOutcome = 'inserted' | 'duplicate'

export const isDuplicateAttendanceRecord = (error: unknown): boolean =>
  isUniqueViolation(error, ATTENDANCE_RECORD_UNIQUE_INDEX)
