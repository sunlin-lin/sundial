/**
 * 業務動作：新增班別。
 *
 * 主檔與子表**必須在同一交易內完成**（§4.4）：只成功一半會留下「班別建好了、但一段工作時段都
 * 沒有」這種永遠用不了、也沒人會發現的孤兒。
 *
 * **時段與休息的結構驗證排在交易之前**：那是零 IO 的純函式檢查（`domain/shift-validation.ts`），
 * 放進交易只會讓連線多佔用一段時間卻換不到任何好處（§3.4：交易內禁止不必要的長計算）。
 *
 * TODO(稽核 Stage 2 定案後補；`docs/plans/02-audit-logs.md`)：本動作本輪**沒有寫稽核**。
 * 班別的 `required_work_minutes` 會被排班／出勤模組引用（計畫 §4.1），新增一個班別即建立了
 * 一份日後會影響工時計算的設定，屬於後端規範 §5.3「會改變審核結果的操作」的候選——稽核表尚未
 * 定案（後端規範 §9 第 2 項），刻意不自建，理由與 `employees-main.update.service.ts` 的同類
 * 標記相同：猜錯欄位的代價不是改個 schema，是一批無法重寫也無法補齊的紀錄。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { ShiftsMainContext } from '../domain/shift-context.ts'
import type { CreateShiftInput, ShiftDetail } from '../domain/shift-model.ts'
import { computeShiftDerivedValues, validateShiftStructure } from '../domain/shift-validation.ts'
import { shiftCodeDuplicated } from '../shifts-main.errors.ts'
import { findShiftDetail, insertShift, replaceShiftChildren } from '../shifts-main.repository.ts'

export const createShift = async (
  context: ShiftsMainContext,
  input: CreateShiftInput,
): Promise<ServiceResult<ShiftDetail>> => {
  const structureErrors = validateShiftStructure(input.workPeriods, input.breaks)
  if (structureErrors.length > 0) return fail(structureErrors)

  // 只在驗證通過之後才計算：{@link computeShiftDerivedValues} 假設輸入已經合法（該函式檔頭）。
  const derived = computeShiftDerivedValues(input.workPeriods, input.breaks)

  const now = context.clock.now()
  const shiftId = crypto.randomUUID()

  return context.db.transaction(async (tx): Promise<ServiceResult<ShiftDetail>> => {
    // 代碼唯一性交給資料庫的唯一鍵，不做「先 SELECT 再 INSERT」（§4.3）：兩個併發請求會同時
    // 查到「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現。
    const outcome = await insertShift(tx, context.companyId, {
      id: shiftId,
      code: input.code,
      name: input.name,
      workTypeCode: input.workTypeCode,
      isOvernight: derived.isOvernight,
      isFlexible: input.isFlexible,
      requiredWorkMinutes: derived.requiredWorkMinutes,
      description: input.description,
      isActive: input.isActive,
      now,
    })

    // 重複時**立刻結束、不再對這個交易下任何一句寫入**（§3.4）：InnoDB 對唯一鍵違反只回滾
    // 那一句，交易本身仍然可用，但繼續寫下去就會出現「主檔沒建起來、子表卻寫進去了」的孤兒列。
    if (outcome === 'duplicate-code') return fail([shiftCodeDuplicated()])

    await replaceShiftChildren(tx, shiftId, derived.workPeriods, derived.breaks)

    const detail = await findShiftDetail(tx, context.companyId, shiftId)
    if (detail === null) {
      // 系統錯誤（§3.1.2）：剛剛在同一個交易內寫進去的班別讀不回來，代表資料庫或本模組的
      // 公司範圍有問題，不是使用者做錯了什麼。
      throw new Error(`班別 ${shiftId} 建立後於同一交易內讀不回來`)
    }
    return succeed(detail)
  })
}
