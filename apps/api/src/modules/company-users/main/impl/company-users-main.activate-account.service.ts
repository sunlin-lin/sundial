/**
 * 業務動作：管理者直接啟用一位員工的登入帳號（UI 定案 `docs/ui/20-employee-list.md` §3.5
 * 「可以管理登入帳號狀態」）。與 `deactivate-account.service.ts` 對稱，完整的判準說明
 * （`employeeId` 當鍵、空操作不記稽核、為什麼要擋操作者對自己動用）都寫在那一檔的檔頭，
 * 這裡只記兩件事與那邊不同的地方。
 *
 * ## 為什麼「啟用」沒有既有動作可以重用
 *
 * 停用有 `deactivateCompanyUser`（離職流程在用）可以重用；啟用目前沒有任何呼叫者——Stage 3
 * 還沒有「回任」或「復職」的編排，因此本檔是全新寫的業務動作，不是重用＋補稽核。
 *
 * ## 為什麼「啟用一個離職員工的帳號」不在本檔擋
 *
 * 資料字典（`docs/schema/01-company-access-organization.md`）與 UI 定案都沒有提到「啟用時要
 * 檢查任職狀態」。本檔刻意不加這條檢查，兩個理由：
 *
 * 1. **會製造模組間的循環相依。** `employments/main` 已經因為離職流程需要同步停用帳號而
 *    import 了 `company-users`（`modules/employments/main/impl/employments-main.leave.
 *    service.ts` 的 `deactivateCompanyUser`）。若本檔反過來需要查「這個員工目前有沒有生效中的
 *    任職」，就要從 `company-users` import `employments`——兩個大目錄互相依賴對方的
 *    `index.ts`，這不是型別上會報錯的事，但是一個沒有任何既有先例的結構，且與
 *    `module-layout.md` §0.3「跨大目錄只能透過對方的 index.ts」的精神背道而馳（該精神假設
 *    依賴方向是單向的，兩個模組互相 import 對方會讓「誰依賴誰」失去意義）。
 * 2. **這支動作與 `deactivateCompanyUser` 的既有分工一致。** 那支動作的檔頭明講「只做停用，
 *    不做別的：不驗證這是不是本次離職動作在呼叫、不檢查任職狀態——那些是呼叫端的責任」。
 *    啟用比照同一個分工：帳號狀態與任職狀態是兩件事，該不該連動是呼叫端（未來若有「回任」
 *    編排）的責任，不是這支通用的「啟用帳號」動作自己該決定的。
 *
 * 這是本輪任務要求判斷並寫下理由的一條業務規則；沒有把它做成一條擋下請求的檢查，若日後產品
 * 要補這條規則，正確的做法是在「回任」的編排點（比照離職流程）呼叫本檔並自行決定要不要先查
 * 任職狀態，而不是讓這支通用動作背負一個目前沒有任何文件要求的假設。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { CompanyUserStatus, type CompanyUserStatusValue } from '../../../../db/schema/index.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { cannotChangeOwnAccountStatus, companyUserNotFound } from '../company-users-main.errors.ts'
import { findCompanyUserByEmployee, markCompanyUserActivated } from '../company-users-main.repository.ts'

export type ActivateCompanyUserAccountInput = {
  readonly employeeId: string
}

export type CompanyUserAccountActivation = {
  readonly companyUserId: string
  readonly status: CompanyUserStatusValue
}

export const activateCompanyUserAccountInTransaction = async (
  tx: TransactionRunner,
  companyId: string,
  operatorCompanyUserId: string,
  input: ActivateCompanyUserAccountInput,
  now: string,
): Promise<ServiceResult<CompanyUserAccountActivation>> => {
  const target = await findCompanyUserByEmployee(tx, companyId, input.employeeId)
  // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§4.2）。
  if (target === null) return fail([companyUserNotFound('employeeId')])
  // 見 `deactivate-account.service.ts` 檔頭「為什麼要擋操作者停用自己」：啟用同樣禁止，
  // 理由是續期不查 `company_users.status`（§5.4.6 的落差），操作者若在被停用後、access token
  // 尚未過期前对自己重新啟用，等於單方面撤銷別人的停用決定。
  if (target.id === operatorCompanyUserId) return fail([cannotChangeOwnAccountStatus()])

  if (target.status === CompanyUserStatus.Active) {
    // 已經是啟用狀態：合法的空操作，理由與停用對稱。不記稽核。
    return succeed({ companyUserId: target.id, status: CompanyUserStatus.Active })
  }

  const affectedRows = await markCompanyUserActivated(tx, companyId, target.id, now)
  if (affectedRows === 0) {
    // 競態：上面讀到 INACTIVE，但寫入前已被另一個請求啟用。結果與本次請求想要的一致，
    // 視為達成目的的空操作，不重複記稽核。
    return succeed({ companyUserId: target.id, status: CompanyUserStatus.Active })
  }

  await recordAudit(tx, {
    companyId,
    actor: { type: 'company-user', companyUserId: operatorCompanyUserId },
    action: 'company-users.main.activate',
    subjectTable: 'company_users',
    subjectId: target.id,
    changes: buildAuditChanges('company_users', { status: 'INACTIVE' }, { status: 'ACTIVE' }),
    effectiveDate: null,
    now,
  })

  return succeed({ companyUserId: target.id, status: CompanyUserStatus.Active })
}
