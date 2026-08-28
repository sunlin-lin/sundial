/**
 * 登入狀態的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自落在哪個認證群組、收什麼、回什麼**。
 *
 * **本模組的五支端點分屬三個認證群組，因此匯出三個 plugin 而不是一個**——這是本模組與其他模組
 * 最大的形狀差異，理由必須寫清楚：認證方式是**群組的屬性**（§1.9.1），群組由路由組裝點建立（§1.9）。
 * 五支端點擠在同一個 plugin 裡的話，組裝點只能把整包掛進**某一個**群組，
 * 於是「登入需要 access token」或「登出不需要身分」兩者必居其一——而後者是一個沉默的安全漏洞。
 * 拆成三個匯出之後，「哪一支落在哪一組」在組裝點是三行看得見的程式碼，掛錯就是掛不上。
 *
 * | 端點 | 認證群組 | 憑證來源 | 續期行為 |
 * |---|---|---|---|
 * | `/sessions/main/login` | 公開群組 | **無** | 不續期（但會**發證**，§1.3 來源②） |
 * | `/sessions/main/refresh` | refresh 群組 | refresh 票 cookie | 不續期，改為**發證** |
 * | `/sessions/main/logout` | 已登入群組 | access token | 續期（但成功後清成 `null`，§1.3） |
 * | `/sessions/main/logout-all` | 已登入群組 | access token | 同上 |
 * | `/sessions/main/context` | 已登入群組 | access token | 續期 |
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1），也看不到權限碼（§5.2.2：
 * 它等於路徑的機械轉換，由身分驗證 middleware 自己推導），更看不到 cookie
 *（§1.5：憑證的通道是群組的契約）。
 *
 * **三個 plugin 各自 `.use(refreshTicketTransport())`，這一行不是裝飾。** 那個 plugin 是
 * 「把新票交給客戶端／把舊票收回」的實際執行者（通道細節全在它裡面，本檔完全不知道那是 cookie）。
 * 交給路由組裝點去掛的話，它就變成一個**必須記得掛、漏掛不會報錯**的東西——症狀是
 * 「登入成功但沒有發到票」，而錯誤要到兩小時後第一次換票才會出現，離成因非常遠。
 * 而本模組的端點分屬三個群組，掛在群組上等於要掛三次，漏掉其中一次更難發現。
 * 寫在這裡，「這些端點要能交付票」就與端點本身綁在一起，而 Elysia 依 plugin 名稱去重，
 * 組裝點若也掛了一次不會有任何副作用。
 *
 * **四支端點的 body 只有基底三欄**，這是 §1.5 的直接結果：access token 與 refresh 票是**憑證**，
 * 不是業務參數，一律不走 body。判準是「拿掉它之後，這支端點還知不知道要做什麼」——
 * 拿掉 refresh 票，`/refresh` 仍然知道自己要換一張票，只是不知道要換誰的。
 * 反過來 `login` 的三個欄位是業務參數：拿掉密碼，登入端點就不知道要驗什麼。
 */
import { Elysia, t } from 'elysia'
import { refreshTicketTransport } from '../../../http/refresh-ticket-transport.ts'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, Uuid } from '../../../shared/field-schemas.ts'
import {
  handleLogin,
  handleLogout,
  handleLogoutAll,
  handleRefresh,
  handleSessionContext,
  type SessionsMainDependencies,
} from './sessions-main.handler.ts'
import { describeSessionErrors, SESSION_ENDPOINT_ERRORS } from './sessions-main.errors.ts'

/**
 * 公司代號。長度上限對齊 `companies.company_code` 的 `VARCHAR(32)`。
 *
 * 樣式限制成英數：這個值是使用者要一個字一個字鍵進登入頁的識別字串，
 * 允許空白與全形字元之後，「A001」與「A 001」「Ａ００１」會是三個不同的輸入，
 * 而畫面上看起來幾乎一樣——而登入失敗的訊息刻意含糊（§3.2），使用者沒有任何線索可以自己發現。
 *
 * 註：§2 要求共用欄位型別集中在 `shared/field-schemas.ts`，但下列幾個都是**登入特有**的欄位，
 * 不在 §2 列舉的共用清單內，且目前只有本模組用得到（比照 `employees-main.routes.ts` 的處置）。
 * `credentials/main/*` 落地時 `Username`／`Password` 應該升格上去（已寫進交付回報）。
 */
const CompanyCode = t.String({ minLength: 1, maxLength: 32, pattern: '^[A-Za-z0-9]+$' })

/** 登入帳號。長度上限對齊 `users.username` 的 `VARCHAR(64)`。 */
const Username = t.String({ minLength: 1, maxLength: 64 })

/**
 * 密碼。
 *
 * **只驗長度，不驗複雜度**：密碼複雜度政策尚未定案（§9 第 3 項），而在登入端點驗複雜度是錯的
 * ——政策改嚴之後，所有舊密碼的持有者會在登入時被 400 擋下，**而且他們無法自救**
 *（改密碼端點也要先登入）。複雜度屬於「設定密碼」那一端的規則，不屬於「驗證密碼」這一端。
 * 上限 200 不是政策而是防護：不設上限的話，一段 1MB 的字串會讓 Argon2id 空轉一段可觀的時間，
 * 而那是一支公開端點——任何人都打得到。
 */
const Password = t.String({ minLength: 1, maxLength: 200 })

/** 顯示名稱。可能是員工姓名，也可能是帳號（沒有綁員工的外部協作者）。 */
const DisplayName = t.String()

/** 公司名稱。長度上限對齊 `companies.name` 的 `VARCHAR(128)`。 */
const CompanyName = t.String({ maxLength: 128 })

/**
 * access token。
 *
 * **回應裡只有這一張票，沒有 refresh 票**（§5.4.3）：refresh 票只走 `httpOnly` cookie，
 * 放進 response body 的那一刻 `httpOnly` 就等於沒有設，一次 XSS 就能同時拿走兩張票，
 * 而 §5.4.2 的偷用偵測**救不回來**——攻擊者可以自己輪替，甚至比使用者更早輪替，
 * 於是被作廢、被要求重登的是使用者本人。
 */
const AccessToken = t.String({ minLength: 1 })

/**
 * 每支端點都可能出現的非業務回應。
 *
 * §2 要求 `response` 涵蓋該端點可能回的每一種狀態碼。`401` 由憑證驗證器就地產出
 *（§1.9.1 規定的固定形狀，代碼是 `WebFlowCode.AuthRequired`；**那個字面值不出現在 `modules/**`**，
 * §8 第 18 條），`500` 由統一 error handler 產出，兩者的 `data` 恆為 `null`、`errors` 恆為空陣列。
 */
const CommonFailureResponses = {
  401: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/**
 * 四支端點共用的 body 形狀：**只有基底三欄**。
 *
 * `cmd` 由各端點收窄成自己的字面值（§1.3 的機械推導），因此這裡不含它。
 */
const credentialOnlyBody = <TCommand extends string>(command: TCommand) =>
  t.Object({ ...BaseRequest, cmd: t.Literal(command) })

/**
 * 公開群組的端點：登入。
 *
 * 落在公開群組**不是特例**（§1.9.0）：它是用來**取得**憑證的，執行時本來就沒有憑證。
 * 它與其他公開端點的唯一差別是它會觸發發證元件，而那是端點自己的業務。
 */
export const sessionsMainPublicRoutes = (dependencies: SessionsMainDependencies) =>
  new Elysia({ name: 'sessions-main-public-routes' })
    .use(requestContext)
    .use(refreshTicketTransport())
    .post('/sessions/main/login', (context) => handleLogin(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('sessions.main.login'),
        // `companyCode` **不是** `companyId`（§4.2）：前者是使用者鍵入、待伺服器驗證的字串，
        // 只允許出現在登入端點的 body；後者任何端點都不得出現，一律由已驗證的 token 決定。
        // 兩者的界線就在信任方向：這裡是「客戶端提出主張、伺服器驗證」。
        companyCode: CompanyCode,
        username: Username,
        password: Password,
      }),
      response: {
        200: envelope(
          t.Object({
            accessToken: AccessToken,
            user: t.Object({ id: Uuid, companyUserId: Uuid, displayName: DisplayName }),
            company: t.Object({ id: Uuid, companyCode: CompanyCode, name: CompanyName }),
          }),
        ),
        // 登入失敗走 422／`300`（§1.3、§3.2）：使用者已經在登入頁了，「導向登入頁」對他不是一個動作，
        // 他該看到的是「帳號或密碼錯誤」——那是顯示業務訊息，對應的 `code` 是 `300`。
        422: envelope(t.Null()),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '登入',
        description: `${describeSessionErrors(SESSION_ENDPOINT_ERRORS.login)} 成功時另以 httpOnly + Secure + SameSite=Lax cookie 交付 refresh token（§5.4.3），response body 不含該票。`,
      },
    })

/**
 * refresh 群組的端點：換發 access token。
 *
 * **這個群組只有這一支端點**，而那是刻意的（§5.4.1）：refresh 票只認一個端點，
 * 它出現在其他請求上一律視為錯誤而不是「順便也能用」。
 */
export const sessionsMainRefreshRoutes = (dependencies: SessionsMainDependencies) =>
  new Elysia({ name: 'sessions-main-refresh-routes' })
    .use(requestContext)
    .use(refreshTicketTransport())
    .post('/sessions/main/refresh', (context) => handleRefresh(dependencies, context), {
      body: credentialOnlyBody('sessions.main.refresh'),
      response: {
        200: envelope(t.Object({ accessToken: AccessToken })),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '換發 access token（一次性輪替）',
        description: `${describeSessionErrors(SESSION_ENDPOINT_ERRORS.refresh)} 每次換票同時換發新的 refresh token 並立即作廢舊票（§5.4.2）；已作廢的票再次被使用一律視為外洩，該成員所有登入即時作廢。`,
      },
    })

/**
 * 已登入群組的端點：登出、登出所有裝置、查詢身分脈絡。
 *
 * 三支都有權限碼（`sessions.main.logout`／`sessions.main.logout-all`／`sessions.main.context`，
 * 由路徑機械推導，§5.2.2），因此角色設定必須授予它們，否則使用者登不出去、也重建不了身分。
 * 「登出總不用權限吧」這個直覺為什麼要被拒絕，寫在
 * `drizzle/0008_seed_permission_codes_sessions.sql` 的檔頭；`context` 是同一個道理——
 * 權限碼由路徑推導**沒有例外分支**（§5.2.2），開一個「這支不用」的口子，
 * 「權限碼必須等於路徑轉換結果」這條檢查就當場失效，而且是靜默失效。
 */
export const sessionsMainAuthenticatedRoutes = (dependencies: SessionsMainDependencies) =>
  new Elysia({ name: 'sessions-main-authenticated-routes' })
    .use(requestContext)
    .use(refreshTicketTransport())
    .post('/sessions/main/logout', (context) => handleLogout(dependencies, context), {
      body: credentialOnlyBody('sessions.main.logout'),
      response: {
        // 成功時 `expiresIn` 為 `null`（§1.3）：本次回應之後客戶端手上沒有有效的 access token。
        200: envelope(t.Object({ ok: t.Literal(true) })),
        403: envelope(t.Null()),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '登出（作廢整條輪替鏈）',
        description: `${describeSessionErrors(SESSION_ENDPOINT_ERRORS.logout)} 作廢的是這次登入的整條輪替鏈而不是手上那一張票（§5.4.7），且 access token 即時失效（§5.4.6）。`,
      },
    })
    .post('/sessions/main/logout-all', (context) => handleLogoutAll(dependencies, context), {
      body: credentialOnlyBody('sessions.main.logout-all'),
      response: {
        200: envelope(t.Object({ ok: t.Literal(true) })),
        403: envelope(t.Null()),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '登出所有裝置',
        description: `${describeSessionErrors(SESSION_ENDPOINT_ERRORS['logout-all'])} 作廢本人在本公司的所有登入，含當前這台裝置，沒有例外。`,
      },
    })
    .post('/sessions/main/context', (context) => handleSessionContext(dependencies, context), {
      body: credentialOnlyBody('sessions.main.context'),
      response: {
        200: envelope(
          t.Object({
            user: t.Object({ id: Uuid, companyUserId: Uuid, displayName: DisplayName }),
            company: t.Object({ id: Uuid, companyCode: CompanyCode, name: CompanyName }),
            /**
             * 這個成員在這家公司**實際擁有**的權限碼，不是全部權限碼清單（任務三）。
             * 已排序（見 `sessions-main.handler.ts` 的 `toSessionContextData`）。
             */
            permissionCodes: t.Array(t.String({ minLength: 1 })),
          }),
        ),
        403: envelope(t.Null()),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢目前登入者的身分脈絡與權限碼',
        description:
          `${describeSessionErrors(SESSION_ENDPOINT_ERRORS.context)}` +
          ' 供前端在重新整理或直接開網址時重建身分（判斷是否已登入）與權限（判斷選單顯示與路由守衛）；' +
          ' 回應形狀與登入端點的 user／company 一致，另外多一份 permissionCodes。',
      },
    })
