/**
 * 業務動作：新增登入帳號並加入公司（實作計畫 `05-employee-onboarding.md` §4.1、§8 Stage 4）。
 *
 * **這支動作沒有對應的端點**（§0.4 明文允許「沒有端點的業務動作一樣放入口檔」），唯一的呼叫者是
 * `employees/onboarding` 編排點——UI 定案「新增員工時一定建立登入帳號」，而帳號與公司成員關係
 * 一律在那個編排點的單一交易內與員工、任職一起建立或整筆取消。
 *
 * **本檔不開交易**：`createCompanyUserInTransaction` 只收外部交易 handle（`TransactionRunner`，
 * `db/client.ts`），交易邊界屬於呼叫端（`employees/onboarding`）。與本目錄既有的
 * `deactivateCompanyUser` 同一個取捨——本檔也**沒有另外提供「自己開交易」的版本**，理由相同：
 * 這支動作從來就只被已經在交易內的呼叫端使用。
 *
 * ## 密碼只在這裡從明文變成 hash
 *
 * `initialPassword` 是建立者在畫面上輸入的明文（UI §2.4），**只在這個函式的呼叫堆疊上短暫存在**：
 * 進來之後立刻交給 `sessions` 模組的 `hashPassword` 算成 Argon2id hash，往下只傳 hash，
 * 不落地、不進 log、不進稽核（§5.1）。`users.mustChangePassword` 固定寫 `true`——UI 定案
 * 「員工第一次登入必須強制變更密碼」，這裡沒有讓呼叫端覆寫的參數。
 *
 * ## `username` 全域唯一：重複即拒絕，不連結既有帳號
 *
 * 完整理由見 `company-users-main.errors.ts` 的 `usernameTaken` 檔頭與
 * `domain/company-user-duplicate.ts` 檔頭，這裡只重述結論：撞到 `uq_users_username` 時
 * **立刻回業務錯誤，不做任何補救查詢或更新**——尤其不得去動那個既有 `users` 列的
 * `password_hash`。這是本檔最容易被「順手改壞」的一段，改動前請先讀那兩份檔頭。
 *
 * ## 稽核：只記「帳號建立了」，不記密碼
 *
 * `recordAudit` 的 `changes` 只帶 `status`（`ACTIVE`），**連 `presence` 級的密碼欄位都沒有**
 * ——資料字典要求的「帳號啟用、停用…要留稽核」在這裡由 `company_users` 這一列本身的出現與
 * `status` 前後值（`null` → `ACTIVE`）表達，密碼欄位不出現在 `AUDIT_FIELD_POLICY.company_users`
 * 的定義域裡（見 `modules/audit/main/domain/audit-field-policy.ts`），因此**型別上就塞不進去**
 * ——`buildAuditChanges` 只看快照裡出現的 key，快照裡沒有密碼這個 key，稽核裡就不可能出現它。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { hashPassword } from '../../../sessions/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { CompanyUserStatus } from '../../../../db/schema/index.ts'
import { usernameTaken } from '../company-users-main.errors.ts'
import { insertCompanyUser, insertUser } from '../company-users-main.repository.ts'

export type CreateCompanyUserInput = {
  readonly employeeId: string
  readonly username: string
  /** 明文，僅在本函式呼叫期間存在（見檔頭）。 */
  readonly initialPassword: string
}

export type CompanyUserCreation = {
  readonly companyUserId: string
  readonly userId: string
}

export const createCompanyUserInTransaction = async (
  tx: TransactionRunner,
  companyId: string,
  operatorCompanyUserId: string,
  input: CreateCompanyUserInput,
  now: string,
): Promise<ServiceResult<CompanyUserCreation>> => {
  // 先算 hash 再寫入：Argon2id 不碰資料庫，順序不影響交易的原子性，
  // 但把不需要交易保護的計算排在寫入之前，鎖（若上游有）持有的時間比較短。
  const passwordHash = await hashPassword(input.initialPassword)

  const userId = crypto.randomUUID()
  const outcome = await insertUser(tx, {
    id: userId,
    username: input.username,
    passwordHash,
    mustChangePassword: true,
    now,
  })

  // 撞到全域唯一鍵：立刻結束，不再對這個交易下任何一句寫入（§3.4），
  // 且**不得**回頭查詢或更新那個既有的 `users` 列（見檔頭「username 全域唯一」）。
  if (outcome === 'duplicate-username') return fail([usernameTaken()])

  const companyUserId = crypto.randomUUID()
  await insertCompanyUser(tx, companyId, { id: companyUserId, userId, employeeId: input.employeeId, now })

  await recordAudit(tx, {
    companyId,
    actor: { type: 'company-user', companyUserId: operatorCompanyUserId },
    action: 'company-users.main.create',
    subjectTable: 'company_users',
    subjectId: companyUserId,
    // 只記狀態，不記密碼（連 presence 級都不記，見檔頭）。新增事件：before 為 null。
    changes: buildAuditChanges('company_users', null, { status: CompanyUserStatus.Active }),
    effectiveDate: null,
    now,
  })

  return succeed({ companyUserId, userId })
}
