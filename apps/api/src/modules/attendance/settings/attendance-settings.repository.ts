/**
 * 出勤設定的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體對資料庫做了哪些事、
 * 各自收什麼、回什麼，一頁看完；實作在 `impl/` 底下，一個動作一個檔。
 *
 * 本檔（含 `impl/`）是本模組唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）——要資料一律走 service。
 *
 * **只有三支函式，沒有 `list`／`delete`**：這張表一間公司一筆（見 `db/schema/
 * attendance-settings.ts` 檔頭），查詢只需要「找這間公司的那一筆」，寫入只需要「插入第一筆」
 * 與「更新既有那一筆」。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { AttendanceSettingsDetail } from './domain/attendance-settings-model.ts'
import { findAttendanceSettings as findAttendanceSettingsImpl } from './impl/attendance-settings.find.repository.ts'
import {
  insertAttendanceSettings as insertAttendanceSettingsImpl,
  type NewAttendanceSettings,
} from './impl/attendance-settings.insert.repository.ts'
import {
  updateAttendanceSettingsProfile as updateAttendanceSettingsProfileImpl,
  type AttendanceSettingsProfileUpdate,
} from './impl/attendance-settings.update-profile.repository.ts'
import type { AttendanceSettingsInsertOutcome } from './domain/attendance-settings-duplicate.ts'

export type { AttendanceSettingsProfileUpdate, NewAttendanceSettings }

/** 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別（§4.2 的封裝要的就是這一組）。 */
export type { QueryRunner }

export const findAttendanceSettings = (
  runner: QueryRunner,
  companyId: string,
): Promise<AttendanceSettingsDetail | null> => findAttendanceSettingsImpl(runner, companyId)

export const insertAttendanceSettings = (
  runner: QueryRunner,
  companyId: string,
  settings: NewAttendanceSettings,
): Promise<AttendanceSettingsInsertOutcome> => insertAttendanceSettingsImpl(runner, companyId, settings)

export const updateAttendanceSettingsProfile = (
  runner: QueryRunner,
  companyId: string,
  id: string,
  update: AttendanceSettingsProfileUpdate,
): Promise<void> => updateAttendanceSettingsProfileImpl(runner, companyId, id, update)
