/**
 * `company_users` 主體的稽核內容型別（計畫 §4.5）。
 *
 * **這一份 `source` 型別不是「`company_users` 自己的欄位」，是刻意的。** §4.5 提醒過這一點：
 * 落在這個主體上的事件（角色指派／撤銷、refresh token 重用偵測）動的分別是 `company_user_roles`
 * 與 `refresh_tokens` 兩張表，`company_users` 這一列本身完全沒有欄位被改到。`employees` 的
 * `source` 之所以指向 `EmployeeProfileInput`，是因為那裡稽核的正是輸入欄位本身；這裡沒有
 * 對應的「輸入型別」可以指——稽核要記的是「這個成員身上發生了什麼事」，不是「這個成員的
 * 哪個欄位被改了」。因此本檔在 `modules/audit/main/domain/` 自己宣告一份**稽核內容型別**，
 * 而不是去 import `company-users` 或 `sessions` 模組的內部檔案（那也違反 §0.3：`audit` 不得
 * 相依其他模組的內部檔案）。
 *
 * ## 為什麼欄位是字串，不是陣列
 *
 * `AuditFieldValue`（`audit-change-set.ts`）刻意不允許物件與陣列：允許巢狀值等於開一條路，
 * 讓整包子結構以「一個欄位」的名義繞過逐欄政策。`roleIds`／`revokedTokenIds` 本質上是 id 陣列，
 * 因此在進稽核之前先由呼叫端序列化成一個字串（排序後 `JSON.stringify`，理由見各呼叫端），
 * 這裡的型別只收字串。
 */

/**
 * 落在 `company_users` 這個主體上、目前僅有的兩種事件各自帶的內容。
 *
 * 三個欄位分屬不同呼叫者（`company-users/roles` 與 `sessions/main`），**同一次呼叫只會用到其中
 * 一部分**——`buildChangeSet` 只處理快照裡實際出現的 key（見 `audit-change-set.ts` 的
 * `collectFields`），因此角色指派事件不必帶 `revokedTokenIds`／`reusedTokenId`，
 * 重用偵測事件也不必帶 `roleIds`。三者仍然要一起宣告在同一個型別裡：`check:audit-policy`
 * 是雙向比對，型別有的政策必須有、政策有的型別也必須有，分成兩個型別會讓「這個主體到底
 * 涵蓋哪些事件」失去單一定義處。
 */
export type CompanyUsersAuditContent = {
  /**
   * 帳號在公司內的狀態（`ACTIVE`／`INACTIVE`）。**新增於實作計畫 `plans/05-employee-onboarding.md`
   * Stage 3**：離職流程（`modules/employments/main/impl/employments-main.leave.service.ts`）
   * 辦理離職時同步停用該員工的公司帳號，資料字典明列「帳號啟用、停用…要留稽核」。
   * 與 `roleIds`／`revokedTokenIds`／`reusedTokenId` 同一個模式——這個主體上發生的事，
   * 記的是「這一列的狀態欄位」，因此用 `value` 級（狀態本身不是敏感資料）。
   */
  readonly status: string | null
  /**
   * 角色指派／撤銷後，序列化的角色 id 陣列（`JSON.stringify`，排序過）。
   * `null` 代表這個方向（前或後）沒有任何有效角色。
   */
  readonly roleIds: string | null
  /**
   * refresh token 重用偵測時，這次事件實際作廢的 token id 陣列（序列化，`JSON.stringify`）。
   * `null` 代表沒有任何 token 被作廢（理論上不會發生：能觸發重用偵測代表至少有一張舊票，
   * 但沒有活躍票可作廢時仍然照實記錄，不假裝有）。
   */
  readonly revokedTokenIds: string | null
  /**
   * refresh token 重用偵測時，**被第二次拿來用的那張票**的 id。與 `revokedTokenIds`
   * 是兩件不同的事——`revokedTokenIds` 是這次順帶作廢掉的所有目前活躍的票，
   * `reusedTokenId` 是觸發這整件事的那一張（通常早已不活躍）舊票。少了它，
   * 「重用的是上一張票（多半是網路重送，良性）」與「重用的是三次輪替之前的票（真正的
   * 資安事件）」在稽核上長得一模一樣，因為兩者的作廢清單本來就相同——分不出兩者的結果，
   * 是每一次都只能當良性處理。完整論證見 `shared/access-control.ts` 的
   * `RefreshTicketVerification.reuse-detected.ticketId` 檔頭。這一欄不像 `revokedTokenIds`
   * 需要序列化陣列：它永遠只有一個值，觸發重用偵測時必定存在（不會是 `null`）。
   */
  readonly reusedTokenId: string
}
