/**
 * 打卡的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：業務拒絕一律以
 * `ServiceResult` 的失敗結果 ＋ 具名分組表達。
 *
 * 六個動作：`create`（打卡）、`revoke`（本人撤銷）、`revokeOther`（他人撤銷）、`get`（單筆明細）、
 * `listByDate`（依日期查全公司打卡）、`listOwnByDate`（依日期查本人打卡，Stage 5 補的端點，
 * 見 `attendance-records.routes.ts` 端點說明）。
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { AttendanceRecordsContext } from './domain/attendance-record-context.ts'
import type {
  AttendanceRecordDetail,
  CreateAttendanceRecordInput,
  GetAttendanceRecordInput,
  ListAttendanceRecordsByDatePage,
  ListAttendanceRecordsByDateQuery,
  ListOwnAttendanceRecordsByDatePage,
  ListOwnAttendanceRecordsByDateQuery,
  RevokeOtherAttendanceRecordInput,
  RevokeOwnAttendanceRecordInput,
} from './domain/attendance-record-model.ts'
import { createAttendanceRecord as createAttendanceRecordImpl } from './impl/attendance-records.create.service.ts'
import { revokeOwnAttendanceRecord as revokeOwnAttendanceRecordImpl } from './impl/attendance-records.revoke.service.ts'
import { revokeOtherAttendanceRecord as revokeOtherAttendanceRecordImpl } from './impl/attendance-records.revoke-other.service.ts'
import {
  getAttendanceRecord as getAttendanceRecordImpl,
  type AttendanceRecordView,
} from './impl/attendance-records.get.service.ts'
import { listAttendanceRecordsByDate as listAttendanceRecordsByDateImpl } from './impl/attendance-records.list-by-date.service.ts'
import { listOwnAttendanceRecordsByDate as listOwnAttendanceRecordsByDateImpl } from './impl/attendance-records.list-own-by-date.service.ts'

export type { AttendanceRecordsContext }
export type { AttendanceRecordView }
export type {
  AttendanceRecordCoordinates,
  AttendanceRecordDetail,
  AttendanceRecordListItem,
  CreateAttendanceRecordInput,
  GetAttendanceRecordInput,
  ListAttendanceRecordsByDatePage,
  ListAttendanceRecordsByDateQuery,
  ListOwnAttendanceRecordsByDatePage,
  ListOwnAttendanceRecordsByDateQuery,
  OwnAttendanceRecordListItem,
  RevokeOtherAttendanceRecordInput,
  RevokeOwnAttendanceRecordInput,
} from './domain/attendance-record-model.ts'
export { isPeriodLocked } from './domain/attendance-record-period-lock.ts'

export const createAttendanceRecord = (
  context: AttendanceRecordsContext,
  input: CreateAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => createAttendanceRecordImpl(context, input)

export const revokeOwnAttendanceRecord = (
  context: AttendanceRecordsContext,
  input: RevokeOwnAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => revokeOwnAttendanceRecordImpl(context, input)

export const revokeOtherAttendanceRecord = (
  context: AttendanceRecordsContext,
  input: RevokeOtherAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => revokeOtherAttendanceRecordImpl(context, input)

export const getAttendanceRecord = (
  context: AttendanceRecordsContext,
  input: GetAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordView | null>> => getAttendanceRecordImpl(context, input)

export const listAttendanceRecordsByDate = (
  context: AttendanceRecordsContext,
  query: ListAttendanceRecordsByDateQuery,
): Promise<ServiceResult<ListAttendanceRecordsByDatePage>> => listAttendanceRecordsByDateImpl(context, query)

export const listOwnAttendanceRecordsByDate = (
  context: AttendanceRecordsContext,
  query: ListOwnAttendanceRecordsByDateQuery,
): Promise<ServiceResult<ListOwnAttendanceRecordsByDatePage>> => listOwnAttendanceRecordsByDateImpl(context, query)
