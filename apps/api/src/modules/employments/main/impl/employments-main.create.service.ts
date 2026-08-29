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
 * ## §4.1：交易邊界為什麼開在這一層，而不是收外部 tx
 *
 * 計畫 §4.1 定案「所有會被編排進同一筆業務的 service 動作，一律收交易 handle 作為第一個參數」，
 * 目的是讓 Stage 4 的 `employees/onboarding` 編排點能把這支動作與其他模組的寫入包進同一個交易。
 * **本檔沒有照字面做到這一點，這是刻意的偏離，必須誠實寫下來**：
 *
 * `bun run check:audit-transaction`（稽核計畫的三個硬規則之一）以 AST 檢查
 * `recordAudit(tx, ...)` 的呼叫節點，**必須在同一個檔案內**找到一個文字上直接包住它的
 * `.transaction(async (tx) => ...)`——它沿 AST 的 `parent` 鏈往上走，只認詞法上的巢狀，
 * 不認「呼叫了某個接收 tx 參數的函式」。這代表：只要這支動作要呼叫 `recordAudit`
 * （§6 要求任職異動必須稽核），`.transaction(...)` 就必須與 `recordAudit(...)` 寫在同一個檔案、
 * 同一個回呼裡——把交易開在呼叫端、這裡只收一個外部 `tx` 參數的寫法，會讓這裡的
 * `recordAudit(tx, ...)` 在檢查腳本眼中「找不到包住它的交易」，整條規則當場擋下 CI。
 *
 * 因此本檔維持與 `employees`／`departments`／`company-users/roles` 相同的既有慣例：
 * `context.db.transaction(async (tx) => { ...寫入... await recordAudit(tx, ...) ... })`，
 * 交易邊界開在這一層，不收外部 tx。**Stage 4 若要把這支動作編排進更大的交易，屆時必須先解決
 * 這個檢查腳本與「外部注入交易」兩者的衝突**（例如放寬檢查、或把 `recordAudit` 呼叫搬到
 * 呼叫端自己組），這不是本輪（Stage 3，明確排除交易編排）該處理的事，回報中已經提出。
 */
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

export const createEmployment = async (
  context: EmploymentsMainContext,
  input: CreateEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => {
  const now = context.clock.now()
  const employmentId = crypto.randomUUID()

  return context.db.transaction(async (tx): Promise<ServiceResult<EmploymentDetail>> => {
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
  })
}
