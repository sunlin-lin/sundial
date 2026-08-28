/**
 * 業務動作：刪除班別（軟刪除）。
 *
 * **本次沒有做「仍被排班引用就不可刪除」這類前置檢查**：理由與 `update` 相同（計畫 §7、
 * `shifts-main.errors.ts` 檔頭已詳述）——沒有任何表引用 `shift_definitions`，現在寫出來的檢查
 * 只會是在查一張空表，看起來有擋、實際上永遠通過。排班模組落地時應在此補上（已寫進交付回報）。
 *
 * TODO(稽核 Stage 2 定案後補；`docs/plans/02-audit-logs.md`)：理由同 `create` 切片。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { ShiftsMainContext } from '../domain/shift-context.ts'
import type { DeletedShift, ShiftTargetInput } from '../domain/shift-model.ts'
import { shiftNotFound, shiftStateChanged } from '../shifts-main.errors.ts'
import { findShiftDetail, markShiftDeleted } from '../shifts-main.repository.ts'

export const deleteShift = async (
  context: ShiftsMainContext,
  input: ShiftTargetInput,
): Promise<ServiceResult<DeletedShift>> => {
  const now = context.clock.now()
  // 軟刪除時同時寫入非零的 `deletedSeq`（§4.3）：UNIQUE 索引中 NULL 互不相等，只寫 `deletedAt`
  // 的話「未刪除資料的班別代碼唯一」等於沒擋。用刪除當下的 epoch 毫秒，同一個班別只會被刪除
  // 一次，因此不可能與自己碰撞。
  const deletedSeq = context.clock.epochMs()

  return context.db.transaction(async (tx): Promise<ServiceResult<DeletedShift>> => {
    const current = await findShiftDetail(tx, context.companyId, input.id)
    // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§3.1.3）。
    if (current === null) return fail([shiftNotFound()])

    // 條件式 UPDATE ＋ 檢查影響列數（§4.4）：兩個使用者同時按刪除時，第二筆影響 0 列。
    const affectedRows = await markShiftDeleted(tx, context.companyId, input.id, { now, deletedSeq })
    if (affectedRows === 0) return fail([shiftStateChanged()])

    return succeed({ id: input.id })
  })
}
