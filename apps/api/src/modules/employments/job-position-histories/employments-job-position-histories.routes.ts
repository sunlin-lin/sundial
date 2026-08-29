/**
 * 職務歷史的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * **`create` 一次收 `jobPositionIds`（陣列，至少一筆），不是單一 `jobPositionId`**：字典「同一
 * 任職可同時有多個有效職務」、UI 定案「職務可指派多個」——本模組把「指派一批職務」設計成一個
 * 原子動作，理由見 `domain/job-position-history-model.ts` 檔頭。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, IsoDate, PageRequest, paginationResponse, Uuid } from '../../../shared/field-schemas.ts'
import {
  describeJobPositionHistoryErrors,
  JOB_POSITION_HISTORY_ENDPOINT_ERRORS,
} from './employments-job-position-histories.errors.ts'
import {
  handleJobPositionHistoryCreate,
  handleJobPositionHistoryList,
  type JobPositionHistoriesDependencies,
} from './employments-job-position-histories.handler.ts'

const JobPositionHistoryDetailSchema = t.Object({
  id: Uuid,
  employmentId: Uuid,
  jobPositionId: Uuid,
  effectiveFrom: IsoDate,
  effectiveTo: t.Union([IsoDate, t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
})

const JobPositionHistorySearchSchema = t.Object({ employmentId: Uuid })

/** 一次最多指派幾個職務。上限比照 `company-users/roles` 的 `RoleIds`，防止異常大的批次請求。 */
const MAX_JOB_POSITION_IDS = 50
const JobPositionIds = t.Array(Uuid, { minItems: 1, maxItems: MAX_JOB_POSITION_IDS, uniqueItems: true })

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

export const employmentsJobPositionHistoriesRoutes = (dependencies: JobPositionHistoriesDependencies) =>
  new Elysia({ name: 'employments-job-position-histories-routes' })
    .use(requestContext)
    .post(
      '/employments/job-position-histories/list',
      (context) => handleJobPositionHistoryList(dependencies, context),
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('employments.job-position-histories.list'),
          employmentId: Uuid,
          ...PageRequest,
        }),
        response: {
          200: envelope(paginationResponse(JobPositionHistorySearchSchema, JobPositionHistoryDetailSchema)),
          ...CommonFailureResponses,
        },
        detail: {
          summary: '查詢一筆任職的職務歷史（同一任職可同時有多筆有效職務）',
          description: `${describeJobPositionHistoryErrors(JOB_POSITION_HISTORY_ENDPOINT_ERRORS.list)} 依生效日由舊到新排序。`,
        },
      },
    )
    .post(
      '/employments/job-position-histories/create',
      (context) => handleJobPositionHistoryCreate(dependencies, context),
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('employments.job-position-histories.create'),
          employmentId: Uuid,
          jobPositionIds: JobPositionIds,
          effectiveFrom: IsoDate,
          effectiveTo: t.Optional(IsoDate),
        }),
        response: {
          200: envelope(t.Object({ items: t.Array(JobPositionHistoryDetailSchema) })),
          ...BusinessFailureResponses,
          ...CommonFailureResponses,
        },
        detail: {
          summary: '一次指派一或多個職務（全部共用同一段有效期間）',
          description: describeJobPositionHistoryErrors(JOB_POSITION_HISTORY_ENDPOINT_ERRORS.create),
        },
      },
    )
