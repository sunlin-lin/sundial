/**
 * 唯一鍵違反的判讀（零 IO 純函式）。理由與 `departments/main/domain/department-duplicate.ts` 同構
 * ——§4.3 禁止用「先 SELECT 再 INSERT」取代資料庫唯一鍵，這裡負責把驅動丟出來的例外翻譯成
 * 「撞到哪一個唯一鍵」。
 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

/**
 * `employee_employments` 的「同一員工同一天」唯一鍵。這一條只擋最常見的同日重複，
 * **不是完整的期間重疊防線**——真正的防線是 `SELECT ... FOR UPDATE`（見
 * `impl/employments-main.create.service.ts`），這一條唯一鍵是最後一道保險。
 */
const EMPLOYMENT_HIRE_DATE_UNIQUE_INDEX = 'uq_employee_employments_employee_hire_date'

export type EmploymentInsertOutcome = 'inserted' | 'duplicate-hire-date'

export const isDuplicateEmploymentHireDate = (error: unknown): boolean =>
  isUniqueViolation(error, EMPLOYMENT_HIRE_DATE_UNIQUE_INDEX)
