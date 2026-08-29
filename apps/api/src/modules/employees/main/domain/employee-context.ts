/**
 * service 的執行相依（純型別，零執行期程式碼）。
 *
 * 為什麼放在 `domain/`：§0 的檔名白名單只允許 `routes`／`handler`／`service`／`repository`／
 * `errors`／`impl/`／`domain/`／`__tests__/`，**沒有一個「模組共用型別」的位置**。放進 service 入口檔
 * 會讓 `impl/` 的切片回頭 import 入口檔（形成循環相依），放進 repository 入口檔則要把 `clock`
 * 塞進一個資料存取的型別裡。`domain/` 是唯一剩下的位置，而本檔只有型別、編譯後完全消失，
 * 仍然符合「零 IO」。（與 `roles/main/domain/role-context.ts` 的處置相同。）
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type EmployeesMainContext = {
  /**
   * 資料庫連線。**交易邊界屬於 service**（§4.4），因此 service 拿到的是連線本身而不是交易物件
   * ——repository 不自開交易，否則巢狀時無法合併成一個原子操作。
   */
  readonly db: Database
  /**
   * 可注入的「現在」（§6.2）。業務程式碼禁止直接 `new Date()`：底層自己抓時間，
   * 跨日、月底這類邏輯就根本無法測試。
   */
  readonly clock: Clock
  /**
   * 公司範圍。**只能來自已驗證的 token**（§4.2）——一旦它來自 request body，
   * 任何人改一個字串就能讀別家公司的資料，那是本系統最嚴重的單點風險。
   */
  readonly companyId: string
  /**
   * 執行本次操作的人（稽核用，稽核計畫 §5）。**只能來自已驗證的 token**，與 `companyId` 同一個
   * 道理——寫進 `audit_logs.actor_company_user_id` 的值若能被使用者操控，稽核紀錄就可以被
   * 冒名。命名比照 `company-users/roles` 的 `RoleAssignmentContext.operatorCompanyUserId`。
   */
  readonly operatorCompanyUserId: string
}
