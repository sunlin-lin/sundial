/**
 * 部門歷史的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * **只有 `list`，沒有 `create`。** 這是刻意的最小交付，不是遺漏：
 * Stage 3（本輪）的任務範圍明列「部門歷史的查詢」為交付項，沒有要求建立端點——部門歷史的
 * 建立目前只發生在「新增員工」單頁流程裡（計畫 §3.1 表格：部門歷史依附於任職與部門），
 * 而那條編排線是 Stage 4（`employees/onboarding`）的工作，不在本輪範圍。`createDepartmentHistory`
 * 這個業務動作已經備妥（`employments-department-histories.service.ts`），Stage 4 要接上時
 * 直接呼叫即可，不需要重新設計期間重疊與鎖的邏輯。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, IsoDate, PageRequest, paginationResponse, Uuid } from '../../../shared/field-schemas.ts'
import {
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
