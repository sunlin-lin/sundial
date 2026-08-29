/** 出勤判定結果的資料存取入口（§0.4）。逐一薄委派到 `impl/` 底下的切片，形狀比照
 * `attendance/records/attendance-records.repository.ts`。 */
import type { QueryRunner } from '../../../db/client.ts'
import type { AttendanceResultEvent } from './domain/attendance-result-model.ts'
import {
  findAttendanceResultEventRows as findAttendanceResultEventRowsImpl,
  findAttendanceResultEventsForWorkDay as findAttendanceResultEventsForWorkDayImpl,
  type AttendanceEventRow,
} from './impl/attendance-results.find-events.repository.ts'
import {
  findNoScheduleAttendanceResults as findNoScheduleAttendanceResultsImpl,
  type PendingAttendanceResult,
} from './impl/attendance-results.find-pending.repository.ts'
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
