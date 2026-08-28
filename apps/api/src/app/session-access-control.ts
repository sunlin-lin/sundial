/**
 * 把業務模組接到入口層的憑證驗證器上（§1.9.1、`shared/access-control.ts` 的檔頭）。
 *
 * **這是組裝，不是業務邏輯**：本檔一行判斷都沒有，只是把三個模組的 service 對到三個 port 上。
 * 它屬於 `app/` 而不是 `http/`，理由是 `shared/access-control.ts` 寫的那一條——
 * middleware 屬於入口層、模組屬於業務層，讓入口層直接 import 某個模組的查詢函式，
 * 等於把「Web 前端這個入口怎麼驗身分」與「權限資料怎麼存」綁在一起；
 * 第二種入口出現時（§1.0.2），它要換掉的是驗證方式，不該連帶把權限查詢也複製一份。
 *
 * 跨大目錄一律走對方的 `index.ts`（§0.3），因此這裡 import 的是 `modules/sessions` 與
 * `modules/company-users` 兩個出口，碰不到它們的任何內部檔案。
 *
 * **兩個 port 集合刻意分開**（`AccessControlPorts` 與 `RefreshControlPorts`），
 * 對應兩個不同的認證群組：合成一包之後，「已登入群組拿得到 refresh 票的驗證能力」
 * 在型別上就成立了，而那正是 §5.4.1「refresh 票只認一個端點」要防的事。
 */
import { listPermissionCodes } from '../modules/company-users/index.ts'
import {
  renewSession,
  revokeChainsOnReuse,
  verifyAccessToken,
  verifyRefreshTicket,
  type SessionsMainContext,
} from '../modules/sessions/index.ts'
import type { AccessControlPorts, RefreshControlPorts } from '../shared/access-control.ts'

/**
 * 已登入群組的三個 port。
 *
 * 三者的順序即執行順序（見 `http/identity-guard.ts`）：驗票 → 續期 → 查權限碼。
 * **驗票那一步已經包含 §5.4.6 的即時撤銷檢查**（在 `modules/sessions` 內部），
 * 因此這裡看不到第四個「檢查有沒有被撤銷」的 port——那不是漏了，
 * 是撤銷檢查與「這張票有效嗎」本來就是同一個問題，拆成兩個 port 只會讓其中一個被忘記呼叫。
 */
export const createAccessControlPorts = (context: SessionsMainContext): AccessControlPorts => ({
  verifyAccessToken: (accessToken) => verifyAccessToken(context, accessToken),
  // port 的簽章帶 `identity`，而續期長度與「你是誰」無關（每個人的視窗一樣長），
  // 因此這裡把它丟掉——丟在這一行是看得見的，比讓 service 收一個永遠用不到的參數好。
  renewSession: () => Promise.resolve(renewSession(context)),
  loadPermissionCodes: (companyId, companyUserId) => listPermissionCodes(context.db, companyId, companyUserId),
})

/** refresh 群組的兩個 port。偷用偵測的副作用由驗證器編排（見 `http/refresh-guard.ts`）。 */
export const createRefreshControlPorts = (context: SessionsMainContext): RefreshControlPorts => ({
  verifyRefreshTicket: (rawTicket) => verifyRefreshTicket(context, rawTicket),
  revokeAllChainsOnReuse: async (identity, reusedTicketId) => {
    // 刻意丟掉回傳值（作廢了幾條鏈）：驗證器不需要它，而把它往上傳會讓人想拿它去做判斷
    //（例如「0 條代表沒事」），但偷用偵測的結論與作廢了幾條無關——它已經發生了。
    await revokeChainsOnReuse(context, identity, reusedTicketId)
  },
})
