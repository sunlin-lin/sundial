/**
 * 部門歷史的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * **本輪新增 `create`。** 先前只有 `list`：那一輪的任務範圍明列「部門歷史的查詢」為交付項，
 * 建立動作留給 Stage 4（`employees/onboarding`）內部呼叫。但 UI 定案 `docs/ui/
 * 20-employee-list.md` §3.3「可以修改部門、職稱及一個或多個職務」需要前端能直接呼叫的建立端點
 * ——修改組織資料不會經過到職編排，形狀比照 `job-title-histories` 的 `create`（該模組先一步補上，
 * 這裡是同一個模式）。**期間重疊與鎖的邏輯不重寫**：`createDepartmentHistoryInTransaction`
 * 早已備妥（鎖的粒度＝任職），本檔只是把既有的業務動作接上 HTTP。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, IsoDate, PageRequest, paginationResponse, Uuid } from '../../../shared/field-schemas.ts'
import {
  handleDepartmentHistoryCreate,
  handleDepartmentHistoryList,
  type DepartmentHistoriesDependencies,
} from './employments-department-histories.handler.ts'
import {
  describeDepartmentHistoryErrors,
  DEPARTMENT_HISTORY_ENDPOINT_ERRORS,
} from './employments-department-histories.errors.ts'

const DepartmentHistoryDetailSchema = t.Object({
  id: Uuid,
  employmentId: Uuid,
  departmentId: Uuid,
  effectiveFrom: IsoDate,
  effectiveTo: t.Union([IsoDate, t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
})

const DepartmentHistorySearchSchema = t.Object({ employmentId: Uuid })

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/** 業務錯誤的回應形狀。409 與 422 在 envelope 上都是 `code='300'`，差別只在錯誤分組（§1.3）。 */
const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

export const employmentsDepartmentHistoriesRoutes = (dependencies: DepartmentHistoriesDependencies) =>
  new Elysia({ name: 'employments-department-histories-routes' })
    .use(requestContext)
    .post('/employments/department-histories/list', (context) => handleDepartmentHistoryList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employments.department-histories.list'),
        employmentId: Uuid,
        ...PageRequest,
      }),
      response: {
        200: envelope(paginationResponse(DepartmentHistorySearchSchema, DepartmentHistoryDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢一筆任職的部門歷史',
        description: `${describeDepartmentHistoryErrors(DEPARTMENT_HISTORY_ENDPOINT_ERRORS.list)} 依生效日由舊到新排序。`,
      },
    })
    .post(
      '/employments/department-histories/create',
      (context) => handleDepartmentHistoryCreate(dependencies, context),
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('employments.department-histories.create'),
          employmentId: Uuid,
          departmentId: Uuid,
          effectiveFrom: IsoDate,
          effectiveTo: t.Optional(IsoDate),
        }),
        response: {
          200: envelope(DepartmentHistoryDetailSchema),
          ...BusinessFailureResponses,
          ...CommonFailureResponses,
        },
        detail: {
          summary: '新增一筆部門歷史（同一任職同一時間僅一筆有效部門）',
          description: `${describeDepartmentHistoryErrors(DEPARTMENT_HISTORY_ENDPOINT_ERRORS.create)} UI 定案要求組織異動一律指定未來生效日（\`docs/ui/20-employee-list.md\` §3.3），本端點不強制檢查 \`effectiveFrom\` 是否為未來——那是前端輸入層的責任（日期選擇器只能選未來日）。`,
        },
      },
    )
