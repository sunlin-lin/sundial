/**
 * 業務動作：管理者直接停用一位員工的登入帳號（UI 定案 `docs/ui/20-employee-list.md` §3.5
 * 「可以管理登入帳號狀態」）。
 *
 * ## 不重寫既有的 `deactivateCompanyUser`，但也沒有呼叫它——為什麼
 *
 * `deactivateCompanyUser`（`impl/company-users-main.deactivate.service.ts`）是離職流程專用的
 * 「只做停用，不做別的」動作：以 `employeeId` 找**目前生效中**的帳號、條件式 UPDATE、
 * **刻意不呼叫 `recordAudit`**（責任在呼叫端）。本檔完全沒有改動那一支，它繼續、只被離職流程
 * 呼叫，行為一個字都沒變。
 *
 * 但本檔**沒有呼叫**它，原因是結構上呼叫不到：`deactivateCompanyUser` 是
 * `company-users-main.service.ts`（入口檔）re-export 出來的業務動作，本檔是同一個次目錄底下
 * 另一個 `impl/` 切片。若本檔要 import 它，只能從入口檔 `../company-users-main.service.ts`
 * import——而入口檔本身又要 import 本檔（`deactivateCompanyUserAccountInTransaction`）才能
 * re-export給端點用，這會形成入口檔與本檔互相 import 的循環相依。module-layout.md §4.2 明講
 * 「實作切片之間不得互相 import」，這裡雖然不是切片互相 import，而是切片與入口互相 import，
 * 但後果相同：ESM 循環相依在建置與測試時是否成立要看誰先被載入，不是一個穩定可以依賴的形狀。
 *
 * 因此本檔改為直接呼叫 `deactivateCompanyUser` 內部本來就會呼叫的**同一支 repository 動作**
 * `markCompanyUserDeactivated`（條件式 UPDATE，見 `impl/company-users-main.mark-deactivated.
 * repository.ts`）。這不是重寫停用邏輯：那支 UPDATE 的 SQL、判斷影響列數的規則完全沒有被複製
 * 或修改，本檔只是與 `deactivateCompanyUser` 一樣直接呼叫它、繞開中間那一層業務動作。兩個呼叫
 * 端（離職流程經由 `deactivateCompanyUser`、本端點直接呼叫）最終都落在同一支 repository 函式上，
 * 沒有第二份「怎麼停用一個帳號」的邏輯。
 *
 * ## 為什麼還需要自己的前置檢查
 *
 * `deactivateCompanyUser` 不檢查「操作者是不是在停用自己」、找不到有效帳號時靜默視為空操作、
 * 也不記稽核（離職那次交易另外記）。本端點是**另一個**呼叫端，沒有「離職」這件事同時發生，
 * 因此需要自己做三件事：停用前的自我檢查（見下方「為什麼要擋自己」）、冪等處理（已經是停用
 * 狀態時是空操作，不是錯誤）、以及**自己補上稽核**——這正是這一輪任務要修的缺口。
 *
 * ## 為什麼不會讓離職流程的稽核被記兩遍
 *
 * 離職流程（`employments/main/impl/employments-main.leave.service.ts`）與本端點是**兩條互斥的
 * 呼叫路徑**：前者的觸發條件是「辦理離職」，`action` 記 `employments.main.leave`；後者的觸發
 * 條件是「管理者直接按下停用」，`action` 記 `company-users.main.deactivate`。同一次使用者操作
 * 不可能同時落在兩條路徑上，兩者也各自只呼叫一次 `recordAudit`——不會有任何一條路徑記兩遍，
 * 也不會有「同一項異動被兩條路徑各記一筆」的情況，因為它們就是兩個不同的異動來源。
 *
 * ## 為什麼用 `employeeId` 而不是 `companyUserId` 當請求鍵
 *
 * 重設密碼（`reset-password.service.ts`）用 `companyUserId`；本檔改用 `employeeId`，是因為
 * `deactivateCompanyUser` 與它呼叫的 repository 動作原本就是以 `employeeId` 尋找目標
 * （module-layout.md §4.3：「service 的動作＝業務動作」在不同動作之間沒有義務共用同一組識別
 * 欄位）。維持與既有停用邏輯相同的鍵是最小改動；這一組端點的 UI 場景
 * （`docs/ui/20-employee-list.md` §3.5）本來就是員工詳情頁的「帳號與角色」頁籤，`employeeId`
 * 一定拿得到（那正是整頁的主體），不是額外的限制。
 *
 * ## 為什麼「已經是停用狀態」是空操作，不是錯誤
 *
 * 比照 `deactivateCompanyUser` 自己的判準（找不到有效帳號＝合法的空操作，不是錯誤）：對操作者
 * 而言，「停用」要達成的目的是「這個帳號現在是停用狀態」，重複點擊或畫面資料過期時再送一次，
 * 結果與第一次相同，不該讓使用者看到一個沒有意義的錯誤訊息。空操作**不記稽核**——沒有任何欄位
 * 真的改變，記一筆「改成 INACTIVE → INACTIVE」的稽核只會混淆「這個帳號到底什麼時候被停用」。
 *
 * ## 為什麼要擋「操作者停用自己」
 *
 * 這是本輪任務點名要想清楚的一條：`company_users.status` 只在**登入**那一刻被檢查
 * （`sessions-main.resolve-identity.repository.ts`），access token 續期（`touchAccessSession`）
 * 完全不查這個欄位（§5.4.6 的落差，見 `security.md` 的「規範與實作的落差」）。後果是操作者若能
 * 停用自己的帳號：當下的 session 不會立刻中斷，但下一次需要重新登入時就再也進不去——若操作者
 * 剛好是公司唯一的管理者，這是一個**沒有任何人能救回來**的自我鎖死（系統沒有客服或超級管理員
 * 後門）。因此不區分「是不是最後一個管理者」，一律禁止操作者對自己的帳號執行本動作：判斷「是否
 * 最後一個有效管理者」需要另外查角色與權限指派，複雜度與本端點的風險不成比例，而「一律不准對
 * 自己動用」在任何情況下都安全，且與其他帳號動作的既有慣例一致（`sessions-main.logout-all.
 * service.ts` 同樣把作廢範圍鎖死在「只能對自己」，這裡反過來是「唯獨不能對自己」，但都是同一種
 * 「本人關係由 token 推導、不給任何例外」的精神）。
 *
 * **本檔不開交易**：`deactivateCompanyUserAccountInTransaction` 只收外部交易 handle，開交易的
 * 包裝在入口檔 `company-users-main.service.ts` 的 `deactivateCompanyUserAccount`。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { CompanyUserStatus, type CompanyUserStatusValue } from '../../../../db/schema/index.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { cannotChangeOwnAccountStatus, companyUserNotFound } from '../company-users-main.errors.ts'
import { findCompanyUserByEmployee, markCompanyUserDeactivated } from '../company-users-main.repository.ts'

export type DeactivateCompanyUserAccountInput = {
  readonly employeeId: string
}

export type CompanyUserAccountDeactivation = {
  readonly companyUserId: string
  readonly status: CompanyUserStatusValue
}

export const deactivateCompanyUserAccountInTransaction = async (
  tx: TransactionRunner,
  companyId: string,
  operatorCompanyUserId: string,
  input: DeactivateCompanyUserAccountInput,
  now: string,
): Promise<ServiceResult<CompanyUserAccountDeactivation>> => {
  const target = await findCompanyUserByEmployee(tx, companyId, input.employeeId)
  // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§4.2）。
  if (target === null) return fail([companyUserNotFound('employeeId')])
  // 見檔頭「為什麼要擋操作者停用自己」——不區分是不是最後一個管理者，一律禁止。
  if (target.id === operatorCompanyUserId) return fail([cannotChangeOwnAccountStatus()])

  if (target.status === CompanyUserStatus.Inactive) {
    // 已經是停用狀態：合法的空操作，見檔頭。不寫入、不記稽核。
    return succeed({ companyUserId: target.id, status: CompanyUserStatus.Inactive })
  }

  // 與 `deactivateCompanyUser` 呼叫的是同一支 repository 動作，見檔頭「不重寫」的說明。
  const affectedRows = await markCompanyUserDeactivated(tx, companyId, target.id, now)
  if (affectedRows === 0) {
    // 競態：上面讀到 ACTIVE，但寫入前已被另一個請求停用。結果與本次請求想要的一致，
    // 視為達成目的的空操作，不重複記稽核（見檔頭「已經是停用狀態」的判準）。
    return succeed({ companyUserId: target.id, status: CompanyUserStatus.Inactive })
  }

  await recordAudit(tx, {
    companyId,
    actor: { type: 'company-user', companyUserId: operatorCompanyUserId },
    action: 'company-users.main.deactivate',
    subjectTable: 'company_users',
    subjectId: target.id,
    // `company_users` 政策的 `status` 欄位（`Value` 級，見 `audit-field-policy.ts`）。
    changes: buildAuditChanges('company_users', { status: 'ACTIVE' }, { status: 'INACTIVE' }),
    effectiveDate: null,
    now,
  })

  return succeed({ companyUserId: target.id, status: CompanyUserStatus.Inactive })
}
