/**
 * 身分驗證 middleware（§1.8.0 的②、§5.2）。
 *
 * 一次請求的順序是：驗證 access token → **續期** → 由路徑推導權限碼 → 比對使用者權限。
 * 續期排在權限判斷**之前**是結構性的要求（§1.3）：續期發生在驗證通過的當下，那時候還不知道
 * body 對不對、有沒有權限，所以「續期」與「處理結果」在程式結構上就不可能耦合。
 * 反過來把續期綁在「處理成功」上，使用者連續填錯三次表單就會被登出。
 *
 * 認證方式是**群組的屬性**（§1.9.1）：本 plugin 由路由組裝點掛在「已登入群組」上，
 * 端點自己不宣告任何認證方式——寫在每支端點上就是把同一件事抄 N 遍，而漏抄的那一支
 * 不會報錯、不會少一個檔案，它只是**變成不驗證身分**。
 */
import { Elysia } from 'elysia'
import type { AccessControlPorts } from '../shared/access-control.ts'
import { authRequired, permissionDenied } from '../shared/envelope.ts'
import { LogCategory, logger } from '../shared/logger.ts'
import { toPermissionCode } from '../shared/path-code.ts'
import { HttpStatus } from './http-code-map.ts'
import { requestContext } from './request-context.ts'

const BEARER_PREFIX = 'Bearer '

const readBearerToken = (authorizationHeader: string | null): string | null => {
  if (authorizationHeader === null) return null
  if (!authorizationHeader.startsWith(BEARER_PREFIX)) return null
  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim()
  return token === '' ? null : token
}

export const identityGuard = (ports: AccessControlPorts) =>
  new Elysia({ name: 'identity-guard' })
    .use(requestContext)
    .onBeforeHandle({ as: 'scoped' }, async (context): Promise<unknown> => {
      const token = readBearerToken(context.request.headers.get('authorization'))
      if (token === null) {
        context.set.status = HttpStatus.Unauthorized
        return authRequired()
      }

      const identity = await ports.verifyAccessToken(token)
      if (identity === null) {
        // `900` 是唯一 `expiresIn` 回 `null` 的情況（§1.3）：此時根本沒有一個有效身分可以續期。
        // 這裡不寫 requestContext.session，出口層就會自然填 null。
        context.set.status = HttpStatus.Unauthorized
        return authRequired()
      }

      const renewal = await ports.renewSession(identity)
      context.requestContext.session = { identity, renewal }

      const permissionCode = toPermissionCode(context.path)
      if (permissionCode === null) {
        // 路徑推導不出權限碼代表它不是一支合法的三段式業務端點（§1.1）。
        // 一律拒絕而不是放行：放行等於任何形狀怪異的路徑都能繞過授權。
        logger.warn(LogCategory.PermissionDenied, '無法由路徑推導權限碼', { path: context.path })
        context.set.status = HttpStatus.Forbidden
        return permissionDenied()
      }

      const grantedCodes = await ports.loadPermissionCodes(identity.companyId, identity.companyUserId)
      if (!grantedCodes.has(permissionCode)) {
        // `901` 仍然回續期後的 `expiresIn`（身分有效，只是這個動作不准）。
        // 寫成不續期是最容易犯的錯：使用者點到一個沒權限的功能，等於順便把自己的 session 熬短，
        // 下一次真正有權限的操作反而吃到 `900`。
        logger.warn(LogCategory.PermissionDenied, '缺少端點所需的權限碼', {
          path: context.path,
          permissionCode,
          companyId: identity.companyId,
          companyUserId: identity.companyUserId,
        })
        context.set.status = HttpStatus.Forbidden
        return permissionDenied()
      }

      // 回傳 undefined 讓請求繼續往 handler 走。
      return undefined
    })
