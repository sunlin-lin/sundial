/**
 * 動作可用性（前端規範 §1.3 的第 (3) 類、§0.5 的 `.actions.ts`）。
 *
 * 依 UI 定案 10：「操作按鈕依狀態只顯示下一個有效動作：上班打卡 → 下班打卡 → 今日打卡完成」，
 * 且「沒有有效上班卡時，不得先打下班卡」。這兩條由後端業務規則兜底
 * （`attendance.records.errors.no-clock-in-to-pair`／`already-punched`），這裡只是不讓使用者
 * 按下一顆一定會被拒絕的按鈕。
 *
 * 撤銷是否可見另外看 `attendance_settings.allowEmployeeCancellation`（UI 10「與現有 Schema 的
 * 關係」一節）：這個開關目前**只在前端擋**，後端 `revoke` 服務尚未檢查它（見本模組回報）。
 */
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'
import type { TodayAttendanceStatus } from './dashboard-main.view.ts'

type Can = (code: PermissionCode) => boolean

export const canClockIn = (input: {
  readonly status: TodayAttendanceStatus
  readonly isSubmitting: boolean
  readonly can: Can
}): boolean => input.can('attendance.records.create') && input.status === 'not-started' && !input.isSubmitting

export const canClockOut = (input: {
  readonly status: TodayAttendanceStatus
  readonly isSubmitting: boolean
  readonly can: Can
}): boolean => input.can('attendance.records.create') && input.status === 'clocked-in' && !input.isSubmitting

/**
 * 撤銷下班卡：狀態必須是「已下班」。字典規則「已存在下班卡時不能先撤銷上班卡，需先撤銷下班卡」
 * 反過來說就是「下班卡永遠可以先撤銷」，不需要再看上班卡的狀態。
 */
export const canRevokeClockOut = (input: {
  readonly status: TodayAttendanceStatus
  readonly allowEmployeeCancellation: boolean
  readonly isSubmitting: boolean
  readonly can: Can
}): boolean =>
  input.can('attendance.records.revoke') &&
  input.allowEmployeeCancellation &&
  input.status === 'clocked-out' &&
  !input.isSubmitting

/**
 * 撤銷上班卡：只有「上班中」（還沒有下班卡）才能直接撤銷；「已下班」狀態必須先撤銷下班卡
 * （字典規則），因此這裡刻意不含 `'clocked-out'`。呼叫端在那個狀態下應該把撤銷上班卡的按鈕
 * 停用＋顯示原因，而不是整個隱藏（前端規範 §3.3：有權限但狀態不允許 → 停用 + 說明）。
 */
export const canRevokeClockIn = (input: {
  readonly status: TodayAttendanceStatus
  readonly allowEmployeeCancellation: boolean
  readonly isSubmitting: boolean
  readonly can: Can
}): boolean =>
  input.can('attendance.records.revoke') &&
  input.allowEmployeeCancellation &&
  input.status === 'clocked-in' &&
  !input.isSubmitting

/** 撤銷上班卡的按鈕，具備權限與設定，但目前狀態是「已下班」時要顯示成停用＋原因，而不是隱藏。 */
export const shouldDisableClockInRevokeForClockOut = (status: TodayAttendanceStatus): boolean =>
  status === 'clocked-out'

/** 撤銷原因表單的送出鈕（後端 `Reason` 欄位：`minLength:1`／`maxLength:500`）。 */
export const canSubmitRevokeForm = (input: { readonly isSubmitting: boolean; readonly reason: string }): boolean =>
  !input.isSubmitting && input.reason.trim() !== '' && input.reason.length <= 500
