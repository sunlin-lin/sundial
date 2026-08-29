/**
 * 任職主檔的端點目錄（§0.4「routes 不拆」、§1.9）。形狀與理由比照 `departments-main.routes.ts`，
 * 不重述。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  IsoDate,
  Nullable,
  PageRequest,
  paginationResponse,
  sortRequest,
  Uuid,
} from '../../../shared/field-schemas.ts'
import { EMPLOYMENT_SORT_FIELDS } from './domain/employment-list-view.ts'
import {
  handleEmploymentCreate,
  handleEmploymentGet,
  handleEmploymentLeave,
  handleEmploymentList,
  type EmploymentsMainDependencies,
} from './employments-main.handler.ts'
import { describeEmploymentErrors, EMPLOYMENT_ENDPOINT_ERRORS } from './employments-main.errors.ts'

/**
 * 僱用型態代碼，聯集字面值（§2）。值必須與 `db/schema/employee-employments.ts` 的
 * `EmploymentTypeCode` 相同：1 正職、2 兼職、3 約聘、4 派遣、5 工讀、6 臨時、7 顧問、8 實習
 * （資料字典列舉）。不直接 import 那個常數，理由與其他模組的同類 schema 相同（路由層不相依
 * 資料庫 schema）。
 */
const EmploymentTypeCodeSchema = t.Union([1, 2, 3, 4, 5, 6, 7, 8].map((value) => t.Literal(value)))

/** 任職性質代碼、離職原因代碼：字典未列舉值，開放任意正整數（見 `db/schema/employee-employments.ts`）。 */
const OpenCode = t.Integer({ minimum: 1 })

const EmploymentStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('LEFT')])

const EmploymentDetailSchema = t.Object({
  id: Uuid,
  employeeId: Uuid,
  employmentTypeCode: EmploymentTypeCodeSchema,
  employmentNatureCode: Nullable(OpenCode),
  hireDate: IsoDate,
  leaveDate: Nullable(IsoDate),
  lastWorkingDate: Nullable(IsoDate),
  leaveReasonCode: Nullable(OpenCode),
  status: EmploymentStatusSchema,
  createdAt: t.String(),
  updatedAt: t.String(),
})

const EmploymentSearchSchema = t.Object({
  employeeId: t.Optional(Uuid),
})

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

/**
 * 任職主檔的端點。
 *
 * @param dependencies 由組裝點注入的資料庫與 clock。不在模組層建立連線（§1.7）。
 */
export const employmentsMainRoutes = (dependencies: EmploymentsMainDependencies) =>
  new Elysia({ name: 'employments-main-routes' })
    .use(requestContext)
    .post('/employments/main/list', (context) => handleEmploymentList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employments.main.list'),
        employeeId: t.Optional(Uuid),
        ...PageRequest,
        sort: t.Optional(sortRequest(EMPLOYMENT_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(EmploymentSearchSchema, EmploymentDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢任職清單',
        description: `${describeEmploymentErrors(EMPLOYMENT_ENDPOINT_ERRORS.list)} employeeId 未帶時查詢整間公司。`,
      },
    })
    .post('/employments/main/get', (context) => handleEmploymentGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('employments.main.get'), id: Uuid }),
      response: {
        200: envelope(Nullable(EmploymentDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單一任職',
        description: describeEmploymentErrors(EMPLOYMENT_ENDPOINT_ERRORS.get),
      },
    })
    .post('/employments/main/create', (context) => handleEmploymentCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employments.main.create'),
        employeeId: Uuid,
        employmentTypeCode: EmploymentTypeCodeSchema,
        employmentNatureCode: t.Optional(OpenCode),
        hireDate: IsoDate,
        // 刻意沒有 status／離職三欄：新任職一律 ACTIVE，離職是獨立動作（見 domain 型別註解）。
      }),
      response: {
        200: envelope(EmploymentDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增任職',
        description: describeEmploymentErrors(EMPLOYMENT_ENDPOINT_ERRORS.create),
      },
    })
    .post('/employments/main/leave', (context) => handleEmploymentLeave(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employments.main.leave'),
        id: Uuid,
        leaveDate: IsoDate,
        lastWorkingDate: IsoDate,
        leaveReasonCode: OpenCode,
        // 三欄在 schema 層一律必填：離職本來就不是「填一部分」的動作（計畫 §7 的「三缺一即錯」
        // 在這裡直接由必填欄位表達，不必等到 service 層才發現漏填）。
      }),
      response: {
        200: envelope(EmploymentDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '辦理離職',
        description: `${describeEmploymentErrors(EMPLOYMENT_ENDPOINT_ERRORS.leave)} 完成後同步停用該員工的公司帳號，但不刪除帳號與角色歷史（計畫 §7）。`,
      },
    })
