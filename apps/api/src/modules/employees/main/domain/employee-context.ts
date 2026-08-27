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
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type EmployeesMainContext = {
  /**
   * 資料庫連線。**交易邊界屬於 service**（§4.4），因此 service 拿到的是連線本身而不是交易物件
   * ——repository 不自開交易，否則巢狀時無法合併成一個原子操作。
   */
  readonly db: Database
  /**
   * 欄位加解密器（§5.1）。
   *
   * **由組裝點注入而不是由 repository 自己建立**，理由與 clock 相同：金鑰來自環境變數，
   * 讓底層自己去讀，測試就得為了跑一條測試去設環境變數，而「金鑰設錯」這條路徑也就永遠測不到。
   * 注入之後，「用哪一把金鑰」是一個在組裝點看得見、可以被質疑的決定。
   */
  readonly cipher: FieldCipher
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
}
