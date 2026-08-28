/**
 * 資料存取：單一班別的完整內容（主檔 ＋ 工作時段 ＋ 休息時段）。
 */
import { asc, eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { shiftBreaks, shiftDefinitions, shiftWorkPeriods } from '../../../../db/schema/index.ts'
import { toShiftBreak, toShiftWorkPeriod } from '../domain/shift-children.ts'
import type { ShiftDetail } from '../domain/shift-model.ts'

/**
 * 依 id 取班別（含工作時段與休息時段）。
 *
 * @returns 查無資料回 `null`。**別家公司的班別也回 `null`**，而且走的是同一行程式碼
 *   ——公司條件由 `TenantDatabase` 寫進主檔查詢的 `WHERE`（§4.2），因此「不存在」與
 *   「屬於其他公司」想寫出不一致的回應都寫不出來（§3.2）。
 *
 * 子表查詢**不經過 `TenantDatabase`**（`shift_work_periods`／`shift_breaks` 沒有 `company_id`
 * 欄位，見兩張表的 schema 檔頭）：公司範圍已經由上面那一次主檔查詢確認過，子表只需要用
 * `shiftDefinitionId` 過濾，這一步不會、也不能再帶公司條件。
 */
export const findShiftDetail = async (
  runner: QueryRunner,
  companyId: string,
  shiftId: string,
): Promise<ShiftDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const [shift] = await tenant.select(
    {
      id: shiftDefinitions.id,
      code: shiftDefinitions.code,
      name: shiftDefinitions.name,
      workTypeCode: shiftDefinitions.workTypeCode,
      isOvernight: shiftDefinitions.isOvernight,
      isFlexible: shiftDefinitions.isFlexible,
      requiredWorkMinutes: shiftDefinitions.requiredWorkMinutes,
      description: shiftDefinitions.description,
      isActive: shiftDefinitions.isActive,
      createdAt: shiftDefinitions.createdAt,
      updatedAt: shiftDefinitions.updatedAt,
    },
    shiftDefinitions,
    eq(shiftDefinitions.id, shiftId),
    // §4.3：軟刪除的班別等同不存在，否則刪掉的班別還能被讀出來繼續編輯。
    eq(shiftDefinitions.deletedSeq, 0),
    isNull(shiftDefinitions.deletedAt),
  )
  if (shift === undefined) return null

  const workPeriodRows = await runner
    .select({
      shiftDefinitionId: shiftWorkPeriods.shiftDefinitionId,
      sequenceNo: shiftWorkPeriods.sequenceNo,
      startTime: shiftWorkPeriods.startTime,
      endTime: shiftWorkPeriods.endTime,
      endDayOffset: shiftWorkPeriods.endDayOffset,
      workMinutes: shiftWorkPeriods.workMinutes,
    })
    .from(shiftWorkPeriods)
    .where(eq(shiftWorkPeriods.shiftDefinitionId, shiftId))
    .orderBy(asc(shiftWorkPeriods.sequenceNo))

  const breakRows = await runner
    .select({
      shiftDefinitionId: shiftBreaks.shiftDefinitionId,
      sequenceNo: shiftBreaks.sequenceNo,
      startTime: shiftBreaks.startTime,
      endTime: shiftBreaks.endTime,
      startDayOffset: shiftBreaks.startDayOffset,
      endDayOffset: shiftBreaks.endDayOffset,
      breakMinutes: shiftBreaks.breakMinutes,
      isPaid: shiftBreaks.isPaid,
    })
    .from(shiftBreaks)
    .where(eq(shiftBreaks.shiftDefinitionId, shiftId))
    .orderBy(asc(shiftBreaks.sequenceNo))

  return {
    id: shift.id,
    code: shift.code,
    name: shift.name,
    workTypeCode: shift.workTypeCode,
    isOvernight: shift.isOvernight,
    isFlexible: shift.isFlexible,
    requiredWorkMinutes: shift.requiredWorkMinutes,
    isActive: shift.isActive,
    // 查詢已經用 `shiftDefinitionId` 過濾過，這裡拿到的整批就是這個班別的子列，不需要再分組
    // （分組工具 `groupByShiftDefinitionId` 是為一次查多個班別的列表頁而寫，見該檔說明）。
    workPeriods: workPeriodRows.map(toShiftWorkPeriod),
    breaks: breakRows.map(toShiftBreak),
    description: shift.description,
    createdAt: shift.createdAt,
    updatedAt: shift.updatedAt,
  }
}
