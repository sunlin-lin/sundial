/**
 * 業務動作：登出所有裝置（§5.4.2、§5.4.4）。
 *
 * **這支端點是本系統三道防線之一，不是方便功能。** §5.4.4 明確記錄了「不做敏感操作的重新驗證」
 * 這個決定，而它的代價是：只要人已登入，能做最日常的操作就能看到權限範圍內最敏感的資料。
 * 裝置借給同事、午休離座沒鎖螢幕、瀏覽器留在共用電腦上——這些情境下，
 * 取得畫面的人拿到的是全部權限範圍內的資料。**「登出所有裝置」正是使用者對這件事唯一的自救手段**，
 * 與 §5.4.2 的輪替偵測、§5.4.5 的改密碼作廢並列，三者失去任何一個都沒有替代品。
 *
 * 而三者的效力全部建立在 §5.4.6「access token 即時撤銷」之上：撤銷若不是即時的，
 * 三者都只是「過一陣子才生效」，而**使用者按下去的當下就已經不再警戒了**。
 * 本動作作廢的是 `refresh_tokens` 的列，而憑證驗證器每個請求都要查那些列——因此是即時的。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { RefreshTokenRevokeReason } from '../../../../db/schema/index.ts'
import type { VerifiedIdentity } from '../../../../shared/access-control.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import type { RevocationOutcome } from '../domain/session-model.ts'
import { revokeMemberChains } from '../sessions-main.repository.ts'

/**
 * @param identity 已驗證身分。作廢範圍是 `identity.companyUserId`——**本人**，
 *   而且是本人在**本公司**的所有登入。
 *
 *   「誰可以對誰執行 logout-all（管理者能不能踢掉某位員工的所有裝置）」是 §9 第 3 項尚未定案的
 *   政策問題，因此這支端點目前**只做得到本人**：身分來自 token，body 裡沒有任何欄位可以指定別人。
 *   這是刻意的——先做成「只能對自己」，日後開放管理者操作時要加的是一支新端點與一個權限碼，
 *   而不是在這一支上加一個「可選的目標成員」欄位（那個欄位一旦存在，漏檢查一次就是越權踢人）。
 */
export const logoutAllDevices = async (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
): Promise<ServiceResult<RevocationOutcome>> => {
  const now = context.clock.now()

  const revokedCount = await revokeMemberChains(context.db, identity.companyId, identity.companyUserId, {
    at: now,
    reason: RefreshTokenRevokeReason.LogoutAll,
  })

  // 含**當前這台裝置**在內，沒有例外（比照 §5.4.5 對改密碼的要求）。
  // 留一個例外就要多一段「哪一條鏈是當前這條」的判斷，而那段邏輯寫錯的後果是
  // 「以為作廢了、其實沒有」——沒有效果卻讓人放心，比什麼都沒做更危險。
  return succeed({ revokedCount })
}
