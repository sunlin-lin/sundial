/**
 * 底層傳輸：把一包已經組好的 request envelope 送出去，把 HTTP 回應原樣交回來。
 *
 * 這一層**刻意什麼都不懂**——不拆 envelope、不看 `code`、不管 token 過期、不做 refresh。
 * 那些全部在 client.ts 做一次（§3.1）。分成兩層的實際好處是 single-flight 的單元測試
 * 可以換掉這一層、對 client 的行為做斷言（§3.1 的檢查方式就是這樣規定的）：
 * 「有沒有收斂成一次 refresh」看程式碼形狀看不出來，只看得出跑起來發了幾次。
 *
 * **本檔是全前端唯一可以 import axios 的地方**（§3.1）。
 */
import axios from 'axios'
import { SystemFailureError } from './api-error.ts'

export type TransportRequest = {
  /** 後端端點路徑，例如 `/sessions/main/login`。同源，不帶 host。 */
  readonly path: string
  /** 已經補好 `rqTS`／`cmd`／`locale` 的完整 request envelope。 */
  readonly body: Readonly<Record<string, unknown>>
  /** 目前記憶體中的 access token；`null` 表示還沒有身分（公開端點）。 */
  readonly accessToken: string | null
}

export type TransportResponse = {
  readonly status: number
  /** 尚未驗證形狀的 body。外部邊界一律 `unknown`（通用規範 §2.2）。 */
  readonly payload: unknown
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>

const httpClient = axios.create({
  // 同源：refresh 票是 `SameSite=Lax` 的 httpOnly cookie，跨源就送不出去（後端規範 §5.4.3）。
  baseURL: '/',
  // 讓瀏覽器帶上 refresh 票的 cookie。前端讀不到那個 cookie，也不需要讀。
  withCredentials: true,
  headers: { 'content-type': 'application/json' },
  // 4xx／5xx 不丟例外：本專案的處置一律看 envelope 的 `code`，不看 HTTP status（§3.6）。
  // 讓 axios 依 status 丟例外的話，`422 + code='300'` 這種「正常的業務錯誤」
  // 會先變成一個 AxiosError，envelope 裡的 `errors` 反而要從例外物件裡挖出來。
  validateStatus: () => true,
})

export const axiosTransport: Transport = async ({ path, body, accessToken }) => {
  const headers: Record<string, string> = {}
  // 憑證走 `Authorization` header，不進 body（後端規範 §1.5）。
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`

  try {
    const response = await httpClient.post<unknown>(path, body, { headers })
    return { status: response.status, payload: response.data }
  } catch {
    // 走到這裡代表連 HTTP 回應都沒拿到（斷線、DNS、CORS、後端沒起來）。
    // 這種情況沒有 envelope 可看，一律當系統錯誤，細節不對使用者顯示（§3.6）。
    throw new SystemFailureError('無法連線至伺服器', 'network-unreachable', null)
  }
}
