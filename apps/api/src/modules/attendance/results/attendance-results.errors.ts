/**
 * 出勤判定結果的錯誤字典（§0.4「errors 不拆」、§1.8.3）。
 *
 * **本次目錄目前一個業務錯誤碼都沒有。** `recalculate-no-schedule` 是一支無條件執行的批次維護
 * 動作——它不檢查「有沒有東西可以重算」以外的任何前置條件（沒有東西可重算時回
 * `recalculatedCount: 0`，這是一個正常且有效的答案，不是錯誤，見 `impl/attendance-results.
 * recalculate-no-schedule.service.ts`），因此沒有業務錯誤可以吐。這份清單仍然要存在、且明確
 * 寫成空的（§1.8.3）：省略時「這支端點沒有業務錯誤」與「有人忘了宣告」在契約上長得一模一樣。
 *
 * `list`（全體出勤）／`list-own`（我的出勤，Stage 7）同樣沒有業務錯誤：部門／人員篩選條件指到
 * 查無資料、跨公司或已刪除的目標時，依 `sundial-backend` skill api-design.md §4 一律回空清單，
 * 不新增錯誤碼；`list-own` 呼叫者沒有連結員工時同樣回空清單（見該 service 檔頭）。
 */
import type { ErrorCode } from '../../../shared/service-result.ts'

/** `POST /attendance/results/recalculate-no-schedule` 可能吐出的業務錯誤碼。刻意為空。 */
export const ATTENDANCE_RESULTS_RECALCULATE_NO_SCHEDULE_ERROR_CODES: readonly ErrorCode[] = []

/** `POST /attendance/results/list` 可能吐出的業務錯誤碼。刻意為空，見檔頭。 */
export const ATTENDANCE_RESULTS_LIST_ERROR_CODES: readonly ErrorCode[] = []

/** `POST /attendance/results/list-own` 可能吐出的業務錯誤碼。刻意為空，見檔頭。 */
export const ATTENDANCE_RESULTS_LIST_OWN_ERROR_CODES: readonly ErrorCode[] = []
