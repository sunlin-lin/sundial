/**
 * 業務動作：修改班別（含時段與休息，全量替換）。
 *
 * **時段與休息採「全量替換」而不是逐筆 diff**：diff 要處理三種情況（哪些要刪、哪些要留、
 * 哪些要加），而全量替換只有一種——「先刪光、再整批寫入」。這張表的子列**不被任何東西外部
 * 引用**（沒有其他表以 `shift_work_periods.id`／`shift_breaks.id` 為外鍵），因此替換掉舊的 id
 * 不會留下懸空參照，diff 想解的那個問題在這裡本來就不存在。
 *
 * **本輪可以自由修改任何班別，包含已經「在用」的班別**（計畫 §7，已定案）：沒有任何表引用
 * `shift_definitions`，「這個班別被排班引用了嗎」這個查詢的答案恆為否，因此本檔刻意不做那個
 * 檢查——寫一個永遠回 false 的檢查比不寫更糟（`shifts-main.errors.ts` 檔頭已詳述）。
 *
 * TODO(稽核 Stage 2 定案後補；`docs/plans/02-audit-logs.md`)：本動作本輪**沒有寫稽核**，
 * 理由與 `impl/shifts-main.create.service.ts` 的同一則標記相同。修改班別尤其值得留意——
 * 排班模組落地後，這裡改的正是計畫 §7 明文「不得直接覆蓋歷史」的那些欄位，異動前後的
 * `requiredWorkMinutes`／時段／休息內容屆時都應該進稽核的「異動前後差異」。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { ShiftsMainContext } from '../domain/shift-context.ts'
import type { ShiftDetail, UpdateShiftInput } from '../domain/shift-model.ts'
import { computeShiftDerivedValues, validateShiftStructure } from '../domain/shift-validation.ts'
import { shiftCodeDuplicated, shiftNotFound } from '../shifts-main.errors.ts'
import { findShiftDetail, replaceShiftChildren, updateShiftProfile } from '../shifts-main.repository.ts'

export const updateShift = async (
  context: ShiftsMainContext,
  input: UpdateShiftInput,
): Promise<ServiceResult<ShiftDetail>> => {
  // 零 IO 的結構驗證排在交易之前（理由同 create 切片），但**回傳的錯誤要等確認目標存在之後
  // 才決定要不要用**：目標不存在時只回 not-found，不夾帶一堆使用者根本改不到的時段錯誤
  // （見下方 `current === null` 分支）。
  const structureErrors = validateShiftStructure(input.workPeriods, input.breaks)
  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<ServiceResult<ShiftDetail>> => {
    const current = await findShiftDetail(tx, context.companyId, input.id)
    // 動作類端點的「目標不存在」是業務錯誤（§3.1.3）：使用者確實嘗試了一個做不到的操作。
    // **別家公司的班別也走這一行**，回一模一樣的錯誤（§3.2）。
    if (current === null) return fail([shiftNotFound()])

    if (structureErrors.length > 0) return fail(structureErrors)

    const derived = computeShiftDerivedValues(input.workPeriods, input.breaks)

    const outcome = await updateShiftProfile(tx, context.companyId, input.id, {
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
    if (outcome === 'duplicate-code') return fail([shiftCodeDuplicated()])

    await replaceShiftChildren(tx, input.id, derived.workPeriods, derived.breaks)

    const updated = await findShiftDetail(tx, context.companyId, input.id)
    if (updated === null) {
      // 系統錯誤（§3.1.2）：同一交易內剛讀到、剛寫過的班別又讀不回來了。
      throw new Error(`班別 ${input.id} 更新後於同一交易內讀不回來`)
    }
    return succeed(updated)
  })
}
