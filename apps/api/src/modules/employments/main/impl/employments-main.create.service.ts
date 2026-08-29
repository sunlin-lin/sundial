/**
 * 業務動作：新增任職。
 *
 * ## §4.3 期間重疊：鎖的粒度＝員工
 *
 * 1. 對 `employees` 那一列 `SELECT ... FOR UPDATE`（{@link findEmployeeForUpdate}）——
 *    這一步同時做「員工存在且屬於本公司」的存在性檢查與序列化：兩個請求同時替同一位員工建立
 *    任職時，第二個必須等第一個交易 commit／rollback 後才能往下走。
 * 2. 鎖到手之後，在**同一交易內**查出這位員工目前全部有效任職的期間（{@link
 *    listEmployeeEmploymentPeriods}），用 `shared/effective-period.ts` 的 `overlapsAnyPeriod`
 *    判斷新任職的到職日～離職日會不會與既有任職重疊。
 * 3. 通過才寫入；`uq_employee_employments_employee_hire_date` 唯一鍵是最後一道保險
 *    （見 `domain/employment-duplicate.ts`）。
 *
 * **這個作法不完美，必須誠實寫下來**：它把「兩個請求同時替同一位員工建立重疊任職」這種
 * 失敗模式，從「兩筆都寫進去、資料庫從此有兩筆同時有效的任職而沒有人知道」（靜默重疊），
 * 換成「後到的那個請求在 `FOR UPDATE` 上等待，等到前一個交易結束後才繼續、可能因此讀到
 * 『已經重疊』而被業務規則擋下（`employmentPeriodOverlap`），或者在鎖等待逾時時收到一個
 * 系統錯誤」（拿不到鎖而失敗）。後者是使用者看得到、可以重試的一個錯誤；前者是資料已經壞掉、
 * 沒有人會發現。這個殘留風險——**鎖等待逾時本身沒有被翻譯成一句業務訊息，而是原樣拋成系統
 * 錯誤**——是刻意的取捨，不是遺漏：逾時代表的是基礎設施層級的爭用（例如另一個交易卡住太久），
 * 不是使用者填錯了什麼，把它包裝成一句「請重試」的業務訊息並不會讓使用者多知道什麼。
 *
 * ## 交易 handle 由呼叫端傳入（計畫 §4.1）
 *
 * **本檔不開交易**：`createEmploymentInTransaction` 只收外部交易 handle
 * （`db/client.ts` 的 `TransactionRunner`），開交易的包裝在入口檔
 * `employments-main.service.ts` 的 `createEmployment`——那支給單一端點用，自己開交易；
 * 這支給 Stage 4 的 `employees/onboarding` 編排點用，跟著呼叫端已經開好的交易走。
 * `impl/` 不該知道自己是不是交易的最外層（§4.4：交易邊界屬於 service 入口這一層）。
 *
 * 這個形狀原本被 `check-audit-transaction.ts` 擋住——那支腳本曾經要求 `.transaction(...)`
 * 與 `recordAudit(...)` 寫在同一個檔案、同一個回呼裡（詞法巢狀判斷）。現在改成靠型別：
 * `recordAudit` 收 `TransactionRunner`，呼叫端傳裸連線池是編譯錯誤，不需要再靠詞法巢狀去確認
 * 「有沒有交易」；那支腳本的職責也已經改變，見其檔頭。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { overlapsAnyPeriod } from '../../../../shared/effective-period.ts'
import type { EmploymentsMainContext } from '../domain/employment-context.ts'
import type { CreateEmploymentInput, EmploymentAuditSnapshot, EmploymentDetail } from '../domain/employment-model.ts'
import {
  employmentEmployeeNotFound,
  employmentDuplicateHireDate,
  employmentPeriodOverlap,
} from '../employments-main.errors.ts'
import {
  findEmployeeForUpdate,
  findEmploymentDetail,
  insertEmployment,
  listEmployeeEmploymentPeriods,
} from '../employments-main.repository.ts'
import { EmploymentStatus } from '../../../../db/schema/index.ts'

export const createEmploymentInTransaction = async (
  tx: TransactionRunner,
  context: EmploymentsMainContext,
  input: CreateEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => {
  const now = context.clock.now()
  const employmentId = crypto.randomUUID()

  // 鎖的粒度＝員工（見檔頭）。
  const employee = await findEmployeeForUpdate(tx, context.companyId, input.employeeId)
  if (employee === null) return fail([employmentEmployeeNotFound()])

  const existingPeriods = await listEmployeeEmploymentPeriods(tx, context.companyId, input.employeeId)
  const overlaps = overlapsAnyPeriod(existingPeriods, { effectiveFrom: input.hireDate, effectiveTo: null })
  if (overlaps) return fail([employmentPeriodOverlap()])

  const outcome = await insertEmployment(tx, context.companyId, {
    id: employmentId,
    employeeId: input.employeeId,
    employmentTypeCode: input.employmentTypeCode,
    employmentNatureCode: input.employmentNatureCode,
    hireDate: input.hireDate,
    now,
  })
  if (outcome === 'duplicate-hire-date') return fail([employmentDuplicateHireDate()])

  const after: EmploymentAuditSnapshot = {
    employmentTypeCode: input.employmentTypeCode,
    employmentNatureCode: input.employmentNatureCode,
    hireDate: input.hireDate,
    leaveDate: null,
    lastWorkingDate: null,
    leaveReasonCode: null,
    status: EmploymentStatus.Active,
  }

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employments.main.create',
    subjectTable: 'employee_employments',
    subjectId: employmentId,
    changes: buildAuditChanges('employee_employments', null, after),
    effectiveDate: input.hireDate,
    now,
  })

  const detail = await findEmploymentDetail(tx, context.companyId, employmentId)
  if (detail === null) {
    throw new Error(`任職 ${employmentId} 建立後於同一交易內讀不回來`)
  }
  return succeed(detail)
}
