/** 眷屬的端點目錄（§0.4「routes 不拆」、§1.9）。形狀比照 `employments-main.routes.ts`。 */
import { Elysia, t } from 'elysia'
import { Type } from '@sinclair/typebox'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, IsoDate, PageRequest, paginationResponse, Uuid } from '../../../shared/field-schemas.ts'
import {
  handleDependentCreate,
  handleDependentList,
  handleDependentTerminate,
  type DependentsMainDependencies,
} from './dependents-main.handler.ts'
import { describeDependentErrors, DEPENDENT_ENDPOINT_ERRORS } from './dependents-main.errors.ts'

/** 眷屬關係代碼，見字典列舉：1 配偶、2 父、3 母、4 子女、5 兄弟姊妹、6 祖父母、7 孫子女、8 其他。 */
const RelationshipCodeSchema = t.Union([1, 2, 3, 4, 5, 6, 7, 8].map((value) => t.Literal(value)))

const DependentStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('TERMINATED')])

const DependentDetailSchema = t.Object({
  id: Uuid,
  employeeId: Uuid,
  name: t.String(),
  identityNumberMasked: t.String(),
  birthdayMasked: t.String(),
  relationshipCode: RelationshipCodeSchema,
  // 回應方向欄位，一律用 TypeBox 原生的 Type.Boolean，不是 Elysia 可強制轉型的 t.Boolean
  // （見 check-response-coercion.ts 檔頭）。create 的 body 另有自己一組 t.Boolean()（見下方），
  // 兩邊是各自獨立的欄位宣告，不是同一個常數，因此各自維持各自方向該有的型別。
  isStudent: Type.Boolean(),
  isDisabled: Type.Boolean(),
  isUnableToWork: Type.Boolean(),
  isCohabiting: Type.Boolean(),
  effectiveDate: IsoDate,
  endDate: t.Union([IsoDate, t.Null()]),
  status: DependentStatusSchema,
  createdAt: t.String(),
  updatedAt: t.String(),
})

const DependentSearchSchema = t.Object({ employeeId: Uuid })

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

export const dependentsMainRoutes = (dependencies: DependentsMainDependencies) =>
  new Elysia({ name: 'dependents-main-routes' })
    .use(requestContext)
    .post('/dependents/main/list', (context) => handleDependentList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('dependents.main.list'),
        employeeId: Uuid,
        ...PageRequest,
      }),
      response: {
        200: envelope(paginationResponse(DependentSearchSchema, DependentDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢一位員工的眷屬清單',
        description: `${describeDependentErrors(DEPENDENT_ENDPOINT_ERRORS.list)} 依開始列入扶養日期由舊到新排序；身分證字號一律遮罩（§5.1）。`,
      },
    })
    .post('/dependents/main/create', (context) => handleDependentCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('dependents.main.create'),
        employeeId: Uuid,
        name: t.String({ minLength: 1, maxLength: 128 }),
        // 身分證字號樣式與理由：見 `employees-main.routes.ts` 的 `IdentityNumber`，逐字相同。
        identityNumber: t.String({ pattern: '^[A-Za-z][A-Za-z0-9]\\d{8}$' }),
        birthday: IsoDate,
        relationshipCode: RelationshipCodeSchema,
        isStudent: t.Boolean(),
        isDisabled: t.Boolean(),
        isUnableToWork: t.Boolean(),
        isCohabiting: t.Boolean(),
        effectiveDate: IsoDate,
      }),
      response: {
        200: envelope(DependentDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增眷屬（扶養親屬）',
        description: `${describeDependentErrors(DEPENDENT_ENDPOINT_ERRORS.create)} 可以新增時一併填寫，也可以在員工建立後補登（UI 定案 docs/ui/20-employee-list.md §2.3）。`,
      },
    })
    .post('/dependents/main/terminate', (context) => handleDependentTerminate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('dependents.main.terminate'),
        id: Uuid,
        endDate: IsoDate,
      }),
      response: {
        200: envelope(DependentDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '終止扶養（UI 定案 docs/ui/20-employee-list.md §3.4）',
        description: `${describeDependentErrors(DEPENDENT_ENDPOINT_ERRORS.terminate)} 對既有列做條件式更新，不是新增一筆；終止後不刪除紀錄。`,
      },
    })
