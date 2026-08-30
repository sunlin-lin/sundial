/** 補打卡申請的資料存取入口（§0.4）。逐一薄委派到 `impl/` 底下的切片，形狀比照 `attendance/
 * records/attendance-records.repository.ts`。 */
import type { QueryRunner } from '../../../db/client.ts'
import type {
  AttendanceCorrectionRequestDetail,
  AttendanceTypeCodeValue,
  ListOwnAttendanceCorrectionRequestsPage,
  ListOwnAttendanceCorrectionRequestsQuery,
} from './domain/attendance-correction-request-model.ts'
import type { AttendanceCorrectionRequestInsertOutcome } from './domain/attendance-correction-request-duplicate.ts'
import {
  findAttendanceCorrectionRequestDetail as findAttendanceCorrectionRequestDetailImpl,
  findPendingAttendanceCorrectionRequest as findPendingAttendanceCorrectionRequestImpl,
} from './impl/attendance-correction-requests.find-detail.repository.ts'
import {
  findActiveEmploymentIdForOperator as findActiveEmploymentIdForOperatorImpl,
  findEmployeeIdForCompanyUser as findEmployeeIdForCompanyUserImpl,
} from './impl/attendance-correction-requests.find-operator-employment.repository.ts'
import {
  insertAttendanceCorrectionRequest as insertAttendanceCorrectionRequestImpl,
  type NewAttendanceCorrectionRequest,
} from './impl/attendance-correction-requests.insert.repository.ts'
import {
  markAttendanceCorrectionRequestWithdrawn as markAttendanceCorrectionRequestWithdrawnImpl,
  type WithdrawAttendanceCorrectionRequestUpdate,
} from './impl/attendance-correction-requests.mark-withdrawn.repository.ts'
import { listOwnAttendanceCorrectionRequests as listOwnAttendanceCorrectionRequestsImpl } from './impl/attendance-correction-requests.list-own.repository.ts'

export type { QueryRunner }
export type { NewAttendanceCorrectionRequest, WithdrawAttendanceCorrectionRequestUpdate }
export type { AttendanceCorrectionRequestInsertOutcome }

export const findEmployeeIdForCompanyUser = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<string | null> => findEmployeeIdForCompanyUserImpl(runner, companyId, companyUserId)

export const findActiveEmploymentIdForOperator = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<{ readonly employeeId: string; readonly employmentId: string } | null> =>
  findActiveEmploymentIdForOperatorImpl(runner, companyId, companyUserId)

export const findAttendanceCorrectionRequestDetail = (
  runner: QueryRunner,
  companyId: string,
  requestId: string,
): Promise<AttendanceCorrectionRequestDetail | null> =>
  findAttendanceCorrectionRequestDetailImpl(runner, companyId, requestId)

export const findPendingAttendanceCorrectionRequest = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  workDate: string,
  attendanceTypeCode: AttendanceTypeCodeValue,
): Promise<{ readonly id: string } | null> =>
  findPendingAttendanceCorrectionRequestImpl(runner, companyId, employeeId, workDate, attendanceTypeCode)

export const insertAttendanceCorrectionRequest = (
  runner: QueryRunner,
  companyId: string,
  request: NewAttendanceCorrectionRequest,
): Promise<AttendanceCorrectionRequestInsertOutcome> =>
  insertAttendanceCorrectionRequestImpl(runner, companyId, request)

export const markAttendanceCorrectionRequestWithdrawn = (
  runner: QueryRunner,
  companyId: string,
  requestId: string,
  update: WithdrawAttendanceCorrectionRequestUpdate,
): Promise<number> => markAttendanceCorrectionRequestWithdrawnImpl(runner, companyId, requestId, update)

export const listOwnAttendanceCorrectionRequests = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  query: ListOwnAttendanceCorrectionRequestsQuery,
): Promise<ListOwnAttendanceCorrectionRequestsPage> =>
  listOwnAttendanceCorrectionRequestsImpl(runner, companyId, employeeId, query)
