/**
 * 業務動作：複製班別（計畫 §7、§10）。
 *
 * **這是「停用舊的、複製建立新的」那個流程的工具**：建立一個新班別，內容（工時管理方式、
 * 彈性旗標、工作時段、休息時段）整組複製自來源班別，呼叫端只需要提供新班別的識別與說明。
 *
 * **不自動停用來源**——那是兩個決定，合成一個動作會讓「我只是想複製一份來改」變成意外停用了
 * 正在用的班別（計畫 §7 明文）。要停用來源，呼叫端另外打一次 `update` 把 `isActive` 設成 `false`。
 *
 * **不重新驗證來源的時段與休息結構**：來源班別在建立當下已經通過 `validateShiftStructure`，
 * 這裡原封不動複製同一組資料，不存在「複製出一個新的不合法組合」的情境，因此不必也不該
 * 重跑一次同樣的檢查（重跑對呼叫端沒有任何新資訊，只是白白多花一段計算）。
 *
 * TODO(稽核 Stage 2 定案後補；`docs/plans/02-audit-logs.md`)：理由同 `create` 切片。
 * 複製這個動作本身也值得記一筆「這一筆是從哪個班別複製來的」——半年後那批只差幾分鐘的班別
 * 要追溯關係，稽核紀錄會是唯一的依據（`shift_definitions` 本身不存父子關聯欄位）。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { ShiftsMainContext } from '../domain/shift-context.ts'
import type { CopyShiftInput, ShiftDetail } from '../domain/shift-model.ts'
import { shiftCodeDuplicated, shiftNotFound } from '../shifts-main.errors.ts'
import { findShiftDetail, insertShift, replaceShiftChildren } from '../shifts-main.repository.ts'

export const copyShift = async (
  context: ShiftsMainContext,
  input: CopyShiftInput,
): Promise<ServiceResult<ShiftDetail>> => {
  const now = context.clock.now()
  const newShiftId = crypto.randomUUID()

  return context.db.transaction(async (tx): Promise<ServiceResult<ShiftDetail>> => {
    const source = await findShiftDetail(tx, context.companyId, input.sourceId)
    // 來源不存在（含跨公司存取，§3.2）：`field` 指到 `sourceId`，不是 `id`——複製端點的
    // request body 上根本沒有 `id` 這個欄位，指錯欄位會讓前端定位不到該標紅哪一格（§1.3）。
    if (source === null) return fail([shiftNotFound('sourceId')])

    const outcome = await insertShift(tx, context.companyId, {
      id: newShiftId,
      code: input.code,
      name: input.name,
      // 以下四欄「內容」整組取自來源，不接受呼叫端覆寫（計畫 §7，型別上 `CopyShiftInput`
      // 也確實沒有這幾個欄位，見 `domain/shift-model.ts`）。
      workTypeCode: source.workTypeCode,
      isOvernight: source.isOvernight,
      isFlexible: source.isFlexible,
      requiredWorkMinutes: source.requiredWorkMinutes,
      description: input.description,
      isActive: input.isActive,
      now,
    })
    if (outcome === 'duplicate-code') return fail([shiftCodeDuplicated()])

    // 來源的 `workPeriods`／`breaks` 已經帶著算好的 `workMinutes`／`breakMinutes`
    // （`findShiftDetail` 回傳的就是輸出方向的完整型別），原封不動寫進新班別。
    await replaceShiftChildren(tx, newShiftId, source.workPeriods, source.breaks)

    const detail = await findShiftDetail(tx, context.companyId, newShiftId)
    if (detail === null) {
      // 系統錯誤（§3.1.2）：剛剛在同一個交易內寫進去的班別讀不回來。
      throw new Error(`班別 ${newShiftId} 複製建立後於同一交易內讀不回來`)
    }
    return succeed(detail)
  })
}
