/**
 * 出勤設定的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：業務拒絕一律以
 * `ServiceResult` 的失敗結果 ＋ 具名分組表達。
 *
 * **只有 `get`／`update` 兩個動作**：這張表一間公司一筆，`update` 在公司從未存過設定時等同
 * 「建立」（`impl/attendance-settings.update.service.ts` 檔頭），沒有獨立的 `create`；也沒有
 * `list`／`delete`（`db/schema/attendance-settings.ts` 檔頭已說明理由）。
 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { AttendanceSettingsContext } from './domain/attendance-settings-context.ts'
import type { AttendanceSettingsDetail, UpdateAttendanceSettingsInput } from './domain/attendance-settings-model.ts'
import { getAttendanceSettings as getAttendanceSettingsImpl } from './impl/attendance-settings.get.service.ts'
import { upsertAttendanceSettingsInTransaction as upsertAttendanceSettingsInTransactionImpl } from './impl/attendance-settings.update.service.ts'

export type { AttendanceSettingsContext }
export type {
  AttendanceSettingsDetail,
  AttendanceSettingsToggles,
  UpdateAttendanceSettingsInput,
} from './domain/attendance-settings-model.ts'

export const getAttendanceSettings = (
  context: AttendanceSettingsContext,
): Promise<ServiceResult<AttendanceSettingsDetail | null>> => getAttendanceSettingsImpl(context)

/** 查詢或建立／更新出勤設定。自己開交易，給單一端點用。 */
export const upsertAttendanceSettings = (
  context: AttendanceSettingsContext,
  input: UpdateAttendanceSettingsInput,
): Promise<ServiceResult<AttendanceSettingsDetail>> =>
  context.db.transaction((tx) => upsertAttendanceSettingsInTransactionImpl(tx, context, input))

/** 查詢或建立／更新出勤設定。收外部交易 handle，供未來 Stage 4 起若有編排點需要時使用。 */
export const upsertAttendanceSettingsInTransaction = (
  tx: TransactionRunner,
  context: AttendanceSettingsContext,
  input: UpdateAttendanceSettingsInput,
): Promise<ServiceResult<AttendanceSettingsDetail>> => upsertAttendanceSettingsInTransactionImpl(tx, context, input)
