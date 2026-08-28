/**
 * 業務動作：查詢目前這個 access token 對應的身分脈絡 ＋ 權限碼（`POST /sessions/main/context`）。
 *
 * **權限碼的來源是既有的那一份，不建第二份查詢邏輯**：`company-users` 的 `listPermissionCodes`
 * 正是身分驗證 middleware（`http/identity-guard.ts`，經 `app/session-access-control.ts` 接線）
 * 用來判斷「這支端點准不准進」的同一支函式，這裡呼叫的是同一個入口。若這裡另外寫一套查詢，
 * 兩份實作的公司範圍判斷或已撤銷角色的篩選條件日後會分岔，症狀是「前端顯示有這個權限、
 * 實際點下去卻 901」——而那種不一致沒有任何測試會自動抓到，只能靠使用者回報。
 *
 * 跨大目錄一律走對方的 `index.ts`（§0.3），因此這裡 import 的是 `modules/company-users`
 * 的出口，碰不到它的任何內部檔案。
 */
import { listPermissionCodes } from '../../../company-users/index.ts'
import type { VerifiedIdentity } from '../../../../shared/access-control.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import type { SessionContextOutcome } from '../domain/session-model.ts'
import { findSessionProfile } from '../sessions-main.repository.ts'

export const getSessionContext = async (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
): Promise<SessionContextOutcome> => {
  // 兩次查詢互不依賴，平行送出而不是先後等待——理由與 `regulatory/datasets` 的 `overview`
  // 動作相同：省下一次往返，且兩者都是唯讀查詢，不需要交易邊界（§4.4）。
  const [profile, permissionCodes] = await Promise.all([
    findSessionProfile(context.db, identity.companyId, identity.companyUserId),
    listPermissionCodes(context.db, identity.companyId, identity.companyUserId),
  ])

  if (profile === null) {
    // 系統錯誤，不是業務拒絕（§3.1.2）：這個請求已經通過已登入群組的憑證驗證——
    // 這個成員的身分剛剛才被驗證器查過一次，這裡卻查不到顯示資料，代表資料庫或本模組的
    // 公司範圍有問題，不是使用者做錯了什麼。訊息只帶識別碼，不帶任何個資（§5.1）。
    throw new Error(`成員 ${identity.companyUserId} 持有效身分卻查不到顯示資料`)
  }

  return { identity, profile, permissionCodes }
}
