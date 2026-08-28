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
  sessionsMainContext,
  sessionsMainLogin,
  sessionsMainLogout,
  type SessionsMainContextData,
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
 * 進 store 的「登入身分」：登入者、所屬公司，以及**這個成員在這家公司實際擁有的權限碼**。
 *
 * ## 為什麼形狀取自 `sessions/main/context` 而不是登入回應
 *
 * 兩支端點都回得出身分，但**只有 `context` 帶 `permissionCodes`**（登入回應是
 * `accessToken` ＋ `user` ＋ `company`）。於是有兩種接法：
 *
 * | | 作法 | 代價 |
 * |---|---|---|
 * | 甲 | store 的規範形狀就是 `context` 的形狀，登入成功後再打一次 `context` | 登入時多一次往返 |
 * | 乙 | store 收一個「權限碼可有可無」的形狀，登入走登入回應、重整走 `context` | 兩條路產出兩種身分 |
 *
 * **已定案：甲。** 決定性的理由不是往返次數，是乙那條路會讓 `permissionCodes` 變成一個
 * **有時候是空的**欄位——而空的權限碼集合在畫面上的表現是「選單少了幾項、某些頁面進不去」，
 * 那與「這個人真的沒有權限」逐字相同，不會有任何錯誤、不會有人回報。
 * 甲則讓「身分」只有一種形狀、一個產生者：無論是剛登入還是重新整理，store 拿到的是同一個東西。
 *
 * 多出來的那一次往返只發生在登入當下（每個 session 一次），而且它與登入請求是串行的兩步，
 * 不會與其他請求併發去撞 refresh 的 single-flight（§3.1）。
 */
export type SignedInIdentity = SessionsMainContextData

/**
 * 登入。
 *
 * 失敗時後端回 **422 ＋ `code='300'` ＋ `errors[0].code = 'sessions.main.errors.invalid-credentials'`**，
 * 不是 `900`（後端規範 §1.3）——因為使用者已經在登入頁了，「導向登入頁」對他不是一個動作。
 * 因此呼叫端會收到 `BusinessRuleError`，而不是被 client 導走。
 *
 * 成功時把 access token 交給記憶體保管（§5.4.3），**回傳值不含它**：
 * 呼叫端拿到的只有「登入身分與所屬公司與權限碼」，那才是能進 store 的東西（§2.1）。
 *
 * 第二步的 `context` 必須排在 `rememberAccessToken` 之後：它是已登入群組的端點，
 * 沒有 token 會直接吃一個 `900`。
 */
export const login = async (input: LoginInput): Promise<SignedInIdentity> => {
  const { accessToken } = await sessionsMainLogin(input)

  // refresh 票同時由後端以 httpOnly cookie 下發，前端讀不到也不需要讀（§5.4.3）。
  // 這一行是全前端僅有的兩處 access token 寫入之一（另一處是 client 內的 refresh）。
  rememberAccessToken(accessToken)

  return readSessionContext()
}

/**
 * 取回目前登入者的身分脈絡與權限碼。
 *
 * **這一支同時是「重新整理不掉線」的關鍵**（§3.1）：access token 只存在記憶體，重整後一定是
 * `null`，但 refresh 票是後端下發的 httpOnly cookie，瀏覽器仍然帶著它。統一 client 在收到 `900`
 * 時會自己呼叫 refresh 換一張新的 access token 再重試原請求——因此**啟動時打這一支，
 * 就等於同時完成了「用 cookie 換票」與「取回身分」兩件事**，前端不需要、也不得自行呼叫
 * refresh 端點（§3.1 明文：refresh 只做在 client 內）。
 *
 * 真的沒有有效 cookie 時它會拋 `AuthRequiredError`，那是**預期結果**（代表使用者真的沒登入），
 * 呼叫端負責把它當成「沒有身分」而不是錯誤，見 `stores/auth.ts` 的 `restoreOnce`。
 *
 * 參數是空物件而不是「沒有參數」，理由同 {@link logout}：業務欄位是空的，基底三欄由 client 補上。
 */
export const readSessionContext = (): Promise<SignedInIdentity> => sessionsMainContext({})

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
