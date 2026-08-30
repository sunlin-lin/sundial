/**
 * 出勤判定結果的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派或直接匯出。** 業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）。
 *
 * 本階段（Stage 4）兩個動作：
 * - `recalculateAttendanceResultForWorkDay`：重算單一員工單一工作日，收 `TransactionRunner`，
 *   供 `attendance/records` 的 `revoke`／`revoke-other` 編排進同一筆交易；不是端點，不對外開放。
 * - `recalculateAllNoScheduleAttendanceResults`：重算全部 `NO_SCHEDULE` 紀錄，是本階段唯一的
 *   端點動作。
 *
 * 判定引擎本身（`computeAttendanceResult`）與 `Schedule` 型別也在這裡 re-export——`attendance/
 * records` 的 `revoke`／`revoke-other` 不需要它們（只需要上面第一個動作），但排班（第 3 層）
 * 上線時，會需要從 `modules/attendance/index.ts` 這個唯一出口拿到 `Schedule` 型別與判定引擎，
 * 不應該再往 `impl/`／`domain/` 內部挖。
 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { AttendanceResultsContext } from './domain/attendance-result-context.ts'
import type {
  RecalculateAllNoScheduleResult,
  RecalculateAttendanceResultInput,
} from './domain/attendance-result-model.ts'
import type {
  ListAttendanceResultsPage,
  ListAttendanceResultsQuery,
  ListOwnAttendanceResultsPage,
  ListOwnAttendanceResultsQuery,
} from './domain/attendance-result-list-view.ts'
import { recalculateAttendanceResultForWorkDay as recalculateAttendanceResultForWorkDayImpl } from './impl/attendance-results.recalculate-work-day.service.ts'
import { recalculateAllNoScheduleAttendanceResults as recalculateAllNoScheduleAttendanceResultsImpl } from './impl/attendance-results.recalculate-no-schedule.service.ts'
import { listAttendanceResults as listAttendanceResultsImpl } from './impl/attendance-results.list.service.ts'
import { listOwnAttendanceResults as listOwnAttendanceResultsImpl } from './impl/attendance-results.list-own.service.ts'

export type { AttendanceResultsContext }
export type {
  AttendanceResultComputation,
  AttendanceResultEvent,
  RecalculateAllNoScheduleResult,
  RecalculateAttendanceResultInput,
  Schedule,
} from './domain/attendance-result-model.ts'
export type {
  AttendanceResultListItem,
  ListAttendanceResultsPage,
  ListAttendanceResultsQuery,
  ListOwnAttendanceResultsPage,
  ListOwnAttendanceResultsQuery,
  OwnAttendanceResultListItem,
} from './domain/attendance-result-list-view.ts'
export { computeAttendanceResult } from './domain/attendance-result-engine.ts'

/** 重算單一員工單一工作日（供 `revoke`／`revoke-other` 編排進同一筆交易，見檔頭）。 */
export const recalculateAttendanceResultForWorkDay = (
  tx: TransactionRunner,
  companyId: string,
  input: RecalculateAttendanceResultInput,
  now: string,
): Promise<void> => recalculateAttendanceResultForWorkDayImpl(tx, companyId, input, now)

/** 重算全部 `NO_SCHEDULE` 紀錄（本階段唯一的端點動作）。 */
export const recalculateAllNoScheduleAttendanceResults = (
  context: AttendanceResultsContext,
): Promise<ServiceResult<RecalculateAllNoScheduleResult>> => recalculateAllNoScheduleAttendanceResultsImpl(context)

/** 全體出勤（公司範圍，UI 09，Stage 7）。 */
export const listAttendanceResults = (
  context: AttendanceResultsContext,
  query: ListAttendanceResultsQuery,
): Promise<ServiceResult<ListAttendanceResultsPage>> => listAttendanceResultsImpl(context, query)

/** 我的出勤（本人範圍，UI 12，Stage 7）。 */
export const listOwnAttendanceResults = (
  context: AttendanceResultsContext,
  query: ListOwnAttendanceResultsQuery,
): Promise<ServiceResult<ListOwnAttendanceResultsPage>> => listOwnAttendanceResultsImpl(context, query)
