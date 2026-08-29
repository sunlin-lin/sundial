/** 扣繳設定的端點目錄（§0.4「routes 不拆」、§1.9）。形狀比照 `employments-main.routes.ts`。 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, IsoDate, PageRequest, paginationResponse, Uuid } from '../../../shared/field-schemas.ts'
import {
  handleWithholdingCreate,
  handleWithholdingList,
  type WithholdingMainDependencies,
} from './withholding-main.handler.ts'
import { describeWithholdingErrors, WITHHOLDING_ENDPOINT_ERRORS } from './withholding-main.errors.ts'

/** 扣繳方式代碼，聯集字面值（§2）。值必須與 `db/schema/employee-withholding-settings.ts` 的 `WithholdingMethodCode` 相同：1 薪資所得扣繳稅額表、2 固定 5%。 */
const WithholdingMethodCodeSchema = t.Union([t.Literal(1), t.Literal(2)])

const WithholdingSettingDetailSchema = t.Object({
  id: Uuid,
  employeeId: Uuid,
  withholdingMethodCode: WithholdingMethodCodeSchema,
  effectiveFrom: IsoDate,
  effectiveTo: t.Union([IsoDate, t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
})

const WithholdingSearchSchema = t.Object({ employeeId: Uuid })

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

export const withholdingMainRoutes = (dependencies: WithholdingMainDependencies) =>
  new Elysia({ name: 'withholding-main-routes' })
    .use(requestContext)
    .post('/withholding/main/list', (context) => handleWithholdingList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('withholding.main.list'),
        employeeId: Uuid,
        ...PageRequest,
      }),
      response: {
        200: envelope(paginationResponse(WithholdingSearchSchema, WithholdingSettingDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢一位員工的扣繳設定歷史',
        description: `${describeWithholdingErrors(WITHHOLDING_ENDPOINT_ERRORS.list)} 依生效日由舊到新排序。`,
      },
    })
    .post('/withholding/main/create', (context) => handleWithholdingCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('withholding.main.create'),
        employeeId: Uuid,
        withholdingMethodCode: WithholdingMethodCodeSchema,
        effectiveFrom: IsoDate,
        effectiveTo: t.Optional(IsoDate),
      }),
      response: {
        200: envelope(WithholdingSettingDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增扣繳設定',
        description: `${describeWithholdingErrors(WITHHOLDING_ENDPOINT_ERRORS.create)} 只新增一筆，不自動結束既有設定（見 impl/withholding-main.create.service.ts 檔頭）。`,
      },
    })
