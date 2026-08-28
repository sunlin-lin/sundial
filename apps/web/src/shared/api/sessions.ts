/**
 * 登入與登出。
 *
 * **本檔沒有任何描述 API 形狀的型別宣告，也沒有任何手寫的請求組裝**（§3.2、§0.10）：
 * 請求／回應型別與呼叫函式全部來自 `bun run gen:api` 的產生物（`api/generated/api-client.ts`），
 * 它由後端路由 schema 產出（後端規範 §1.7）。後端把某個欄位改成另一種形狀之後，
 * 這裡會是**編譯錯誤**，而不是執行期畫面上的 `undefined`。
 *
 * **那為什麼還留著這個檔案。** 產生的 client 只負責型別、指令名與傳輸，它不知道、也不該知道
 * 「登入成功之後 access token 要交給誰保管」「登出之後要清掉什麼」——那是 session 的規則，
 * 不是端點的契約。這兩件事若散到頁面裡，會變成每個呼叫登入／登出的地方各自記得做一次，
 * 而漏做的那一頁不會編譯失敗，只會讓使用者停在一個看起來已登出、實際上還握著 token 的狀態。
 *
 * 因此本檔剩下的職責只有一件：**把「產生的端點呼叫」與「session 的副作用」綁在一起**。
 * 它不是 API 包裝層——沒有型別、沒有欄位對應、沒有 envelope 處理，那些全在產生物與統一 client 內。
 *
 * 產生物不存在時本檔會編譯失敗（找不到 `api/generated/api-client.ts`）。那是預期行為：
 * 契約產生物不進版控（後端規範 §1.7），clone 下來的第一件事就是 `bun run gen:api`。
 */
import { rememberAccessToken } from './access-token.ts'
import { discardSession } from './client.ts'
import {
  sessionsMainLogin,
  sessionsMainLogout,
  type SessionsMainLoginData,
  type SessionsMainLoginInput,
} from '../../api/generated/api-client.ts'

/**
 * 登入要送的業務欄位。
 *
 * 直接沿用產生型別而不是另外宣告一份（§3.2）。取一個本地名字是為了讓頁面與表單程式碼
 * 不必寫出 `SessionsMainLoginInput` 這個由端點路徑機械推導出來的名字——
 * **它是別名，不是複製**：後端加一個必填欄位，這個別名當下就跟著變，
 * 而組不出那個欄位的呼叫端會編譯失敗。
 */
export type LoginInput = SessionsMainLoginInput

/**
 * 登入成功後拿到的「登入身分與所屬公司」。
 *
 * 由產生的 response `data` 型別**去掉 `accessToken`** 推導而來。去掉是刻意的：
 * token 在下面就交給記憶體保管了（§5.4.3），不該再有第二個管道讓它流進 store 或畫面
 * ——把它留在回傳型別上，等於留一條「有人順手把它存進 Pinia」的路，而那條路沒有任何檢查擋著。
 */
export type SignedInIdentity = Omit<SessionsMainLoginData, 'accessToken'>

/**
 * 登入。
 *
 * 失敗時後端回 **422 ＋ `code='300'` ＋ `errors[0].code = 'sessions.main.errors.invalid-credentials'`**，
 * 不是 `900`（後端規範 §1.3）——因為使用者已經在登入頁了，「導向登入頁」對他不是一個動作。
 * 因此呼叫端會收到 `BusinessRuleError`，而不是被 client 導走。
 *
 * 成功時把 access token 交給記憶體保管（§5.4.3），**回傳值不含它**：
 * 呼叫端拿到的只有「登入身分與所屬公司」，那才是能進 store 的東西（§2.1）。
 */
export const login = async (input: LoginInput): Promise<SignedInIdentity> => {
  const { accessToken, ...identity } = await sessionsMainLogin(input)

  // refresh 票同時由後端以 httpOnly cookie 下發，前端讀不到也不需要讀（§5.4.3）。
  // 這一行是全前端僅有的兩處 access token 寫入之一（另一處是 client 內的 refresh）。
  rememberAccessToken(accessToken)
  return identity
}

/**
 * 登出。
 *
 * 不論後端怎麼回，**記憶體中的 token 一律清掉**：使用者按了登出就是要離開，
 * 讓一個「登出失敗」的錯誤把他留在已登入狀態，是他最不預期的結果。
 * 後端那一側的作廢是整條輪替鏈（後端規範 §5.4.7），與這裡清不清無關。
 *
 * 參數是空物件而不是「沒有參數」：登出端點的 body 只有基底三欄（後端規範 §1.5，
 * access token 是憑證、不是業務參數），而基底三欄由統一 client 補上，
 * 於是產生的函式簽章上剩下的就是一包沒有欄位的業務參數。
 */
export const logout = async (): Promise<void> => {
  try {
    await sessionsMainLogout({})
  } finally {
    discardSession()
  }
}
