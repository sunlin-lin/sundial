/**
 * 資料存取：把某個班別的工作時段與休息時段整組換成新的一組。
 *
 * **作法是「先刪光這個班別既有的子表列，再寫入新的」**（比照 `roles-main.replace-permissions.repository.ts`
 * 的既有作法，理由同構）：不做差集比對——差集要多維護一段「哪些要刪、哪些要留、哪些要加」的邏輯，
 * 而它算錯時的症狀是某一段時段悄悄消失或錯位，不會報錯，只會在算出離譜的應工作分鐘時才被發現。
 * 兩張子表都是**不被任何東西外部引用**的從屬明細（沒有其他表以它們的 `id` 為外鍵），因此實體
 * 刪除不違反 §4.3「禁止對有歷史意義的資料做實體 DELETE」——它們本身不是「有歷史意義的資料」，
 * 班別當時的樣貌是主檔上已經算好、存下來的 `is_overnight`／`required_work_minutes`（計畫 §4.1）。
 *
 * **呼叫端必須與主檔的寫入放在同一個交易內**（§4.4）：只成功一半會留下「班別建好了、但一段
 * 工作時段都沒有」這種永遠用不了、也沒人會發現的半成品。
 *
 * **本函式同時服務 `create` 與 `update`**：`create` 呼叫時刪除語句影響 0 列（該班別的子表本來就
 * 是空的），行為與「只插入」完全相同，不需要為兩種情境各寫一份。
 *
 * **不經過 `TenantDatabase`**：兩張子表沒有 `company_id` 欄位（見兩張表的 schema 檔頭），
 * 公司範圍已經由呼叫端在同一個交易內對主檔做過的查詢／條件式 UPDATE 確認過。
 */
import { eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { shiftBreaks, shiftWorkPeriods } from '../../../../db/schema/index.ts'
import { toDbTime } from '../domain/shift-time.ts'
import type { ShiftBreak, ShiftWorkPeriod } from '../domain/shift-model.ts'

export const replaceShiftChildren = async (
  runner: QueryRunner,
  shiftId: string,
  workPeriods: readonly ShiftWorkPeriod[],
  breaks: readonly ShiftBreak[],
): Promise<void> => {
  await runner.delete(shiftWorkPeriods).where(eq(shiftWorkPeriods.shiftDefinitionId, shiftId))
  await runner.delete(shiftBreaks).where(eq(shiftBreaks.shiftDefinitionId, shiftId))

  // 空陣列時 `.values([])` 不是合法的 SQL（`INSERT ... VALUES ()`），因此逐一檢查再寫入——
  // `breaks` 允許整組是空的（一段休息都沒有的班別是合法的），`workPeriods` 依業務規則不會是空的
  // （service 在呼叫本函式之前已經擋過，見 `domain/shift-validation.ts` 的 `shiftWorkPeriodsEmpty`），
  // 但這裡仍然檢查一次，讓本函式本身不必依賴呼叫端一定會先驗證這件事。
  if (workPeriods.length > 0) {
    await runner.insert(shiftWorkPeriods).values(
      workPeriods.map((period) => ({
        id: crypto.randomUUID(),
        shiftDefinitionId: shiftId,
        sequenceNo: period.sequenceNo,
        startTime: toDbTime(period.startTime),
        endTime: toDbTime(period.endTime),
        endDayOffset: period.endDayOffset,
        workMinutes: period.workMinutes,
      })),
    )
  }

  if (breaks.length > 0) {
    await runner.insert(shiftBreaks).values(
      breaks.map((entry) => ({
        id: crypto.randomUUID(),
        shiftDefinitionId: shiftId,
        sequenceNo: entry.sequenceNo,
        startTime: toDbTime(entry.startTime),
        endTime: toDbTime(entry.endTime),
        startDayOffset: entry.startDayOffset,
        endDayOffset: entry.endDayOffset,
        breakMinutes: entry.breakMinutes,
        isPaid: entry.isPaid,
      })),
    )
  }
}
