/**
 * refresh 群組的憑證驗證器（§1.9.1）。
 *
 * 三元組寫在這裡，一個都不省略：
 *
 * | 元素 | 值 |
 * |---|---|
 * | 憑證來源 | `sundial_refresh_ticket` cookie（`refresh-ticket-transport.ts`）。**不是 header、不是 body** |
 * | 憑證驗證器 | 本 plugin |
 * | 續期行為 | **不續期，改為發證**。它驗的是 refresh 票而不是 access token，手上根本沒有 access token 可以續；`expiresIn` 由端點觸發發證元件後產生（§1.3 來源②） |
 *
 * **這個群組只有一支端點**（`POST /sessions/main/refresh`），而那是刻意的（§5.4.1）：
 * refresh 票只認一個端點，它出現在其他請求上一律視為錯誤而不是「順便也能用」。
 * 兩張票的價值差異全部建立在「refresh 票的使用面極小」這件事上——一旦它也能當 access token 用，
 * 它就只是一張 30 天壽命的 access token，短命那一半的設計當場失效。
 *
 * **偷用偵測的副作用發生在這裡，不在端點裡**（§5.4.2）。理由與 `900` 的產出點是同一條：
 * 偵測到偷用時**根本不會有端點被執行**——請求在這一層就結束了。把「全鏈作廢」放進 handler，
 * 就得先讓一個已經被判定為外洩的請求走進業務層，而那一層還得有能力表達「憑證不可用」，
 * 那正是 §3.1.1 明文禁止的事（`ErrorGroup` 不為它新增第四個分組）。
 */
import { Elysia } from 'elysia'
import type { RefreshControlPorts } from '../shared/access-control.ts'
import { authRequired } from '../shared/envelope.ts'
import { LogCategory, logger } from '../shared/logger.ts'
import { HttpStatus } from './http-code-map.ts'
import { readRefreshTicket } from './refresh-ticket-transport.ts'
import { requestContext } from './request-context.ts'

export const refreshGuard = (ports: RefreshControlPorts) =>
  new Elysia({ name: 'refresh-guard' })
    .use(requestContext)
    .onBeforeHandle({ as: 'scoped' }, async (context): Promise<unknown> => {
      const rawTicket = readRefreshTicket(context.request)
      if (rawTicket === null) {
        // 沒帶票與帶了一張壞票的回應**完全相同**（§3.2 的精神）：任何可區分的差異都是
        // 一個可探測的介面。形狀由 §1.9.1 釘死：401 ＋ `900` ＋ `expiresIn: null` ＋ `errors: []`。
        // 這裡不寫 requestContext.session，出口層就會自然填 null。
        context.set.status = HttpStatus.Unauthorized
        return authRequired()
      }

      const verification = await ports.verifyRefreshTicket(rawTicket)

      if (verification.outcome === 'reuse-detected') {
        // §5.4.2：已作廢的票再次被使用 → 一律視為外洩 → 該使用者的所有票全部作廢。
        // **不是只擋下這一次請求，是整條鏈（所有鏈）作廢**，而且是即時的（§5.4.6）。
        //
        // 為什麼重複使用等於外洩：正常的 client 換完票就把舊的丟了，手上永遠只有最新的一張。
        // 舊票再次出現，代表同一張票有第二方持有——不是攻擊者拿舊票來換，就是攻擊者已經換過
        // 而真正的使用者拿著舊票來。兩種情形都無法從單次請求判斷誰是誰，**也不需要判斷**：
        // 兩邊一起作廢，被偷的一方最多重登一次，攻擊者則失去全部存取權。
        await ports.revokeAllChainsOnReuse(verification.identity)

        // §5.4.2 要求寫稽核與告警：這是少數「系統自己能發現的安全事件」，靜靜作廢等於浪費了訊號。
        // 分類用 `security_event` 而不是借用 `unhandled_exception`：兩者的告警處置完全不同，
        // 混在一起會讓這個訊號被淹沒在一堆程式錯誤裡。級別用 error 而不是 warn，理由同上
        //——它與「使用者打錯密碼」不是同一類事情。
        // 只記識別碼，**不記票的任何片段**（§5.1：憑證不得進 log）。
        logger.error(LogCategory.SecurityEvent, '偵測到已作廢的 refresh token 被重複使用，已作廢該成員的所有登入', {
          companyId: verification.identity.companyId,
          companyUserId: verification.identity.companyUserId,
          sessionId: verification.identity.sessionId,
        })

        context.set.status = HttpStatus.Unauthorized
        return authRequired()
      }

      if (verification.outcome === 'invalid') {
        context.set.status = HttpStatus.Unauthorized
        return authRequired()
      }

      // 票已經被**消耗**掉了（一次性使用，§5.4.2）：驗證與消耗是同一次條件式 UPDATE，
      // 因此走到這裡就代表這條鏈的下一張票只能由本次請求發出。
      context.requestContext.verifiedRefreshTicket = {
        identity: verification.identity,
        ticketId: verification.ticketId,
      }

      // 這個群組**不續期**（見檔頭三元組）：`requestContext.session` 保持 `null`，
      // `expiresIn` 由端點觸發發證元件之後才會有值。
      // 回傳 undefined 讓請求繼續往 handler 走。
      return undefined
    })
