/**
 * 班別主檔的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：業務拒絕一律以
 * `ServiceResult` 的失敗結果 ＋ 具名分組表達。
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { ShiftsMainContext } from './domain/shift-context.ts'
import type {
  CopyShiftInput,
  CreateShiftInput,
  DeletedShift,
  ShiftDetail,
  ShiftListPage,
  ShiftListQuery,
  ShiftTargetInput,
  UpdateShiftInput,
} from './domain/shift-model.ts'
import { copyShift as copyShiftImpl } from './impl/shifts-main.copy.service.ts'
import { createShift as createShiftImpl } from './impl/shifts-main.create.service.ts'
import { deleteShift as deleteShiftImpl } from './impl/shifts-main.delete.service.ts'
import { getShift as getShiftImpl } from './impl/shifts-main.get.service.ts'
import { listShifts as listShiftsImpl } from './impl/shifts-main.list.service.ts'
import { updateShift as updateShiftImpl } from './impl/shifts-main.update.service.ts'

export type { ShiftsMainContext }
export type {
  CopyShiftInput,
  CreateShiftInput,
  DeletedShift,
  ShiftBreak,
  ShiftBreakInput,
  ShiftDetail,
  ShiftListPage,
  ShiftListQuery,
  ShiftSortOption,
  ShiftSummary,
  ShiftTargetInput,
  ShiftWorkPeriod,
  ShiftWorkPeriodInput,
  ShiftWorkTypeValue,
  UpdateShiftInput,
} from './domain/shift-model.ts'

export const listShifts = (context: ShiftsMainContext, query: ShiftListQuery): Promise<ServiceResult<ShiftListPage>> =>
  listShiftsImpl(context, query)

export const getShift = (
  context: ShiftsMainContext,
  input: ShiftTargetInput,
): Promise<ServiceResult<ShiftDetail | null>> => getShiftImpl(context, input)

export const createShift = (context: ShiftsMainContext, input: CreateShiftInput): Promise<ServiceResult<ShiftDetail>> =>
  createShiftImpl(context, input)

export const updateShift = (context: ShiftsMainContext, input: UpdateShiftInput): Promise<ServiceResult<ShiftDetail>> =>
  updateShiftImpl(context, input)

export const copyShift = (context: ShiftsMainContext, input: CopyShiftInput): Promise<ServiceResult<ShiftDetail>> =>
  copyShiftImpl(context, input)

export const deleteShift = (
  context: ShiftsMainContext,
  input: ShiftTargetInput,
): Promise<ServiceResult<DeletedShift>> => deleteShiftImpl(context, input)
