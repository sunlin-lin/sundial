/**
 * 登入狀態的端點 handler（§1.8.0 的④與⑥）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * **本模組的 handler 比別人多做一件事：觸發發證的後續處理**（§1.3 來源②）。
 * 那件事仍然**不是「自己填 envelope 欄位」**——§1.8.2 的禁令一字不改：
 * handler 一個 envelope 欄位都沒碰，它只是把生命週期元件算好的結果放進請求上下文那一格
 *（`http/session-lifetime.ts` 的四個具名函式），由出口層去讀。
 * §1.3 說得很清楚：「誰簽發 token」與「誰填 envelope 欄位」是兩件事。
 *
 * **這裡看不到 cookie 兩個字**（§1.5、§8 第 23 條）：refresh 票的通道是認證群組的契約，
 * 不是端點的契約。handler 只說「交付這張票」或「收回票」，通道由入口層的傳輸層負責。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestContext, RequestSession, VerifiedRefreshTicket } from '../../../http/request-context.ts'
import {
  deliverRefreshTicket,
  endSession,
  recordIssuedSession,
  withdrawRefreshTicket,
} from '../../../http/session-lifetime.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import type { SessionsMainContext } from './domain/session-context.ts'
import type { IssuedLifetime, IssuedTokens, LoginOutcome, RefreshOutcome } from './domain/session-model.ts'
import { login, logout, logoutAllDevices, refreshSession } from './sessions-main.service.ts'

/** 由組裝點注入的相依。公司範圍不在裡面——本模組正是產生公司範圍的那一步（§1.9.0）。 */
export type SessionsMainDependencies = SessionsMainContext

/**
 * handler 需要的請求上下文。
 *
 * 刻意宣告成**結構型別**而不是 import Elysia 的 context 型別：這裡真正需要的只有三樣東西，
 * 而 Elysia 的 context 型別帶著一長串泛型參數，寫進每一支 handler 的簽章之後，
 * 框架版本一升級就要逐支改。傳進來的實際物件欄位更多，結構相容即可。
 */
export type EndpointContext<TBody> = {
  readonly body: TBody
  /** 只用來設定 HTTP status；status 與 envelope `code` 是同一次映射一起決定的（§1.8.1）。 */
  readonly set: { status?: number | string }
  readonly requestContext: RequestContext
}

/** handler 的回傳：envelope 的**前半段**。成功與失敗都是這一種形狀（§1.8.4）。 */
type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/**
 * 取出本次請求的已驗證身分（已登入群組）。
 *
 * `session` 為 `null` 代表這支端點沒有掛在已登入群組上（§1.9.2）——那是**程式組裝錯誤**，
 * 不是使用者做錯了什麼，因此走例外路徑（§3.1.2）：回一個業務錯誤會讓這個漏洞看起來像
 * 一次普通的操作失敗，而它其實是「這支端點沒有驗身分」。
 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('登入狀態端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

/** 取出本次請求已消耗的 refresh 票（refresh 群組）。理由同 {@link requireIdentity}。 */
const requireRefreshTicket = (ticket: VerifiedRefreshTicket | null): VerifiedRefreshTicket => {
  if (ticket === null) {
    throw new Error('換票端點取不到已驗證的 refresh 票：該端點未掛在 refresh 群組內（§1.9.2）')
  }
  return ticket
}

/**
 * 業務資料 → 本端點的 `data`。
 *
 * **必須是明確的映射函式**（§2、§1.8.0 的⑥）。這裡還有第二層意義：`LoginOutcome` 裡有
 * `tokens.refreshTicket`，而**它絕對不能出現在 response body**——refresh 票只走 cookie
 *（§5.4.3：`httpOnly` 讓它對 JS 不可見）。放進 `data` 的那一刻，`httpOnly` 就等於沒有設，
 * 一次 XSS 就能同時拿走兩張票，而 §5.4.2 的偷用偵測救不回來。
 * 逐欄挑選讓這件事不可能「不小心」發生。
 */
const toLoginData = (outcome: LoginOutcome) => ({
  accessToken: outcome.tokens.accessToken,
  user: {
    id: outcome.identity.userId,
    companyUserId: outcome.identity.companyUserId,
    displayName: outcome.profile.displayName,
  },
  company: {
    id: outcome.identity.companyId,
    companyCode: outcome.profile.companyCode,
    name: outcome.profile.companyName,
  },
})

/** 換票只回新的 access token；新的 refresh 票走 cookie（同上）。 */
const toRefreshData = (outcome: RefreshOutcome) => ({ accessToken: outcome.tokens.accessToken })

/**
 * 登出類端點的 `data`。
 *
 * 刻意是 `{ ok: true }` 而不是 `null`：`data: null` 在本系統的語意是「查無資料」（§1.3），
 * 而登出成功不是查無資料。回一個明確為真的旗標，前端就不必去分辨這兩件事。
 * **不回作廢了幾條鏈**——那是伺服器端的內部狀態，回給前端只會讓人拿它去做判斷
 *（例如「0 條代表登出失敗」），而那個判斷是錯的（見 logout service）。
 */
const toRevocationData = (): { ok: true } => ({ ok: true })

/** 各端點 `data` 的型別。由映射函式反推，因此**改了映射就會改型別**，不會兩邊漂移。 */
export type LoginData = ReturnType<typeof toLoginData>
export type RefreshData = ReturnType<typeof toRefreshData>
export type RevocationData = ReturnType<typeof toRevocationData>

type LoginBody = {
  readonly companyCode: string
  readonly username: string
  readonly password: string
}

/**
 * 只有基底三欄的 body：三支端點的輸入**完全由憑證決定**，沒有任何業務參數（§1.5）。
 *
 * handler 一個欄位都不讀它，型別仍然寫出來：`Record<string, never>` 之類的「空」型別會讓
 * 路由層傳進來的實際 body（含基底三欄）對不上，而唯一的修法是 `as`（禁止）。
 * 寫出真正的形狀，型別檢查就仍然在守著「這支端點沒有業務參數」這件事。
 */
type CredentialOnlyBody = {
  readonly rqTS: string
  readonly cmd: string
  readonly locale: string
}

/**
 * 發證成功後的共同收尾：把新票的壽命與新的 refresh 票交出去。
 *
 * 登入與換票走同一支，理由與 `domain/session-issue.ts` 相同——兩者發出來的東西必須同構。
 * 少了其中任何一步的症狀都是靜默的：漏了 `recordIssuedSession`，回應的 `expiresIn` 會是 `null`，
 * 前端會以為自己沒拿到有效的 token；漏了 `deliverRefreshTicket`，這次登入在瀏覽器裡沒有票，
 * 兩小時後就再也換不回來，而當下一切正常。
 */
const completeIssuance = (
  requestContext: RequestContext,
  identity: VerifiedIdentity,
  tokens: IssuedTokens,
  lifetime: IssuedLifetime,
): void => {
  recordIssuedSession(requestContext, identity, lifetime)
  deliverRefreshTicket(requestContext, tokens.refreshTicket, tokens.refreshMaxAgeSeconds)
}

export const handleLogin = async (
  dependencies: SessionsMainDependencies,
  context: EndpointContext<LoginBody>,
): Promise<EndpointResult<LoginData>> => {
  const result = await login(dependencies, {
    companyCode: context.body.companyCode,
    username: context.body.username,
    password: context.body.password,
  })

  if (result.ok) {
    completeIssuance(
      context.requestContext,
      result.value.identity,
      result.value.tokens,
      // 生命週期由發證元件算好（§1.3）：handler 不得自己算秒數，也不得碰 envelope 的那兩欄。
      // 這裡重算一次 lifetime 是不行的——那就是第二份實作。改由 service 的結果帶回來。
      result.value.lifetime,
    )
  }

  const outcome = resolveServiceResult(result, toLoginData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleRefresh = async (
  dependencies: SessionsMainDependencies,
  context: EndpointContext<CredentialOnlyBody>,
): Promise<EndpointResult<RefreshData>> => {
  const consumed = requireRefreshTicket(context.requestContext.verifiedRefreshTicket)

  const result = await refreshSession(dependencies, consumed)
  if (result.ok) {
    completeIssuance(context.requestContext, result.value.identity, result.value.tokens, result.value.lifetime)
  }

  const outcome = resolveServiceResult(result, toRefreshData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleLogout = async (
  dependencies: SessionsMainDependencies,
  context: EndpointContext<CredentialOnlyBody>,
): Promise<EndpointResult<RevocationData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await logout(dependencies, identity)

  if (result.ok) {
    // §1.3：登出成功的 `expiresIn` 一律 `null`。驗證器在①的時候已經續期過了，
    // 不清掉的話回應會帶著一個續期後的秒數回去，而前端會在一個已經死掉的 session 上繼續倒數。
    endSession(context.requestContext)
    withdrawRefreshTicket(context.requestContext)
  }

  const outcome = resolveServiceResult(result, toRevocationData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleLogoutAll = async (
  dependencies: SessionsMainDependencies,
  context: EndpointContext<CredentialOnlyBody>,
): Promise<EndpointResult<RevocationData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await logoutAllDevices(dependencies, identity)

  if (result.ok) {
    endSession(context.requestContext)
    withdrawRefreshTicket(context.requestContext)
  }

  const outcome = resolveServiceResult(result, toRevocationData)
  context.set.status = outcome.status
  return outcome.body
}
