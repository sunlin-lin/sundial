/**
 * 動作可用性（前端規範 §1.3 第 (3) 類、§0.5 的 `.actions.ts`）。
 *
 * UI 23「撤銷操作」：只有具備 `attendance.records.revoke-other` 權限的操作者，在「有效」狀態的
 * 紀錄上才看得到「撤銷」按鈕；已撤銷的紀錄不能再撤銷一次。「查看明細」不受權限碼限制——UI 23
 * 沒有為它另外指定權限碼，任何進得了這一頁的人都能查看明細（座標看不看得到是 `get` 回應本身的
 * 可見範圍規則，不是「能不能點查看明細」這個按鈕的問題，見 `.view.ts` 的座標三種狀態）。
 *
 * 薪資結算鎖定檢查：**不在這裡**。UI 23 明講這條檢查目前是樁（永遠回「未鎖定」），而且列表／
 * 明細回應都沒有任何欄位能讓前端知道某個工作日是否已鎖定——沒有資料可判斷，這裡就沒有東西可以
 * 檢查。真的被鎖定時，後端會在呼叫 `revoke-other` 當下拒絕（`period-locked`），走的是
 * `.errors.view.ts` 既有的一般錯誤訊息路徑，不是這裡的前置判斷（薪資模組上線、這條檢查真的
 * 查得到東西時，再回來加這個判斷，不必現在假裝有一個「檢查中」的中間狀態）。
 */
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'

type Can = (code: PermissionCode) => boolean

/**
 * 是否顯示「撤銷」按鈕。**不收 `isSubmitting`**——撤銷的送出流程在獨立的確認對話框
 * （`AttendanceDailyRecordRevokeDialog.vue`）裡進行，對話框開著的時候使用者本來就碰不到表格
 * 上的其他按鈕，不需要在這裡另外做「送出中停用這一列」的判斷（與 Dashboard 的
 * `canRevokeClockIn`／`canRevokeClockOut` 不同：那裡的撤銷是卡片自己的狀態機，這裡是表格
 * 逐列的按鈕，兩者所在的元件結構不同）。
 */
export const canRevokeDailyRecord = (input: { readonly isRevoked: boolean; readonly can: Can }): boolean =>
  !input.isRevoked && input.can('attendance.records.revoke-other')

/** 撤銷原因表單的送出鈕（後端 `Reason` 欄位：`minLength:1`／`maxLength:500`，與
 * `dashboard-main.actions.ts` 的 `canSubmitRevokeForm` 同構——欄位規則相同，差別只在呼叫的端點）。 */
export const canSubmitRevokeOtherForm = (input: { readonly isSubmitting: boolean; readonly reason: string }): boolean =>
  !input.isSubmitting && input.reason.trim() !== '' && input.reason.length <= 500
