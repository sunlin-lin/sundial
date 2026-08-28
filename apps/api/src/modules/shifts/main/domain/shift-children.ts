/**
 * 工作時段與休息時段：DB row → 業務型別的轉換，以及依 `shiftDefinitionId` 分組（零 IO 純函式）。
 *
 * 兩張子表都不進 `CompanyScopedTable`（`db/schema/shift-work-periods.ts`／`shift-breaks.ts` 檔頭），
 * 查詢時一律用主鍵 `shiftDefinitionId` 過濾，不需要（也無法）用 `TenantDatabase`。
 * 本檔負責把撈回來的原始列組裝成 `ShiftWorkPeriod[]`／`ShiftBreak[]`，並且在**列表頁**
 * 一次查詢、依 `shiftDefinitionId` 分組給對應的班別，避免一頁 20 筆各查一次子表（§4.5 的 N+1）。
 */
import { fromDbTime } from './shift-time.ts'
import type { ShiftBreak, ShiftWorkPeriod } from './shift-model.ts'

export type ShiftWorkPeriodRow = {
  readonly shiftDefinitionId: string
  readonly sequenceNo: number
  readonly startTime: string
  readonly endTime: string
  readonly endDayOffset: number
  readonly workMinutes: number
}

export type ShiftBreakRow = {
  readonly shiftDefinitionId: string
  readonly sequenceNo: number
  readonly startTime: string
  readonly endTime: string
  readonly startDayOffset: number
  readonly endDayOffset: number
  readonly breakMinutes: number
  readonly isPaid: boolean
}

export const toShiftWorkPeriod = (row: ShiftWorkPeriodRow): ShiftWorkPeriod => ({
  sequenceNo: row.sequenceNo,
  startTime: fromDbTime(row.startTime),
  endTime: fromDbTime(row.endTime),
  endDayOffset: row.endDayOffset,
  workMinutes: row.workMinutes,
})

export const toShiftBreak = (row: ShiftBreakRow): ShiftBreak => ({
  sequenceNo: row.sequenceNo,
  startTime: fromDbTime(row.startTime),
  endTime: fromDbTime(row.endTime),
  startDayOffset: row.startDayOffset,
  endDayOffset: row.endDayOffset,
  breakMinutes: row.breakMinutes,
  isPaid: row.isPaid,
})

/**
 * 依 `shiftDefinitionId` 把已排序好的列分組。
 *
 * @param rows 必須已經依 `shiftDefinitionId, sequenceNo` 排序——本函式只負責分組，不重新排序，
 *   否則列表頁與明細頁的排序邏輯會出現兩份。
 */
export const groupByShiftDefinitionId = <T extends { readonly shiftDefinitionId: string }>(
  rows: readonly T[],
): ReadonlyMap<string, readonly T[]> => {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const existing = grouped.get(row.shiftDefinitionId)
    if (existing === undefined) {
      grouped.set(row.shiftDefinitionId, [row])
    } else {
      existing.push(row)
    }
  }
  return grouped
}
