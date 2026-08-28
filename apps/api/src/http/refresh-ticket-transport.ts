/**
 * refresh 票的傳輸通道：**httpOnly + Secure + SameSite=Lax cookie**（§5.4.3）。
 *
 * 全專案只有這一個檔案知道 refresh 票是放在 cookie 裡的。端點不讀、也不寫這個 cookie
 *（§1.5：憑證的通道由認證群組規定，不是端點的契約；§8 第 23 條：`modules/**` 底下禁止讀取
 * cookie／header）——它們只透過請求上下文的 `refreshTicketDelivery` 表達「發一張新票」或「收回」。
 *
 * **三個 cookie 屬性各自擋掉一件事，一個都不能少：**
 *
 * | 屬性 | 少了它會怎樣 |
 * |---|---|
 * | `HttpOnly` | JS 讀得到 refresh 票。一次 XSS 就能同時拿走 access token（記憶體）與 refresh 票，而 §5.4.2 的偷用偵測**救不回來**——攻擊者可以自己輪替，甚至比使用者更早輪替，於是被踢出去的是使用者本人 |
 * | `Secure` | 票會在純 HTTP 連線上明文送出，中間任何一個節點都拿得到 |
 * | `SameSite=Lax` | 跨站的 POST 會帶上票，等於沒有 CSRF 防線（同源部署下 `Lax` 就是那道防線，§9 第 4 項） |
 *
 * **`SameSite` 定案為 `Lax` 而不是 `Strict`**（§5.4.3）：兩者的差別只有「從其他站台以 top-level GET
 * 導航進來時帶不帶 cookie」，而本系統所有端點都是同源的 POST XHR、一支 GET 端點都沒有，
 * 因此 `Strict` 多買到的安全性趨近於零。代價卻是實的且會在未來才發作：日後做 Email／通訊軟體通知時，
 * 使用者從信件點「前往簽核」進來就是一個跨站 top-level GET，`Strict` 之下那個請求不帶票，
 * 於是**使用者明明還登入著卻被導去登入頁**，而症狀只是「從信裡點進來每次都要重登」
 * ——沒有人會想到問題出在半年前定的 cookie 設定上。
 */
import { Elysia } from 'elysia'
import { requestContext, type RefreshTicketDelivery } from './request-context.ts'

/**
 * cookie 名稱。加前綴而不是叫 `refresh_token`：同一個網域下可能有別的服務，
 * 名字撞掉之後兩邊會互相覆寫，而症狀是「偶爾被登出」。
 */
export const REFRESH_TICKET_COOKIE_NAME = 'sundial_refresh_ticket'

/**
 * cookie 的 `Path`。
 *
 * **刻意是 `/` 而不是 `/sessions/main/refresh`**，即使 §5.4.1 說這張票只認一個端點。
 * 收窄 `Path` 看起來更嚴，實際上買不到安全（真正的限制是伺服器端只在 refresh 端點接受它，
 * 那條規則由 refresh 群組的驗證器執行），卻會讓 cookie 在別的路徑上讀不到、清不掉
 * ——登出端點的路徑不同，`Set-Cookie` 的清除指令會因為 `Path` 不符而**完全無效**，
 * 而瀏覽器不會回報任何錯誤：使用者的瀏覽器裡就留著一張永遠清不掉的票。
 */
const COOKIE_PATH = '/'

const readCookieHeader = (request: Request): string | null => request.headers.get('cookie')

/**
 * 從請求裡取出 refresh 票。**只有 refresh 群組的憑證驗證器可以呼叫它。**
 *
 * 自己切字串而不是用框架的 cookie 解析：這裡只需要一個名字對應的值，而框架的 cookie 物件
 * 帶著簽章與序列化選項，用它會讓「這個值有沒有被框架動過手腳」多一層要確認的東西。
 *
 * @returns 找不到或值為空字串時回 `null`——「沒有帶票」與「帶了一張空票」對驗證器是同一件事。
 */
export const readRefreshTicket = (request: Request): string | null => {
  const header = readCookieHeader(request)
  if (header === null) return null

  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=')
    if (separator === -1) continue
    if (entry.slice(0, separator).trim() !== REFRESH_TICKET_COOKIE_NAME) continue
    const value = entry.slice(separator + 1).trim()
    return value === '' ? null : value
  }
  return null
}

/**
 * 把交付指令翻成 `Set-Cookie` 的值。
 *
 * 收回時用 `Max-Age=0` ＋ 空值：只送空值而不帶 `Max-Age`，那會變成一個
 * **值為空字串的 session cookie**，瀏覽器仍然會在下一個請求帶上它，
 * 於是伺服器收到一張空票而不是「沒有票」——兩者在驗證器裡都會被拒，但前者會留在瀏覽器裡不走。
 */
const toSetCookieValue = (delivery: RefreshTicketDelivery): string => {
  const attributes = ['HttpOnly', 'Secure', 'SameSite=Lax', `Path=${COOKIE_PATH}`]
  if (delivery.kind === 'revoke') {
    return [`${REFRESH_TICKET_COOKIE_NAME}=`, ...attributes, 'Max-Age=0'].join('; ')
  }
  return [`${REFRESH_TICKET_COOKIE_NAME}=${delivery.ticket}`, ...attributes, `Max-Age=${delivery.maxAgeSeconds}`].join(
    '; ',
  )
}

/**
 * 傳輸層 middleware：把請求上下文裡的交付指令寫成回應的 `Set-Cookie`。
 *
 * 註冊在所有路由之前、`as: 'global'`，理由與出口層相同：發證端點（登入）與登出端點
 * **落在不同的認證群組**，掛在群組上就得掛兩次，而漏掛的那一次不會報錯
 * ——它只是「登入成功但沒有發到票」，下一次 refresh 才會失敗，離成因很遠。
 *
 * 本 hook **不回傳任何值**：Elysia 只在 `onAfterHandle` 回傳非 `undefined` 時才替換回應，
 * 因此這裡只動 `set.headers`，envelope 的組裝仍然由出口層負責（§1.8.1 的唯一產出入口）。
 */
export const refreshTicketTransport = () =>
  new Elysia({ name: 'refresh-ticket-transport' })
    .use(requestContext)
    .onAfterHandle({ as: 'global' }, (context): void => {
      const delivery = context.requestContext.refreshTicketDelivery
      if (delivery === null) return
      context.set.headers['set-cookie'] = toSetCookieValue(delivery)
    })
