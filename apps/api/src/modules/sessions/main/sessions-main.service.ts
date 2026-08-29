/**
 * 登入狀態的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * **這裡有五個動作沒有對應的端點**（`verifyAccessToken`／`renewSession`／`verifyRefreshTicket`／
 * `revokeChainsOnReuse`／`revokeSessionsForDeactivation`）。前四個的呼叫者是入口層的憑證
 * 驗證器；最後一個的呼叫者是 `company-users/main`（停用帳號時同一交易內作廢 session，見該動作
 * 自己的檔頭）。§0.4 明文允許：界線是「有沒有次目錄以外的呼叫者」——有，就是業務動作，放入口。
 * 把入口限制成「只能是端點」，這五個東西就無處可放：塞進 `impl/` 會繞過「所有呼叫必須經過入口」
 * 那道牆，塞進 middleware 則等於讓入口層直接碰 repository。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1），
 * 這在本模組特別容易違反：登入失敗看起來很像該回 `900`，而 `900` 的唯一產出者是憑證驗證器
 *（§1.3）。本模組一個 `900` 都不會產生——登入失敗是**業務訊息**，走 `Unprocessable` → 422／`300`。
 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { RefreshTicketVerification, SessionRenewal, VerifiedIdentity } from '../../../shared/access-control.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { SessionsMainContext } from './domain/session-context.ts'
import type {
  ConsumedRefreshTicket,
  LoginInput,
  LoginOutcome,
  RefreshOutcome,
  RevocationOutcome,
  SessionContextOutcome,
} from './domain/session-model.ts'
import { getSessionContext as getSessionContextImpl } from './impl/sessions-main.context.service.ts'
import { login as loginImpl } from './impl/sessions-main.login.service.ts'
import { logoutAllDevices as logoutAllDevicesImpl } from './impl/sessions-main.logout-all.service.ts'
import { logout as logoutImpl } from './impl/sessions-main.logout.service.ts'
import { renewSession as renewSessionImpl } from './impl/sessions-main.renew.service.ts'
import { revokeSessionsForDeactivation as revokeSessionsForDeactivationImpl } from './impl/sessions-main.revoke-for-deactivation.service.ts'
import { revokeChainsOnReuse as revokeChainsOnReuseImpl } from './impl/sessions-main.revoke-on-reuse.service.ts'
import { refreshSession as refreshSessionImpl } from './impl/sessions-main.refresh.service.ts'
import { verifyAccessToken as verifyAccessTokenImpl } from './impl/sessions-main.verify-access.service.ts'
import { verifyRefreshTicket as verifyRefreshTicketImpl } from './impl/sessions-main.verify-ticket.service.ts'

export type { SessionsMainContext }
export type {
  ConsumedRefreshTicket,
  IssuedTokens,
  LoginInput,
  LoginOutcome,
  RefreshOutcome,
  RevocationOutcome,
  SessionContextOutcome,
  SessionProfile,
} from './domain/session-model.ts'

/** 端點動作：`POST /sessions/main/login`（公開群組）。 */
export const login = (context: SessionsMainContext, input: LoginInput): Promise<ServiceResult<LoginOutcome>> =>
  loginImpl(context, input)

/** 端點動作：`POST /sessions/main/refresh`（refresh 群組）。舊票已在驗證器那一步被消耗。 */
export const refreshSession = (
  context: SessionsMainContext,
  consumed: ConsumedRefreshTicket,
): Promise<ServiceResult<RefreshOutcome>> => refreshSessionImpl(context, consumed)

/** 端點動作：`POST /sessions/main/logout`（已登入群組）。作廢整條輪替鏈（§5.4.7）。 */
export const logout = (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
): Promise<ServiceResult<RevocationOutcome>> => logoutImpl(context, identity)

/** 端點動作：`POST /sessions/main/logout-all`（已登入群組）。作廢本人在本公司的所有鏈。 */
export const logoutAllDevices = (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
): Promise<ServiceResult<RevocationOutcome>> => logoutAllDevicesImpl(context, identity)

/**
 * 端點動作：`POST /sessions/main/context`（已登入群組）。回身分與這個成員在這家公司
 * 實際擁有的權限碼。**不回 `ServiceResult`**：這是查詢類動作，走到這裡代表 access token
 * 已經驗過了，沒有業務規則可以不成立（比照 `refresh`／`logout` 的處置）。
 */
export const getSessionContext = (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
): Promise<SessionContextOutcome> => getSessionContextImpl(context, identity)

/** 無端點：已登入群組的憑證驗證器用。含 §5.4.6 的即時撤銷檢查。 */
export const verifyAccessToken = (context: SessionsMainContext, rawToken: string): Promise<VerifiedIdentity | null> =>
  verifyAccessTokenImpl(context, rawToken)

/** 無端點：已登入群組的憑證驗證器用（§1.3 來源①的秒數，與發證共用同一份實作）。 */
export const renewSession = (context: SessionsMainContext): SessionRenewal => renewSessionImpl(context)

/** 無端點：refresh 群組的憑證驗證器用。驗證並**消耗**票（§5.4.2 的一次性輪替）。 */
export const verifyRefreshTicket = (
  context: SessionsMainContext,
  rawTicket: string,
): Promise<RefreshTicketVerification> => verifyRefreshTicketImpl(context, rawTicket)

/** 無端點：refresh 群組的憑證驗證器在偵測到偷用時呼叫（§5.4.2 的全鏈作廢）。 */
export const revokeChainsOnReuse = (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
  reusedTicketId: string,
): Promise<RevocationOutcome> => revokeChainsOnReuseImpl(context, identity, reusedTicketId)

/**
 * 無端點：供 `company-users/main` 在停用一個成員的登入帳號時，於**同一筆交易**內作廢該成員的
 * 所有 refresh token 鏈（安全落差修補，見實作檔 `impl/sessions-main.revoke-for-deactivation.
 * service.ts` 檔頭）。稽核由呼叫端負責，本動作不呼叫 `recordAudit`——理由同見該檔頭。
 */
export const revokeSessionsForDeactivation = (
  tx: TransactionRunner,
  companyId: string,
  companyUserId: string,
  now: string,
): Promise<readonly string[]> => revokeSessionsForDeactivationImpl(tx, companyId, companyUserId, now)

/**
 * 建立密碼 hash（§5.1）。零 IO 純函式，直接 re-export `domain/session-password.ts`。
 *
 * **新增於實作計畫 `05-employee-onboarding.md` Stage 4**：`employees/onboarding` 編排點要在
 * 建立登入帳號時把建立者輸入的初始密碼算成 hash，而密碼雜湊的實作只能留在 `sessions` 這個
 * 認證模組（本檔頭與 `domain/session-password.ts` 的說明一致：hash 只在這裡進出）。
 * 跨大目錄一律走 `index.ts`（§0.3），因此這裡補上這個出口——原本只有測試與 `credentials/main/*`
 * 用得到它，這裡是第二個呼叫者。
 */
export { hashPassword } from './domain/session-password.ts'
