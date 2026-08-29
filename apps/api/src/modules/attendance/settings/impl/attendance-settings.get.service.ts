/**
 * 業務動作：查詢目前的出勤設定。
 *
 * 查無資料回 `null`（§1.3「查無資料不是 404」）——**這裡的 `null` 是誠實的「這間公司還沒有存過
 * 設定」，不是「取不到值所以先給你一組預設值」**（實作計畫已定案，見 `db/schema/
 * attendance-settings.ts` 檔頭）。呼叫端如果需要「沒有設定時的預設行為」，那是消費端自己的判斷，
 * 不在這支查詢的職責內。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceSettingsContext } from '../domain/attendance-settings-context.ts'
import type { AttendanceSettingsDetail } from '../domain/attendance-settings-model.ts'
import { findAttendanceSettings } from '../attendance-settings.repository.ts'

export const getAttendanceSettings = async (
  context: AttendanceSettingsContext,
): Promise<ServiceResult<AttendanceSettingsDetail | null>> =>
  succeed(await findAttendanceSettings(context.db, context.companyId))
