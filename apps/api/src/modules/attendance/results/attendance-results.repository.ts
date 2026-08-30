/** 出勤判定結果的資料存取入口（§0.4）。逐一薄委派到 `impl/` 底下的切片，形狀比照
 * `attendance/records/attendance-records.repository.ts`。 */
import type { QueryRunner } from '../../../db/client.ts'
import type { AttendanceResultEvent } from './domain/attendance-result-model.ts'
import type {
  ListAttendanceResultsPage,
  ListAttendanceResultsQuery,
  ListOwnAttendanceResultsPage,
  ListOwnAttendanceResultsQuery,
} from './domain/attendance-result-list-view.ts'
import { findEmployeeIdForCompanyUser as findEmployeeIdForCompanyUserImpl } from './impl/attendance-results.find-employee-for-company-user.repository.ts'
import {
  findAttendanceResultEventRows as findAttendanceResultEventRowsImpl,
  findAttendanceResultEventsForWorkDay as findAttendanceResultEventsForWorkDayImpl,
  type AttendanceEventRow,
} from './impl/attendance-results.find-events.repository.ts'
import {
  findNoScheduleAttendanceResults as findNoScheduleAttendanceResultsImpl,
  type PendingAttendanceResult,
} from './impl/attendance-results.find-pending.repository.ts'
import { listAttendanceResults as listAttendanceResultsImpl } from './impl/attendance-results.list.repository.ts'
import { listOwnAttendanceResults as listOwnAttendanceResultsImpl } from './impl/attendance-results.list-own.repository.ts'
import {
  upsertAttendanceResults as upsertAttendanceResultsImpl,
  type UpsertAttendanceResultRow,
} from './impl/attendance-results.upsert.repository.ts'

export type { QueryRunner }
export type { AttendanceEventRow, PendingAttendanceResult, UpsertAttendanceResultRow }

export const findAttendanceResultEventsForWorkDay = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  workDate: string,
): Promise<readonly AttendanceResultEvent[]> =>
  findAttendanceResultEventsForWorkDayImpl(runner, companyId, employeeId, workDate)

export const findAttendanceResultEventRows = (
  runner: QueryRunner,
  companyId: string,
  employeeIds: readonly string[],
  workDates: readonly string[],
): Promise<readonly AttendanceEventRow[]> =>
  findAttendanceResultEventRowsImpl(runner, companyId, employeeIds, workDates)

export const findNoScheduleAttendanceResults = (
  runner: QueryRunner,
  companyId: string,
): Promise<readonly PendingAttendanceResult[]> => findNoScheduleAttendanceResultsImpl(runner, companyId)

export const upsertAttendanceResults = (
  runner: QueryRunner,
  companyId: string,
  rows: readonly UpsertAttendanceResultRow[],
): Promise<void> => upsertAttendanceResultsImpl(runner, companyId, rows)

/** 由 `company_user` 查出他連結的員工 id（`list-own` 用來把範圍限定在呼叫者本人）。 */
export const findEmployeeIdForCompanyUser = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<string | null> => findEmployeeIdForCompanyUserImpl(runner, companyId, companyUserId)

/** 全體出勤（公司範圍，UI 09）。 */
export const listAttendanceResults = (
  runner: QueryRunner,
  companyId: string,
  query: ListAttendanceResultsQuery,
): Promise<ListAttendanceResultsPage> => listAttendanceResultsImpl(runner, companyId, query)

/** 我的出勤（本人範圍，UI 12）。 */
export const listOwnAttendanceResults = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  query: ListOwnAttendanceResultsQuery,
): Promise<ListOwnAttendanceResultsPage> => listOwnAttendanceResultsImpl(runner, companyId, employeeId, query)
