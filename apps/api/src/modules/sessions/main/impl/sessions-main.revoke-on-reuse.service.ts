/**
 * 業務動作：偷用偵測觸發的全鏈作廢 ＋ 稽核（§5.4.2；稽核計畫 §7 Stage 2 三筆欠帳之一）。
 *
 * **這個動作沒有對應的端點**，呼叫者是 refresh 群組的憑證驗證器（§0.4 允許沒有端點的業務動作）。
 *
 * **與「登出所有裝置」刻意分成兩個動作，即使兩者的資料操作完全相同。** 差別只有作廢原因
 * 那一欄，而那一欄是這件事唯一留下來的證據：`REUSE_DETECTED` 是**系統自己偵測到的安全事件**，
 * `LOGOUT_ALL` 是使用者主動按的按鈕。合併成一個動作、共用一個原因之後，
 * 事後翻資料庫再也分不出「這位使用者的票是被誰作廢的」——而 §5.4.2 要求偵測到重複使用時
 * 必須寫稽核與告警，那是少數「系統自己能發現的安全事件」，靜靜作廢等於浪費了這個訊號。
 *
 * 為什麼作廢範圍是「該成員的所有鏈」而不是「出事的那一條」：
 * 舊票再次出現代表同一張票有第二方持有，而**無法從單次請求判斷誰是誰**
 *（可能是攻擊者拿舊票來換，也可能是攻擊者已經換過而真正的使用者拿著舊票來）。
 * 也不需要判斷——兩邊一起作廢，被偷的一方最多重登一次，攻擊者則失去全部存取權。
 *
 * ## 作廢與稽核必須在同一交易內（稽核計畫的三個硬規則之一）
 *
 * 這裡原本是一次裸連線寫入（沒有交易）。加上稽核之後變成兩次寫入，而**沒有交易的兩次寫入
 * 有四種結果**，其中最糟的是「作廢失敗 ＋ 稽核成功」：紀錄會說「已作廢該成員所有登入」，
 * 但攻擊者手上的 token 其實還能用。**紀錄說做了、實際沒做，比完全沒有紀錄更危險**——查稽核
 * 的人會判定事件已經處理完畢，然後去查別的事，不會再想到要重做一次作廢。因此把作廢與稽核
 * 包進同一個交易：稽核寫失敗，作廢也一併回滾，`revokeChainsOnReuse` 這個動作要嘛兩件事都做到，
 * 要嘛什麼都沒發生，不會有「做了一半」的中間狀態留在資料庫裡。
 *
 * ## 主體是 `company_users`（成員），不是 `refresh_tokens`（token）（稽核計畫已定案）
 *
 * 三個月後查「這個成員身上發生過什麼」要一次撈得到；token 是短命資料（輪替、登出都會產生新的
 * token id），事後拿一串已經作廢的 UUID 單獨查，查不到任何有意義的東西。實際被作廢的 token id
 * 因此不當 `subject_id`，而是放進 `changes`（見下）。
 *
 * `actor_type_code=2`（系統）、`actor_company_user_id` 為 `NULL`：這件事沒有人可以負責——
 * 塞一個假的成員 id 進去，稽核就會指向一個根本不在場的操作者（`AuditActor` 的型別檔頭有同樣的
 * 論證）。這正是 `audit_logs.company_id → companies.id` 那條單欄外鍵存在的理由：`actor_company_
 * user_id` 為 `NULL` 時，複合外鍵在 InnoDB 的 MATCH SIMPLE 語意下整條不檢查，若沒有這條單欄外鍵，
 * 系統事件的 `company_id` 會完全不受任何約束。
 */
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { RefreshTokenRevokeReason } from '../../../../db/schema/index.ts'
import type { VerifiedIdentity } from '../../../../shared/access-control.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import type { RevocationOutcome } from '../domain/session-model.ts'
import { revokeMemberChains } from '../sessions-main.repository.ts'

/**
 * 把作廢的 token id 陣列序列化成一個可進 `changes` 的字串。
 *
 * `AuditFieldValue`（`modules/audit/main/domain/audit-change-set.ts`）刻意不允許陣列——
 * 理由與 `company-users/roles` 的 `serializeRoleIds` 相同（那一份不能直接拿來用：兩個模組之間
 * 不得互相 import 對方 `domain/` 底下的內部檔案，§0.3），這裡就地重寫同一個小函式。
 */
const serializeTokenIds = (tokenIds: readonly string[]): string | null =>
  tokenIds.length === 0 ? null : JSON.stringify(tokenIds)

/**
 * 回傳的**不是** `ServiceResult`：這個動作沒有任何業務規則可以不成立，
 * 而且它的呼叫者是憑證驗證器——那一層不會把結果映射成 envelope（它一律回 `900`）。
 * 包一層 `ServiceResult` 只會讓驗證器多寫一段永遠走不到的失敗分支。
 *
 * `now` 只取一次、兩個寫入共用同一個值（稽核計畫 §3.3、§6.2）：作廢與稽核是同一次操作，
 * 若各自呼叫 `context.clock.now()`，兩個時間戳會相差幾毫秒，事後無法判斷哪一個才是操作時間。
 */
/**
 * @param reusedTokenId 觸發這次全鏈作廢的那張票的 id（`RefreshTicketVerification` 的
 *   `reuse-detected.ticketId`，一路由憑證驗證器傳進來）。與 `revokedTokenIds`
 *   是兩件不同的事：後者是「這次作廢了哪幾張目前活躍的票」，前者是「哪一張（通常早已不活躍
 *   的）舊票被第二次拿來用」。兩者在「重用上一張票」與「重用三次輪替之前的票」這兩種
 *   處置完全不同的情境下，作廢清單長得一模一樣——沒有這個欄位，事後翻稽核完全分不出兩者，
 *   分不出來的結果是只能永遠當良性處理。完整論證見 `shared/access-control.ts` 的
 *   `RefreshTicketVerification.reuse-detected.ticketId` 檔頭。
 */
export const revokeChainsOnReuse = async (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
  reusedTokenId: string,
): Promise<RevocationOutcome> => {
  const now = context.clock.now()

  return context.db.transaction(async (tx) => {
    const revokedTokenIds = await revokeMemberChains(tx, identity.companyId, identity.companyUserId, {
      at: now,
      reason: RefreshTokenRevokeReason.ReuseDetected,
    })

    // 事件形狀（before 為 null）：這不是「某個欄位從 A 變成 B」，是「發生了一次重用偵測事件」，
    // 與 `employees.main.create` 走同一種結構（稽核計畫 §4.2 新增／事件類都用 before=null）。
    await recordAudit(tx, {
      companyId: identity.companyId,
      actor: { type: 'system' },
      action: 'sessions.main.refresh-token-reuse',
      subjectTable: 'company_users',
      subjectId: identity.companyUserId,
      changes: buildAuditChanges('company_users', null, {
        revokedTokenIds: serializeTokenIds(revokedTokenIds),
        reusedTokenId,
      }),
      effectiveDate: null,
      now,
    })

    return { revokedCount: revokedTokenIds.length }
  })
}
