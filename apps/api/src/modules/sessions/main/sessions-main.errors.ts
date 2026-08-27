/**
 * 登入狀態的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * **這個模組的錯誤字典只有一筆，而那一筆的重點全在「它刻意含糊」上**（§3.2）。
 * 把所有可能的業務拒絕放在同一頁，正是為了讓這件事看得見——拆散之後，下一個人只會看到
 * 自己那一支的錯誤，然後「順手」把訊息寫得更精確一點，而那一手就是資料外洩。
 *
 * **本模組不表達「憑證不可用」**（§3.1.1、§1.3）：`900` 的唯一產出者是認證群組的憑證驗證器，
 * service 完全不參與。`ErrorGroup` 因此維持三個值，**不為「未登入」新增第四個分組**——
 * 實作認證模組時第一個念頭一定是「登入失敗總該有個 `Unauthorized` 分組吧」，
 * 加了之後 service 從此能表達「你沒有身分」，於是 `900` 就有了第二個產出點，
 * 而那個產出點不受續期規則約束、不保證 `expiresIn` 為 `null`、也不保證 `errors` 為空。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）。
 */
import { ErrorGroup, type DomainError, type ErrorGroupValue } from '../../../shared/service-result.ts'

/**
 * 本模組的錯誤碼（§1.3 的 `<領域>.<原因>`）。
 *
 * 領域用 `auth` 而不是路徑上的 `sessions`：錯誤碼的領域與路徑段名是兩套**獨立的命名空間**（§1.3），
 * 前者是單數的功能分類，後者必須等於目錄名。寫成 `sessions.invalid-credentials` 會把
 * 「憑證錯誤」這個**跨端點**的語意綁死在單一個目錄上——日後改密碼端點（在 `credentials` 大目錄底下）
 * 要回同一種錯時就無碼可用，只能再發明一個，而前端就得為同一件事準備兩套文案。
 */
export const SessionErrorCode = {
  InvalidCredentials: 'auth.invalid-credentials',
} as const

export type SessionErrorCodeValue = (typeof SessionErrorCode)[keyof typeof SessionErrorCode]

/**
 * 登入失敗。**四種原因一律回這一筆**（§3.2）：
 * 公司代號不存在／帳號不存在／密碼錯誤／該帳號不屬於這家公司。
 *
 * **這是規格不是疏漏，請勿「修好」。** 訊息寫得更精確的後果是實的：
 * 公司代號會變成一個可枚舉的介面——任何人（連帳號都不需要）都能用一支登入端點測出
 * 系統裡有哪些公司存在，而**公司名單本身就是客戶名單**，它會直接落到競爭對手手上。
 * 「該帳號不屬於這家公司」這一種更糟：它同時洩漏了「這個帳號存在」與「它不在這家公司」，
 * 把兩份名單交叉起來。而每一次探測在系統看來都只是一次普通的登入失敗，沒有任何一層會告警。
 *
 * **分組是 `Unprocessable`（→ 422／`300`），不是也不可能是 `900`**（§1.3）：
 * 這張映射表的分類軸是「前端拿到之後該做什麼」，而**使用者已經在登入頁了**
 * ——「導向登入頁」對他不是一個動作，他該看到的是「帳號或密碼錯誤」，那是**顯示業務訊息**。
 * 回 `900` 的後果：前端對 `900` 的統一處置是「清掉手上的 token 並導向登入頁」，
 * 於是使用者按了登入、畫面閃一下又回到登入頁，錯誤訊息在導向過程中被清掉，
 * 他不會知道自己打錯了什麼。
 *
 * `data` **刻意只有 `field`，而且指向 `password`**：不回聲使用者送來的公司代號或帳號
 *（§5.1 禁止把可用於枚舉的值放進 `errors[].data`），也不指向 `companyCode` 或 `username`
 * ——指哪一格就等於告訴使用者是哪一格錯了。指向 `password` 是三個欄位裡最無資訊量的選擇：
 * 它讓前端有一個可以聚焦的欄位（使用者最可能要重打的那一格），而不洩漏任何東西。
 */
export const invalidCredentials = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: SessionErrorCode.InvalidCredentials,
  msg: '公司代號、帳號或密碼錯誤',
  data: { field: 'password' },
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 *（`http/error-boundary.ts`），業務程式碼一行都不會讀它。
 */
export type SessionErrorDeclaration = {
  readonly code: SessionErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`，其餘代碼不會帶 `errors`。 */
  readonly webFlowCode: '300'
}

const unprocessable = (code: SessionErrorCodeValue): SessionErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

/**
 * 每支端點會吐出哪些業務錯誤。
 *
 * **三支端點宣告空清單，而那是刻意的、不是忘了寫**（§1.8.3 要求空清單也必須明寫）：
 * `refresh`／`logout`／`logout-all` 的所有失敗模式都是「憑證不可用」，而那不是業務錯誤
 * ——它由認證群組的憑證驗證器就地回 `900`，**根本走不到 service**（§3.1.1）。
 * 換句話說這三支端點只要走進 handler 就一定成功，它們沒有業務規則可以不成立。
 */
export const SESSION_ENDPOINT_ERRORS = {
  login: [unprocessable(SessionErrorCode.InvalidCredentials)],
  /** 票有效就換、無效就在驗證器被擋下（`900`）。沒有中間狀態，也就沒有業務錯誤。 */
  refresh: [],
  /** 走到這裡代表 access token 已經驗過了；作廢是無條件的，重複登出也不是錯誤（見 service）。 */
  logout: [],
  'logout-all': [],
} as const satisfies Record<string, readonly SessionErrorDeclaration[]>

/**
 * 把宣告清單轉成 OpenAPI 的 `description` 文字。
 *
 * 清單必須進契約（§1.8.3），而 Elysia 的 `detail` 只吃標準 OpenAPI 欄位；塞進 `description`
 * 是目前唯一不需要自訂擴充欄位就能讓前端看到這份清單的位置。
 */
export const describeSessionErrors = (declarations: readonly SessionErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
