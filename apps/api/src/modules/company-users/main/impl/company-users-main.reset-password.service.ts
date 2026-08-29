/**
 * 業務動作：管理者重設公司成員的登入密碼（UI 定案 `docs/ui/20-employee-list.md` §3.5）。
 *
 * 規則逐條對應 UI 定案與資料字典（`docs/schema/01-company-access-organization.md`）：
 * - 管理者直接輸入新密碼（不寄信、不發簡訊或系統通知——因此本檔沒有任何通知相關的呼叫）。
 * - 不保存明碼密碼：`newPassword` 只在本函式呼叫堆疊上短暫存在，立刻交給 `sessions` 的
 *   `hashPassword` 算成 Argon2id hash，往下只傳 hash（比照 `create` 切片的 `initialPassword`）。
 * - 重設後 `users.must_change_password = true`（見 `company-users-main.update-password.
 *   repository.ts` 的 `updateUserPassword`）。
 * - **稽核只記事件，不記值**：`changes` 只帶 `passwordReset`（`presence` 級），密碼與密碼 hash
 *   連 `presence` 級都不是——它們根本不在 `AUDIT_FIELD_POLICY.company_users` 的定義域裡，
 *   因此**型別上就塞不進去**，不是「這裡記得不要塞」。
 *
 * **本檔不開交易**：`resetCompanyUserPasswordInTransaction` 只收外部交易 handle
 * （`TransactionRunner`），開交易的包裝在入口檔 `company-users-main.service.ts` 的
 * `resetCompanyUserPassword`——形狀與 `company-users/roles` 的 `assignRoles`／
 * `assignRolesInTransaction` 同構（自己開交易給單一端點用、收 handle 給編排點用）。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { hashPassword } from '../../../sessions/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { companyUserNotFound } from '../company-users-main.errors.ts'
import { findCompanyUserById, updateUserPassword } from '../company-users-main.repository.ts'

export type ResetCompanyUserPasswordInput = {
  readonly companyUserId: string
  /** 明文，僅在本函式呼叫期間存在（見檔頭）。 */
  readonly newPassword: string
}

export type CompanyUserPasswordReset = {
  readonly companyUserId: string
}

export const resetCompanyUserPasswordInTransaction = async (
  tx: TransactionRunner,
  companyId: string,
  operatorCompanyUserId: string,
  input: ResetCompanyUserPasswordInput,
  now: string,
): Promise<ServiceResult<CompanyUserPasswordReset>> => {
  const target = await findCompanyUserById(tx, companyId, input.companyUserId)
  // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§4.2）。
  if (target === null) return fail([companyUserNotFound()])

  // 先算 hash 再寫入：Argon2id 不碰資料庫，順序不影響交易的原子性（理由與 `create` 切片相同）。
  const passwordHash = await hashPassword(input.newPassword)
  await updateUserPassword(tx, target.userId, { passwordHash, now })

  await recordAudit(tx, {
    companyId,
    actor: { type: 'company-user', companyUserId: operatorCompanyUserId },
    action: 'company-users.main.reset-password',
    subjectTable: 'company_users',
    subjectId: target.id,
    // presence 級：只記「密碼被重設了」，不記值（見檔頭）。`true` 只是讓 buildChangeSet 判定
    // 為「有變更」的哨兵，不是要記錄的內容——presence 級的輸出形狀本來就不含值。
    changes: buildAuditChanges('company_users', { passwordReset: null }, { passwordReset: true }),
    effectiveDate: null,
    now,
  })

  return succeed({ companyUserId: target.id })
}
