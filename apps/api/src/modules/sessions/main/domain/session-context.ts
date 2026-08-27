/**
 * service 的執行相依（純型別，零執行期程式碼）。
 *
 * 為什麼放在 `domain/`：§0 的檔名白名單只允許 `routes`／`handler`／`service`／`repository`／
 * `errors`／`impl/`／`domain/`／`__tests__/`，**沒有一個「模組共用型別」的位置**。放進 service 入口檔
 * 會讓 `impl/` 的切片回頭 import 入口檔（形成循環相依）。（與 `employees/main/domain/employee-context.ts`
 * 的處置相同。）
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'
import type { SessionConfig } from '../../../../shared/config.ts'

export type SessionsMainContext = {
  /**
   * 資料庫連線。**交易邊界屬於 service**（§4.4）：登入與輪替都要「作廢一列 ＋ 寫入一列」，
   * 只成功一半會留下兩張有效票或零張有效票，而兩者都不會有任何錯誤訊息。
   */
  readonly db: Database
  /**
   * 可注入的「現在」（§6.2）。本模組幾乎每一個動作都在算到期時刻，
   * 底層自己抓時間的話，「票在正確的那一秒過期」這件事就永遠測不到。
   */
  readonly clock: Clock
  /**
   * 簽章金鑰與兩張票的壽命（§5.4.1）。
   *
   * **由組裝點注入而不是在這裡讀環境變數**（§1.7）：`bun run gen:api` 必須能在環境變數未設定的
   * 情況下產出契約；而讓底層自己讀，測試就得為了跑一條測試去設環境變數，
   * 「用錯金鑰簽出來的票驗不過」這條路徑也就永遠測不到。
   */
  readonly session: SessionConfig
}

/**
 * 本模組**沒有** `companyId` 在 context 裡，與其他業務模組不同。
 *
 * 理由是這個模組正是產生公司範圍的那一步（§1.9.0）：登入端點執行時 `companyId` 還不存在
 * ——它是「公司代號 ＋ 帳號 ＋ 密碼」驗證後的**產出**。把它放進 context 就得在登入時填一個假值，
 * 而假值會一路流進 access token 的 claims。其餘動作（登出、輪替）的公司範圍一律由
 * 已驗證身分逐次傳入，看得見、也對得起來源。
 */
export type SessionScope = {
  readonly companyId: string
  readonly companyUserId: string
}
