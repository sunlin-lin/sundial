/**
 * 職務主檔的端點目錄（§0.4「routes 不拆」、§1.9）。形狀比照
 * `job-titles/main/job-titles-main.routes.ts`；扁平列表，一律分頁（§1.4）。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  codeField,
  Nullable,
  PageRequest,
  paginationResponse,
  Uuid,
} from '../../../shared/field-schemas.ts'
import {
  handleJobPositionCreate,
  handleJobPositionDelete,
  handleJobPositionGet,
  handleJobPositionList,
  handleJobPositionUpdate,
  type JobPositionsMainDependencies,
} from './job-positions-main.handler.ts'
import { describeJobPositionErrors, JOB_POSITION_ENDPOINT_ERRORS } from './job-positions-main.errors.ts'

const JobPositionCode = codeField(64)

const JobPositionName = t.String({ minLength: 1, maxLength: 128 })

/** 職務說明。選填，理由見 `db/schema/job-positions.ts` 檔頭第 1 點（偏離字典的「必填」）。 */
const JobPositionDescription = t.String({ maxLength: 255 })

const JobPositionStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('INACTIVE')])

const JobPositionKeyword = t.String({ maxLength: 128 })

const JobPositionDetailSchema = t.Object({
  id: Uuid,
  isSystem: t.Boolean(),
  code: JobPositionCode,
  name: JobPositionName,
  description: Nullable(JobPositionDescription),
  status: JobPositionStatusSchema,
  createdAt: t.String(),
  updatedAt: t.String(),
})

const JobPositionSearchSchema = t.Object({ keyword: t.Optional(JobPositionKeyword) })

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

export const jobPositionsMainRoutes = (dependencies: JobPositionsMainDependencies) =>
  new Elysia({ name: 'job-positions-main-routes' })
    .use(requestContext)
    .post('/job-positions/main/list', (context) => handleJobPositionList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('job-positions.main.list'),
        keyword: t.Optional(JobPositionKeyword),
        ...PageRequest,
      }),
      response: {
        200: envelope(paginationResponse(JobPositionSearchSchema, JobPositionDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢職務清單（含系統預設與本公司自訂）',
        description: `${describeJobPositionErrors(JOB_POSITION_ENDPOINT_ERRORS.list)} keyword 比對代碼與名稱。`,
      },
    })
    .post('/job-positions/main/get', (context) => handleJobPositionGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('job-positions.main.get'), id: Uuid }),
      response: {
        200: envelope(Nullable(JobPositionDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單一職務（含系統預設）',
        description: describeJobPositionErrors(JOB_POSITION_ENDPOINT_ERRORS.get),
      },
    })
    .post('/job-positions/main/create', (context) => handleJobPositionCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('job-positions.main.create'),
        code: JobPositionCode,
        name: JobPositionName,
        description: t.Optional(JobPositionDescription),
      }),
      response: {
        200: envelope(JobPositionDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增公司自訂職務',
        description: describeJobPositionErrors(JOB_POSITION_ENDPOINT_ERRORS.create),
      },
    })
    .post('/job-positions/main/update', (context) => handleJobPositionUpdate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('job-positions.main.update'),
        id: Uuid,
        code: JobPositionCode,
        name: JobPositionName,
        description: t.Optional(JobPositionDescription),
        status: JobPositionStatusSchema,
      }),
      response: {
        200: envelope(JobPositionDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '修改職務（含啟用／停用）；系統預設職務回 not-found，不能被本公司修改',
        description: describeJobPositionErrors(JOB_POSITION_ENDPOINT_ERRORS.update),
      },
    })
    .post('/job-positions/main/delete', (context) => handleJobPositionDelete(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('job-positions.main.delete'), id: Uuid }),
      response: {
        200: envelope(t.Object({ id: Uuid })),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '刪除職務（軟刪除）；系統預設職務回 not-found，不能被本公司刪除',
        description: describeJobPositionErrors(JOB_POSITION_ENDPOINT_ERRORS.delete),
      },
    })
