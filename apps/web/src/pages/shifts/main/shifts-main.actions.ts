/**
 * 動作可用性（前端規範 §1.3 的第 (3) 類、§0.5 的 `.actions.ts`）。
 *
 * **這一輪沒有「資料狀態」這個維度**：計畫 04 §7 明文本輪不實作「班別被引用後不得修改」的防護
 * （沒有任何表引用 `shift_definitions`），因此編輯／複製／刪除／啟用停用**只由權限碼決定**，
 * 不必再看列本身的狀態——這與 `regulatory-sync` 的唯讀頁一樣，是「這一輪真的只有一種判斷」，
 * 不是偷懶少判斷（§4.1 的權限原語一節同樣的理由：沒有消費者的原語不寫）。
 *
 * 排班模組上線那天，這裡會多一個「已被引用」的狀態維度——那時候這些函式要多收一個參數，
 * 而不是回頭補一個永遠是 `true` 的檢查（通用規範 §7.1）。
 */
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'

type Can = (code: PermissionCode) => boolean

export const canCreateShift = (can: Can): boolean => can('shifts.main.create')
export const canEditShift = (can: Can): boolean => can('shifts.main.update')
export const canCopyShift = (can: Can): boolean => can('shifts.main.copy')
export const canDeleteShift = (can: Can): boolean => can('shifts.main.delete')

/** 啟用／停用走 `update`（計畫 §6：不另開端點），因此權限碼與編輯共用同一個。 */
export const canToggleShiftActive = (can: Can): boolean => can('shifts.main.update')

/**
 * 建立／修改表單的送出鈕是否可按。
 *
 * 只做「必填」（§6.1：格式與長度一律交給後端的 `300` 回應處理，見 `.payload.ts` 檔頭），
 * 且**至少要有一段工作時段**——這一條雖然後端也會擋（`shiftWorkPeriodsEmpty`），但在前端就先擋下
 * 「一段都還沒加就按送出」，使用者不必先送出一次才知道要點「新增時段」。
 */
export const canSubmitShiftForm = (input: {
  readonly isSubmitting: boolean
  readonly isLoadingDetail: boolean
  readonly code: string
  readonly name: string
  readonly description: string
  readonly workPeriodCount: number
}): boolean =>
  !input.isSubmitting &&
  !input.isLoadingDetail &&
  input.code.trim() !== '' &&
  input.name.trim() !== '' &&
  input.description.trim() !== '' &&
  input.workPeriodCount > 0

/** 複製表單的送出鈕是否可按：三個必填欄位都填了、沒有請求在途中。 */
export const canSubmitCopyForm = (input: {
  readonly isSubmitting: boolean
  readonly code: string
  readonly name: string
  readonly description: string
}): boolean =>
  !input.isSubmitting && input.code.trim() !== '' && input.name.trim() !== '' && input.description.trim() !== ''
