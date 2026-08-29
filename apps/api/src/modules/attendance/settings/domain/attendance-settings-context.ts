/**
 * service 的執行相依（純型別，零執行期程式碼）。形狀比照 `labor-pension/main/domain/
 * labor-pension-context.ts`：帶 `operatorCompanyUserId` 是因為 `update` 會寫稽核
 * （`recordAudit` 的 `actor` 需要操作者的 `company_user` id），`get` 用不到但共用同一個
 * context 型別——理由與其他模組相同：`get`／`update` 是同一個次實體的兩個動作，不必為
 * 「這支要不要稽核」拆成兩種 context。
 *
 * 為什麼放在 `domain/`：§0 的檔名白名單只允許 `routes`／`handler`／`service`／`repository`／
 * `errors`／`impl/`／`domain/`／`__tests__/`，沒有一個「模組共用型別」的位置。放進 service
 * 入口檔會讓 `impl/` 的切片回頭 import 入口檔（形成循環相依）。
 *
 * **沒有 `cipher`**：出勤設定不含個資欄位，不需要欄位加解密器。
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type AttendanceSettingsContext = {
  /** 資料庫連線。交易邊界屬於 service（§4.4），因此 service 拿到的是連線本身而不是交易物件。 */
  readonly db: Database
  /** 可注入的「現在」（§6.2）。業務程式碼禁止直接 `new Date()`。 */
  readonly clock: Clock
  /** 公司範圍。只能來自已驗證的 token（§4.2）。 */
  readonly companyId: string
  /** 操作者的 company_user id。供 `update` 寫稽核時標記 `actor`（§5.3）。 */
  readonly operatorCompanyUserId: string
}
