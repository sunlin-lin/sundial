/** 勞退設定的端點目錄（§0.4「routes 不拆」、§1.9）。形狀比照 `withholding-main.routes.ts`。 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, IsoDate, PageRequest, paginationResponse, Uuid } from '../../../shared/field-schemas.ts'
import {
  handleLaborPensionCreate,
  handleLaborPensionList,
  type LaborPensionMainDependencies,
} from './labor-pension-main.handler.ts'
import { describeLaborPensionErrors, LABOR_PENSION_ENDPOINT_ERRORS } from './labor-pension-main.errors.ts'

/**
 * 自願提繳率。DB 欄位是 `decimal(5,4)`（資料字典：例如 6% 保存為 `0.0600`），因此整數部位最多
 * 1 位、小數固定 4 位——`^[0-9]\.[0-9]{4}$`。**值域上限不在這裡鎖死**：字典明文「可選比例由
 * 有效法規資料限制，不使用 DB ENUM 寫死」，本端點只驗證「這是不是一個 decimal(5,4) 存得下的字串」，
 * 實際可選比例是否合法由呼叫端對照法規資料自行判斷（本輪範圍不含法規比對，見回報）。
 */
const VoluntaryContributionRate = t.String({ pattern: '^[0-9]\\.[0-9]{4}$' })

const LaborPensionSettingDetailSchema = t.Object({
  id: Uuid,
  employeeId: Uuid,
  voluntaryContributionRate: VoluntaryContributionRate,
  effectiveFrom: IsoDate,
  effectiveTo: t.Union([IsoDate, t.Null()]),
  createdBy: Uuid,
  createdAt: t.String(),
  updatedAt: t.String(),
})

const LaborPensionSearchSchema = t.Object({ employeeId: Uuid })

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

export const laborPensionMainRoutes = (dependencies: LaborPensionMainDependencies) =>
  new Elysia({ name: 'labor-pension-main-routes' })
    .use(requestContext)
    .post('/labor-pension/main/list', (context) => handleLaborPensionList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('labor-pension.main.list'),
        employeeId: Uuid,
        ...PageRequest,
      }),
      response: {
        200: envelope(paginationResponse(LaborPensionSearchSchema, LaborPensionSettingDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢一位員工的勞退自願提繳率設定歷史',
        description: `${describeLaborPensionErrors(LABOR_PENSION_ENDPOINT_ERRORS.list)} 依生效日由舊到新排序。`,
      },
    })
    .post('/labor-pension/main/create', (context) => handleLaborPensionCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('labor-pension.main.create'),
        employeeId: Uuid,
        voluntaryContributionRate: VoluntaryContributionRate,
        effectiveFrom: IsoDate,
        effectiveTo: t.Optional(IsoDate),
      }),
      response: {
        200: envelope(LaborPensionSettingDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增勞退自願提繳率設定',
        description: `${describeLaborPensionErrors(LABOR_PENSION_ENDPOINT_ERRORS.create)} 只新增一筆，不自動結束既有設定（見 impl/labor-pension-main.create.service.ts 檔頭）。`,
      },
    })
