/**
 * 職稱歷史的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * **與 `department-histories` 不同：本模組有 `create`。** Stage 5 任務要求「兩張歷史表的查詢與
 * 異動」，且 UI 定案 §3.3「可以修改部門、職稱及一個或多個職務」——修改組織資料需要一支真正的
 * 建立端點，不是只留給 Stage 4 編排點內部呼叫。權限碼、期間重疊與鎖的邏輯全部沿用既有的
 * `createJobTitleHistory`（見 service 檔），本檔只是把它接上 HTTP。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, IsoDate, PageRequest, paginationResponse, Uuid } from '../../../shared/field-schemas.ts'
import {
  describeJobTitleHistoryErrors,
  JOB_TITLE_HISTORY_ENDPOINT_ERRORS,
} from './employments-job-title-histories.errors.ts'
import {
  handleJobTitleHistoryCreate,
  handleJobTitleHistoryList,
  type JobTitleHistoriesDependencies,
} from './employments-job-title-histories.handler.ts'

const JobTitleHistoryDetailSchema = t.Object({
  id: Uuid,
  employmentId: Uuid,
  jobTitleId: Uuid,
  effectiveFrom: IsoDate,
  effectiveTo: t.Union([IsoDate, t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
})

const JobTitleHistorySearchSchema = t.Object({ employmentId: Uuid })

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

export const employmentsJobTitleHistoriesRoutes = (dependencies: JobTitleHistoriesDependencies) =>
  new Elysia({ name: 'employments-job-title-histories-routes' })
    .use(requestContext)
    .post('/employments/job-title-histories/list', (context) => handleJobTitleHistoryList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employments.job-title-histories.list'),
        employmentId: Uuid,
        ...PageRequest,
      }),
      response: {
        200: envelope(paginationResponse(JobTitleHistorySearchSchema, JobTitleHistoryDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢一筆任職的職稱歷史',
        description: `${describeJobTitleHistoryErrors(JOB_TITLE_HISTORY_ENDPOINT_ERRORS.list)} 依生效日由舊到新排序。`,
      },
    })
    .post('/employments/job-title-histories/create', (context) => handleJobTitleHistoryCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employments.job-title-histories.create'),
        employmentId: Uuid,
        jobTitleId: Uuid,
        effectiveFrom: IsoDate,
        effectiveTo: t.Optional(IsoDate),
      }),
      response: {
        200: envelope(JobTitleHistoryDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增一筆職稱歷史（同一任職同一時間僅一筆有效職稱）',
        description: `${describeJobTitleHistoryErrors(JOB_TITLE_HISTORY_ENDPOINT_ERRORS.create)} UI 定案要求組織異動一律指定未來生效日（\`docs/ui/20-employee-list.md\` §3.3），本端點不強制檢查 \`effectiveFrom\` 是否為未來——那是前端輸入層的責任（日期選擇器只能選未來日）。`,
      },
    })
