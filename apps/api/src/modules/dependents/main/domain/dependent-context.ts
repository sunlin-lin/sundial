/**
 * service 的執行相依（純型別，零執行期程式碼）。形狀與 `employees/main/domain/employee-context.ts`
 * 同構：眷屬的身分證字號與員工一樣要加密＋blind index，因此同樣需要 `cipher`。
 */
import type { Database } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type DependentsMainContext = {
  readonly db: Database
  readonly cipher: FieldCipher
  readonly clock: Clock
  readonly companyId: string
  readonly operatorCompanyUserId: string
}
