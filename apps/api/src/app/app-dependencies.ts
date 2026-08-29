/**
 * 應用程式組裝所需的全部外部資源（純型別，零執行期程式碼）。
 *
 * **獨立成一個檔案，而不是留在 `app.ts` 裡**：`app.ts` import `routes.ts`（要掛路由），
 * 而 `routes.ts` 也需要這份型別——留在 `app.ts` 就是一個檔案層級的循環相依。
 * 型別在編譯後會完全消失，因此這個循環在執行期不會出事；但它會出現在相依圖上，
 * 而「循環相依只是型別、應該沒關係」這種例外一旦被接受，下一次就會有人拿它來擺一個值。
 *
 * **每一項都由呼叫端注入，本檔與 `app.ts` 都不自己建立**（§1.7）：`bun run gen:api` 必須能在
 * 後端服務未啟動、資料庫未連線、環境變數未設定的情況下產出契約。只要有任何一項在模組層
 * 初始化，那個指令就會在新人的第一天失敗，結果是「跑不起來，先沿用舊型別」——
 * 契約單一來源等於沒有。
 */
import type { Database } from '../db/client.ts'
import type { FieldCipher } from '../db/field-encryption.ts'
import type { AccessControlPorts, RefreshControlPorts } from '../shared/access-control.ts'
import type { Clock } from '../shared/clock.ts'
import type { SessionConfig } from '../shared/config.ts'

export type AppDependencies = {
  /**
   * 可注入的「現在」（§6.2）。業務程式碼禁止直接 `new Date()`：底層自己抓時間，
   * 跨日、月底、票在正確的那一秒過期這類邏輯就根本無法測試。
   */
  readonly clock: Clock
  /**
   * 資料庫連線。**公司範圍不在這裡**（§4.2）——它只能來自每一次請求的已驗證身分，
   * 放進組裝點就變成整個服務共用一個值，而那正是跨公司外洩的形狀。
   */
  readonly database: Database
  /**
   * 欄位加解密器（§5.1 現況：應用層欄位加密已移除，本欄位目前沒有任何業務路由在用）。
   *
   * **這一輪過渡期刻意保留，不拆掉**：`index.ts` 的金鑰啟動自檢（`assertFieldEncryptionKeys`）
   * 與回填腳本（`apps/api/scripts/backfill-plaintext.ts`）都還需要它——回填要解密舊資料裡的
   * 密文欄位，解密需要金鑰環與 `FieldCipher`，而金鑰的合法性檢查放在服務啟動流程比放在一支
   * 獨立腳本裡更早攔下設定錯誤。下一輪確認回填無誤、drop 掉 `*_encrypted`／`*_hash` 舊欄位之後，
   * 這個欄位、`db/field-encryption.ts` 與這一段啟動自檢會一併移除。
   */
  readonly cipher: FieldCipher
  /**
   * 簽章金鑰與兩張票的壽命（§5.4.1）。與 `cipher` 同理由由外面帶進來。
   */
  readonly session: SessionConfig
  /**
   * 已登入群組的憑證驗證相依（驗票 → 續期 → 查權限碼）。
   *
   * **與 `refreshControl` 刻意分成兩包**：合成一包之後，「已登入群組拿得到 refresh 票的驗證能力」
   * 在型別上就成立了，而那正是 §5.4.1「refresh 票只認一個端點」要防的事。
   */
  readonly accessControl: AccessControlPorts
  /** refresh 群組的憑證驗證相依（驗票 ＋ 偷用時全鏈作廢）。 */
  readonly refreshControl: RefreshControlPorts
}
