/**
 * 職稱主檔的端點目錄（§0.4「routes 不拆」、§1.9）。形狀比照
 * `departments/main/departments-main.routes.ts`，扁平列表（無 `tree`），因此**一律分頁**（§1.4）
 * ——與 `departments/main/tree` 不分頁的理由完全不適用於本模組：職稱清單是一般清單，
 * 沒有「切頁會弄斷樹狀結構」那個問題。
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
  handleJobTitleCreate,
  handleJobTitleDelete,
  handleJobTitleGet,
  handleJobTitleList,
  handleJobTitleUpdate,
  type JobTitlesMainDependencies,
} from './job-titles-main.handler.ts'
import { describeJobTitleErrors, JOB_TITLE_ENDPOINT_ERRORS } from './job-titles-main.errors.ts'

/** 職稱代碼。長度上限對齊 `job_titles.code` 的 `VARCHAR(64)`。 */
const JobTitleCode = codeField(64)

/** 職稱名稱。長度上限對齊 `job_titles.name` 的 `VARCHAR(128)`。 */
const JobTitleName = t.String({ minLength: 1, maxLength: 128 })

/** 職稱說明。選填，理由見 `db/schema/job-titles.ts` 檔頭。長度對齊 `VARCHAR(255)`。 */
const JobTitleDescription = t.String({ maxLength: 255 })

/** 職稱狀態，聯集字面值（§2）。值必須與 `db/schema/job-titles.ts` 的 `JobTitleStatus` 相同。 */
const JobTitleStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('INACTIVE')])

/** 清單關鍵字。比對 `code`／`name`，兩者皆為明文欄位。 */
const JobTitleKeyword = t.String({ maxLength: 128 })

const JobTitleDetailSchema = t.Object({
  id: Uuid,
  /** `true`＝系統預設（全平台共用，不能被本公司修改／刪除，見 `db/schema/job-titles.ts` 檔頭）。 */
  isSystem: t.Boolean(),
  code: JobTitleCode,
  name: JobTitleName,
  description: Nullable(JobTitleDescription),
  status: JobTitleStatusSchema,
  createdAt: t.String(),
  updatedAt: t.String(),
})

const JobTitleSearchSchema = t.Object({ keyword: t.Optional(JobTitleKeyword) })

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

export const jobTitlesMainRoutes = (dependencies: JobTitlesMainDependencies) =>
  new Elysia({ name: 'job-titles-main-routes' })
    .use(requestContext)
    .post('/job-titles/main/list', (context) => handleJobTitleList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('job-titles.main.list'),
        keyword: t.Optional(JobTitleKeyword),
        ...PageRequest,
      }),
      response: {
        200: envelope(paginationResponse(JobTitleSearchSchema, JobTitleDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢職稱清單（含系統預設與本公司自訂）',
        description: `${describeJobTitleErrors(JOB_TITLE_ENDPOINT_ERRORS.list)} keyword 比對代碼與名稱。`,
      },
    })
    .post('/job-titles/main/get', (context) => handleJobTitleGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('job-titles.main.get'), id: Uuid }),
      response: {
        200: envelope(Nullable(JobTitleDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單一職稱（含系統預設）',
        description: describeJobTitleErrors(JOB_TITLE_ENDPOINT_ERRORS.get),
      },
    })
    .post('/job-titles/main/create', (context) => handleJobTitleCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('job-titles.main.create'),
        code: JobTitleCode,
        name: JobTitleName,
        description: t.Optional(JobTitleDescription),
        // 刻意沒有 status／isSystem：新增一律 ACTIVE、一律公司自訂，不收使用者輸入。
      }),
      response: {
        200: envelope(JobTitleDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增公司自訂職稱',
        description: describeJobTitleErrors(JOB_TITLE_ENDPOINT_ERRORS.create),
      },
    })
    .post('/job-titles/main/update', (context) => handleJobTitleUpdate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('job-titles.main.update'),
        id: Uuid,
        code: JobTitleCode,
        name: JobTitleName,
        description: t.Optional(JobTitleDescription),
        status: JobTitleStatusSchema,
      }),
      response: {
        200: envelope(JobTitleDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '修改職稱（含啟用／停用）；系統預設職稱回 not-found，不能被本公司修改',
        description: describeJobTitleErrors(JOB_TITLE_ENDPOINT_ERRORS.update),
      },
    })
    .post('/job-titles/main/delete', (context) => handleJobTitleDelete(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('job-titles.main.delete'), id: Uuid }),
      response: {
        200: envelope(t.Object({ id: Uuid })),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '刪除職稱（軟刪除）；系統預設職稱回 not-found，不能被本公司刪除',
        description: describeJobTitleErrors(JOB_TITLE_ENDPOINT_ERRORS.delete),
      },
    })
