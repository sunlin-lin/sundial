/**
 * 班別主檔的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體對資料庫做了哪些事、
 * 各自收什麼、回什麼，一頁看完；實作在 `impl/` 底下，一個動作一個檔。
 *
 * 本檔（含 `impl/`）是本模組唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）——要資料一律走 service。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { ShiftDetail, ShiftListPage, ShiftListQuery } from './domain/shift-model.ts'
import type { ShiftInsertOutcome } from './domain/shift-duplicate.ts'
import { findShiftDetail as findShiftDetailImpl } from './impl/shifts-main.find.repository.ts'
import { insertShift as insertShiftImpl, type NewShift } from './impl/shifts-main.insert.repository.ts'
import { listShiftPage as listShiftPageImpl } from './impl/shifts-main.list.repository.ts'
import {
  markShiftDeleted as markShiftDeletedImpl,
  type ShiftDeletion,
} from './impl/shifts-main.mark-deleted.repository.ts'
import { replaceShiftChildren as replaceShiftChildrenImpl } from './impl/shifts-main.replace-children.repository.ts'
import {
  updateShiftProfile as updateShiftProfileImpl,
  type ShiftProfileUpdate,
  type ShiftProfileUpdateOutcome,
} from './impl/shifts-main.update-profile.repository.ts'
import type { ShiftBreak, ShiftWorkPeriod } from './domain/shift-model.ts'

export type { NewShift, ShiftDeletion, ShiftProfileUpdate, ShiftProfileUpdateOutcome }

/** 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別（§4.2 的封裝要的就是這一組）。 */
export type { QueryRunner }

export const findShiftDetail = (runner: QueryRunner, companyId: string, shiftId: string): Promise<ShiftDetail | null> =>
  findShiftDetailImpl(runner, companyId, shiftId)

export const listShiftPage = (runner: QueryRunner, companyId: string, query: ShiftListQuery): Promise<ShiftListPage> =>
  listShiftPageImpl(runner, companyId, query)

export const insertShift = (runner: QueryRunner, companyId: string, shift: NewShift): Promise<ShiftInsertOutcome> =>
  insertShiftImpl(runner, companyId, shift)

/** 見 `impl/shifts-main.replace-children.repository.ts`：`create` 與 `update` 共用本函式。 */
export const replaceShiftChildren = (
  runner: QueryRunner,
  shiftId: string,
  workPeriods: readonly ShiftWorkPeriod[],
  breaks: readonly ShiftBreak[],
): Promise<void> => replaceShiftChildrenImpl(runner, shiftId, workPeriods, breaks)

export const updateShiftProfile = (
  runner: QueryRunner,
  companyId: string,
  shiftId: string,
  update: ShiftProfileUpdate,
): Promise<ShiftProfileUpdateOutcome> => updateShiftProfileImpl(runner, companyId, shiftId, update)

export const markShiftDeleted = (
  runner: QueryRunner,
  companyId: string,
  shiftId: string,
  deletion: ShiftDeletion,
): Promise<number> => markShiftDeletedImpl(runner, companyId, shiftId, deletion)
