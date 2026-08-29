/** 打卡的資料存取入口（§0.4）。逐一薄委派到 `impl/` 底下的切片，形狀比照 `employments/
 * job-title-histories/employments-job-title-histories.repository.ts`。 */
import type { QueryRunner } from '../../../db/client.ts'
import type {
  AttendanceRecordDetail,
  AttendanceTypeCodeValue,
  ListAttendanceRecordsByDatePage,
  ListAttendanceRecordsByDateQuery,
} from './domain/attendance-record-model.ts'
import type { AttendanceRecordInsertOutcome } from './domain/attendance-record-duplicate.ts'
import { findAttendanceRecordDetail as findAttendanceRecordDetailImpl } from './impl/attendance-records.find-detail.repository.ts'
import { findEmploymentForUpdate as findEmploymentForUpdateImpl } from './impl/attendance-records.find-employment-for-update.repository.ts'
import {
  findValidPunchOnDate as findValidPunchOnDateImpl,
  findPairingClockInWorkDate as findPairingClockInWorkDateImpl,
} from './impl/attendance-records.find-punch.repository.ts'
import {
  findActiveEmploymentIdForOperator as findActiveEmploymentIdForOperatorImpl,
  findEmployeeIdForCompanyUser as findEmployeeIdForCompanyUserImpl,
} from './impl/attendance-records.find-operator-employment.repository.ts'
import {
  insertAttendanceRecord as insertAttendanceRecordImpl,
  type NewAttendanceRecord,
} from './impl/attendance-records.insert.repository.ts'
import {
  markAttendanceRecordRevoked as markAttendanceRecordRevokedImpl,
  type RevokeAttendanceRecordUpdate,
} from './impl/attendance-records.revoke.repository.ts'
import { listAttendanceRecordsByDate as listAttendanceRecordsByDateImpl } from './impl/attendance-records.list-by-date.repository.ts'

export type { QueryRunner }
export type { NewAttendanceRecord, RevokeAttendanceRecordUpdate, AttendanceRecordInsertOutcome }

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

export const findEmploymentForUpdate = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<{ readonly id: string; readonly employeeId: string } | null> =>
  findEmploymentForUpdateImpl(runner, companyId, employmentId)

export const findValidPunchOnDate = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
  workDate: string,
  attendanceTypeCode: AttendanceTypeCodeValue,
): Promise<{ readonly id: string } | null> =>
  findValidPunchOnDateImpl(runner, companyId, employmentId, workDate, attendanceTypeCode)

export const findPairingClockInWorkDate = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<string | null> => findPairingClockInWorkDateImpl(runner, companyId, employmentId)

export const insertAttendanceRecord = (
  runner: QueryRunner,
  companyId: string,
  record: NewAttendanceRecord,
): Promise<AttendanceRecordInsertOutcome> => insertAttendanceRecordImpl(runner, companyId, record)

export const findAttendanceRecordDetail = (
  runner: QueryRunner,
  companyId: string,
  recordId: string,
): Promise<AttendanceRecordDetail | null> => findAttendanceRecordDetailImpl(runner, companyId, recordId)

export const markAttendanceRecordRevoked = (
  runner: QueryRunner,
  companyId: string,
  recordId: string,
  update: RevokeAttendanceRecordUpdate,
): Promise<number> => markAttendanceRecordRevokedImpl(runner, companyId, recordId, update)

export const listAttendanceRecordsByDate = (
  runner: QueryRunner,
  companyId: string,
  query: ListAttendanceRecordsByDateQuery,
): Promise<ListAttendanceRecordsByDatePage> => listAttendanceRecordsByDateImpl(runner, companyId, query)
