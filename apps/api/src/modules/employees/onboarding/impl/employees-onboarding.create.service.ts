/**
 * 業務動作：一次到職編排（實作計畫 `05-employee-onboarding.md` §4.1、§8 Stage 4）。
 *
 * ## ★ 這支檔案存在的唯一理由：任一步失敗，整筆都不能留下
 *
 * UI 定案（`docs/ui/20-employee-list.md` §2.4）：「員工、任職、帳號及角色應一次建立；
 * 任一失敗時整筆取消」。本函式依序呼叫本次編排涉及的每個模組的 `*InTransaction` 動作
 * ——**全部**收同一個 `tx`（`db/client.ts` 的 `TransactionRunner`），任何一步回傳失敗結果，
 * 本函式立刻 `return fail(...)`、不再往下呼叫。呼叫端（入口檔 `employees-onboarding.service.ts`
 * 的 `createOnboarding`）用 `context.db.transaction(...)` 包住整個呼叫：回呼函式回傳的 Promise
 * **不會**因為業務失敗而 reject，但那沒關係——drizzle 的 `transaction()` 只依「是否 reject」決定
 * commit 或 rollback，而**本函式在成功路徑上才會真正寫東西進資料庫**；一旦中途 `fail`，
 * 前面幾步已經用同一個 `tx` 寫下的 INSERT 仍然坐在這個尚未 commit 的交易裡，直到最外層的
 * `.transaction()` 收到「業務結果」而不是「例外」時才 commit……**這裡必須非常小心**：
 * `ServiceResult` 的失敗分支本身不是例外，`db.transaction()` 看到回呼正常 resolve
 * （即使值是 `{ ok: false, ... }`）就會 commit，而不是 rollback！
 *
 * 因此入口檔的 `createOnboarding` **不能**只是單純把本函式的回傳值原樣交給
 * `context.db.transaction(...)` 然後 resolve——它必須在偵測到 `ok: false` 時把交易
 * **強制 rollback**。做法是呼叫 `tx.rollback()`（`TransactionRunner` 上就有這個方法，
 * `db/client.ts` 的 `TransactionRunner` 檔頭正是為了讓呼叫端拿得到它）。drizzle 的
 * `rollback()` 是用丟一個內部例外的方式終止交易，因此呼叫端要用 try/catch 把那個例外接住、
 * 換回原本要回的 `ServiceResult`，而不是讓它原樣冒出去變成一個看起來像系統錯誤的 500。
 * 完整寫法見入口檔 `createOnboarding`，本檔只負責「跑到哪一步失敗」，不負責交易怎麼收尾。
 *
 * ## 步驟的呼叫順序，以及為什麼是這個順序
 *
 * 1. `employees.main.create` —— 沒有它，後面全部步驟沒有 `employeeId` 可用。
 * 2. `employments.main.create` —— 需要剛建立的 `employeeId`；沒有任職就沒有 `employmentId`，
 *    第 3 步以後（部門歸屬、職稱、職務）掛在任職底下，不能先做。
 * 3. `employments.department-histories.create` —— 需要 `employmentId`。
 * 4. `employments.job-title-histories.create`（**選填**，`input.jobTitleId` 為 `null` 時跳過）
 *    —— UI 定案 §2.2「職稱——依公司設定」，計畫 §3.2「可做成非必填」。
 * 5. `employments.job-position-histories.create`（**選填**，`input.jobPositionIds` 為空陣列時
 *    跳過）—— 一次指派整批職務，不是逐一呼叫單筆版本（見該模組 `domain/job-position-history-
 *    model.ts` 檔頭：迴圈裡逐一呼叫會違反 §4.5 的 N+1 規則）。
 * 6. `withholding.main.create` —— 需要 `employeeId`（扣繳掛在員工底下，不是任職底下，字典原文）。
 * 7. `company-users.main.create`（新增登入帳號並加入公司）—— 需要 `employeeId`。
 * 8. `company-users.roles.create`（指派角色）—— 需要上一步產生的 `companyUserId`。
 *
 * 第 4／5／6／7 步彼此沒有依賴，順序對調也一樣正確；照上面排是為了跟 UI 表單分節的順序
 * （`docs/ui/20-employee-list.md` §2.2 在 §2.3、§2.4 之前）一致，方便對照。
 *
 * ## 每一步各自負責自己那一筆稽核
 *
 * 被呼叫的 `*InTransaction` 動作**各自在自己的實作裡呼叫 `recordAudit(tx, ...)`**
 * （`employees.main.create`、`employments.main.create`、`employments.department-histories.
 * create`、`employments.job-title-histories.create`、`employments.job-position-histories.
 * create`、`withholding.main.create`、`company-users.main.create`、`company-users.roles.
 * create`），本函式**不需要、也不應該**再另外呼叫一次——那會讓同一項異動被記錄兩遍。
 * 「稽核與業務寫入同一交易」這條規則因此對本函式自動成立：每一筆稽核與每一筆業務寫入共用同一個
 * `tx`，任一步的 `recordAudit` 失敗（拋例外）會讓整個回呼函式的 Promise reject，
 * 交易照樣 rollback，不需要本函式額外處理。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { OnboardingContext } from '../domain/onboarding-context.ts'
import type { CreateOnboardingInput, OnboardingResult } from '../domain/onboarding-model.ts'
// 同屬 `employees` 大目錄，次目錄之間可以互相 import（§0.3），不必經過 index.ts。
import { createEmployeeInTransaction, type EmployeesMainContext } from '../../main/employees-main.service.ts'
import {
  createCompanyUserInTransaction,
  assignRolesInTransaction,
  type RoleAssignmentContext,
} from '../../../company-users/index.ts'
import {
  createDepartmentHistoryInTransaction,
  createEmploymentInTransaction,
  createJobPositionHistoriesInTransaction,
  createJobTitleHistoryInTransaction,
  type DepartmentHistoriesContext,
  type EmploymentsMainContext,
  type JobPositionHistoriesContext,
  type JobTitleHistoriesContext,
} from '../../../employments/index.ts'
import { createWithholdingSettingInTransaction, type WithholdingMainContext } from '../../../withholding/index.ts'

export const createOnboardingInTransaction = async (
  tx: TransactionRunner,
  context: OnboardingContext,
  input: CreateOnboardingInput,
): Promise<ServiceResult<OnboardingResult>> => {
  const now = context.clock.now()

  // ---- 1. 員工主檔 ----
  const employeesContext: EmployeesMainContext = {
    db: context.db,
    cipher: context.cipher,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  }
  const employeeResult = await createEmployeeInTransaction(tx, employeesContext, {
    employeeCode: input.employeeCode,
    name: input.name,
    gender: input.gender,
    identityNumber: input.identityNumber,
    birthday: input.birthday,
    phone: input.phone,
    email: input.email,
    address: input.address,
  })
  if (!employeeResult.ok) return fail(employeeResult.errors)
  const employee = employeeResult.value

  // ---- 2. 任職 ----
  const employmentsContext: EmploymentsMainContext = {
    db: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  }
  const employmentResult = await createEmploymentInTransaction(tx, employmentsContext, {
    employeeId: employee.id,
    employmentTypeCode: input.employmentTypeCode,
    employmentNatureCode: input.employmentNatureCode,
    hireDate: input.hireDate,
  })
  if (!employmentResult.ok) return fail(employmentResult.errors)
  const employment = employmentResult.value

  // ---- 3. 部門歸屬（生效日＝到職日，見 domain 型別註解） ----
  const departmentHistoriesContext: DepartmentHistoriesContext = {
    db: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  }
  const departmentHistoryResult = await createDepartmentHistoryInTransaction(tx, departmentHistoriesContext, {
    employmentId: employment.id,
    departmentId: input.departmentId,
    effectiveFrom: input.hireDate,
    effectiveTo: null,
  })
  if (!departmentHistoryResult.ok) return fail(departmentHistoryResult.errors)
  const departmentHistory = departmentHistoryResult.value

  // ---- 4. 職稱（選填，見 domain 型別註解；null 代表這次到職不設定職稱） ----
  const jobTitleHistoriesContext: JobTitleHistoriesContext = {
    db: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  }
  let jobTitleHistory: OnboardingResult['jobTitleHistory'] = null
  if (input.jobTitleId !== null) {
    const jobTitleHistoryResult = await createJobTitleHistoryInTransaction(tx, jobTitleHistoriesContext, {
      employmentId: employment.id,
      jobTitleId: input.jobTitleId,
      effectiveFrom: input.hireDate,
      effectiveTo: null,
    })
    if (!jobTitleHistoryResult.ok) return fail(jobTitleHistoryResult.errors)
    jobTitleHistory = jobTitleHistoryResult.value
  }

  // ---- 5. 職務（選填、可多個；一次批次指派，理由見檔頭第 5 步） ----
  const jobPositionHistoriesContext: JobPositionHistoriesContext = {
    db: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  }
  let jobPositionHistories: OnboardingResult['jobPositionHistories'] = []
  if (input.jobPositionIds.length > 0) {
    const jobPositionHistoriesResult = await createJobPositionHistoriesInTransaction(tx, jobPositionHistoriesContext, {
      employmentId: employment.id,
      jobPositionIds: input.jobPositionIds,
      effectiveFrom: input.hireDate,
      effectiveTo: null,
    })
    if (!jobPositionHistoriesResult.ok) return fail(jobPositionHistoriesResult.errors)
    jobPositionHistories = jobPositionHistoriesResult.value
  }

  // ---- 6. 扣繳設定（生效日＝到職日，同上） ----
  const withholdingContext: WithholdingMainContext = {
    db: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  }
  const withholdingResult = await createWithholdingSettingInTransaction(tx, withholdingContext, {
    employeeId: employee.id,
    withholdingMethodCode: input.withholdingMethodCode,
    effectiveFrom: input.hireDate,
    effectiveTo: null,
  })
  if (!withholdingResult.ok) return fail(withholdingResult.errors)
  const withholdingSetting = withholdingResult.value

  // ---- 7. 登入帳號＋公司成員關係 ----
  const accountResult = await createCompanyUserInTransaction(
    tx,
    context.companyId,
    context.operatorCompanyUserId,
    { employeeId: employee.id, username: input.username, initialPassword: input.initialPassword },
    now,
  )
  if (!accountResult.ok) return fail(accountResult.errors)
  const account = accountResult.value

  // ---- 8. 角色指派（至少一筆，由 request schema 保證） ----
  const roleContext: RoleAssignmentContext = {
    database: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  }
  const roleResult = await assignRolesInTransaction(tx, roleContext, {
    companyUserId: account.companyUserId,
    roleIds: input.roleIds,
  })
  if (!roleResult.ok) return fail(roleResult.errors)

  return succeed({
    employee,
    employment,
    departmentHistory,
    jobTitleHistory,
    jobPositionHistories,
    withholdingSetting,
    companyUserId: account.companyUserId,
    roles: roleResult.value.roles,
  })
}
