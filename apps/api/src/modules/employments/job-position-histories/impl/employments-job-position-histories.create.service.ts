/**
 * 業務動作：一次指派一或多個職務（新增一批職務歷史，全部共用同一段有效期間）。
 *
 * ## §4.3 期間重疊：鎖的粒度＝`(employment_id, job_position_id)`，這是三張歷史表裡唯一的例外
 *
 * 完整理由見 `db/schema/employee-job-position-histories.ts` 檔頭與
 * `impl/employments-job-position-histories.find-job-positions-for-update.repository.ts` 檔頭
 * 「為什麼鎖 `job_positions`」，這裡只重述會影響本函式寫法的結論：
 *
 * 1. 對這一批 `jobPositionIds` **一次性**、批次 `SELECT ... FOR UPDATE`（鎖 `job_positions`，
 *    不是 `employee_employments`，也不是本表自己）。
 * 2. 批次查出這批職務在**這筆任職**目前全部的有效期間，依 `job_position_id` 分組。
 * 3. **在記憶體裡**（不是資料庫查詢，不算 §4.5 的 N+1）逐一核對這一批新期間：既要跟資料庫裡
 *    既有的期間比，也要跟同一批次裡「排在自己前面、指向同一個職務」的期間比——後者是必要的，
 *    因為同一批次還沒寫進資料庫，資料庫查詢看不到彼此。
 * 4. `uq_employee_job_position_histories_employment_position_from` 唯一鍵是最後一道保險。
 *
 * ## 為什麼是「批次」而不是迴圈呼叫單筆版本
 *
 * 見 `domain/job-position-history-model.ts` 檔頭：迴圈裡呼叫單筆版本會在
 * `employees/onboarding` 的編排點裡產生「迴圈裡有資料庫呼叫的 await」，違反 §4.5。本函式因此
 * 設計成**一次處理整批**：批次鎖、批次查、批次寫，呼叫端（`employees/onboarding`）不需要迴圈。
 *
 * ## 稽核：整批只留一筆，主體是這次異動本身
 *
 * 與 `company-users.roles.create`（一次指派多個角色只留一筆稽核）同一個判斷：`subjectId` 是
 * `employmentId`，`changes` 記這一批職務 id（排序後序列化）與共用的生效期間，不是逐筆各記一次
 * ——後者會讓「一次指派五個職務」在稽核裡看起來像五個各自獨立的事件，也會變成迴圈裡呼叫
 * `recordAudit` 五次（雖然 `check:n-plus-one` 的判準抓不到 `recordAudit` 這個名字，但那不是
 * 「抓不到就可以做」的理由，一次寫入本來就該是一次稽核）。
 *
 * **本檔不開交易**：`createJobPositionHistoriesInTransaction` 只收外部交易 handle
 * （`TransactionRunner`），開交易的包裝在入口檔的 `createJobPositionHistories`。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { overlapsAnyPeriod, type EffectivePeriod } from '../../../../shared/effective-period.ts'
import { serializeJobPositionIds } from '../domain/job-position-history-audit.ts'
import type { JobPositionHistoriesContext } from '../domain/job-position-history-context.ts'
import type {
  CreateJobPositionHistoriesInput,
  JobPositionAssignmentAuditSnapshot,
  JobPositionHistoryDetail,
} from '../domain/job-position-history-model.ts'
import {
  jobPositionHistoryDuplicateEffectiveFrom,
  jobPositionHistoryEmploymentNotFound,
  jobPositionHistoryJobPositionNotFound,
  jobPositionHistoryPeriodOverlap,
} from '../employments-job-position-histories.errors.ts'
import {
  findEmploymentForReference,
  findJobPositionsForUpdate,
  insertJobPositionHistories,
  listJobPositionHistoryPeriodsByJobPosition,
} from '../employments-job-position-histories.repository.ts'

export const createJobPositionHistoriesInTransaction = async (
  tx: TransactionRunner,
  context: JobPositionHistoriesContext,
  input: CreateJobPositionHistoriesInput,
): Promise<ServiceResult<readonly JobPositionHistoryDetail[]>> => {
  const now = context.clock.now()
  const distinctJobPositionIds = [...new Set(input.jobPositionIds)]

  // ★ 鎖的粒度＝(employment, job_position)：批次鎖 job_positions（見檔頭）。
  //
  // **這一步必須是本交易的第一個資料庫查詢，順序不是隨意的。** MariaDB 預設隔離等級是
  // REPEATABLE READ：一個交易裡的「一般 SELECT」（非鎖定讀）會在**第一次**執行一般 SELECT 的當下
  // 建立一份快照，之後同一交易內的一般 SELECT 全部沿用那份快照，不會看到交易期間其他人才剛
  // commit 的資料；`SELECT ... FOR UPDATE` 是鎖定讀，不受這份快照規則約束。若把下面
  // `findEmploymentForReference`（一般 SELECT）放在這一步之前，它會搶先建立快照，
  // 於是稍後 `listJobPositionHistoryPeriodsByJobPosition`（同樣是一般 SELECT）沿用的是那份
  // **鎖定之前**的舊快照，看不到另一個交易剛寫入並 commit 的職務歷史——鎖本身仍然正確地讓兩個
  // 交易依序執行，但重疊檢查會读到過期資料，兩筆原本應該衝突的期間會雙雙判定「沒有重疊」而雙雙
  // 寫入成功。把鎖定讀排在整個交易的第一步，之後的第一個一般 SELECT 才會在鎖定讀**取得鎖之後**
  // 建立快照，看到的即是最新的已提交資料。這個順序的重要性只有寫「兩個交易同時對同一個職務
  // 建立重疊期間」的併發測試才驗得出來——見
  // `__tests__/employments-job-position-histories.concurrency.test.ts` 的第一支測試。
  const lockedJobPositionIds = await findJobPositionsForUpdate(tx, context.companyId, distinctJobPositionIds)
  const hasMissingJobPosition = distinctJobPositionIds.some((id) => !lockedJobPositionIds.has(id))
  if (hasMissingJobPosition) return fail([jobPositionHistoryJobPositionNotFound()])

  const employment = await findEmploymentForReference(tx, context.companyId, input.employmentId)
  if (employment === null) return fail([jobPositionHistoryEmploymentNotFound()])

  const existingPeriodsByJobPosition = await listJobPositionHistoryPeriodsByJobPosition(
    tx,
    context.companyId,
    input.employmentId,
    distinctJobPositionIds,
  )

  // 純記憶體運算（不是資料庫呼叫，不算 §4.5 的 N+1）：逐一核對，同時累積「同一批次裡已經核准
  // 的期間」，讓批次內彼此的重疊也檢查得到（見檔頭第 3 點）。
  const periodsSoFar = new Map<string, EffectivePeriod[]>()
  const candidate: EffectivePeriod = { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo }

  for (const jobPositionId of input.jobPositionIds) {
    const existing = periodsSoFar.get(jobPositionId) ?? [...(existingPeriodsByJobPosition.get(jobPositionId) ?? [])]
    if (overlapsAnyPeriod(existing, candidate)) return fail([jobPositionHistoryPeriodOverlap()])
    periodsSoFar.set(jobPositionId, [...existing, candidate])
  }

  const rows = input.jobPositionIds.map((jobPositionId) => ({
    id: crypto.randomUUID(),
    employmentId: input.employmentId,
    jobPositionId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    now,
  }))

  const outcome = await insertJobPositionHistories(tx, context.companyId, rows)
  if (outcome === 'duplicate-effective-from') return fail([jobPositionHistoryDuplicateEffectiveFrom()])

  const after: JobPositionAssignmentAuditSnapshot = {
    jobPositionIds: serializeJobPositionIds(input.jobPositionIds),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  }

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employments.job-position-histories.create',
    subjectTable: 'employee_job_position_histories',
    subjectId: input.employmentId,
    changes: buildAuditChanges('employee_job_position_histories', null, after),
    effectiveDate: input.effectiveFrom,
    now,
  })

  return succeed(
    rows.map((row) => ({
      id: row.id,
      employmentId: row.employmentId,
      jobPositionId: row.jobPositionId,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      createdAt: now,
      updatedAt: now,
    })),
  )
}
