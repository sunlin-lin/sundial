/**
 * 出勤判定結果的狀態旗標（`statuses`）在畫面上長什麼樣（§1.3 的第 (2) 類，共用版）。
 *
 * ## 為什麼在 `shared/`
 *
 * §1.5：兩個以上頁面實際共用時才移入共用區。全體出勤（`pages/attendance/all/`）與我的出勤
 * （`pages/attendance/mine/`）是本輪一起新增的兩頁，兩頁的「狀態」欄都要把同一組
 * `statuses` 旗標顯示成同一種文字與色彩——從第一天就有兩個使用者，且兩頁顯示的必須是同一種
 * 東西（理由與 `shared/regulatory/sync-status.ts` 檔頭同構：同一個代碼在兩頁長得不一樣，
 * 使用者看到的是兩種狀態，而沒有人說得出哪一個才對）。
 *
 * ## 狀態是陣列，不是單一互斥值（UI 09／12 明文）
 *
 * UI 09：「同一天可能同時有遲到與早退，或同時有請假與出勤，因此狀態不得在 UI 假設為單一互斥
 * 值。」後端 `domain/attendance-result-list-view.ts` 的 `statuses` 因此是陣列——現階段（Stage 4
 * 無班表判定）永遠只會是 `['NO_SCHEDULE']` 一種組合，但形狀從一開始就支援同時出現多個。
 * 這裡的 {@link attendanceResultStatusPresentations} 對每一個旗標各自求出一份呈現，
 * 呼叫端逐一渲染成獨立的標籤（例如多個 `ElTag`），不寫成 `switch`／只取第一個。
 *
 * ## 為什麼放在 `shared/attendance/` 而不是塞進 `shared/format/`
 *
 * 與 `shared/regulatory/sync-status.ts`、`shared/employees/gender.ts` 是同一類判斷（「代碼 →
 * 一組呈現決策」，不是「值 → 字串」的通用格式化），因此比照它們另立一個以業務領域命名的子目錄。
 */
import type { AttendanceResultsListOwnData } from '../../api/generated/api-client.ts'
import type { MessageKey } from '../i18n/messages.ts'

/** 狀態旗標。由產生型別推導，不在前端另列一份（§3.2）。`list`／`list-own` 的 `statuses` 欄位
 * 是同一組字面量聯集，這裡以 `list-own`（欄位較少的那一支）為來源，兩支端點共用同一個型別。 */
export type AttendanceResultStatusFlag = AttendanceResultsListOwnData['data'][number]['statuses'][number]

/**
 * 一個旗標的呈現。
 *
 * §9.1：**不得只用顏色表達狀態**，因此永遠有 `labelKey`；色彩走 `tone`（ElTag 的語意色名，
 * 理由同 `sync-status.ts`）。
 */
export type AttendanceResultStatusPresentation = {
  readonly labelKey: MessageKey
  readonly tone: 'success' | 'danger' | 'warning' | 'info'
}

/**
 * 五種旗標各自的呈現，key 即旗標本身。
 *
 * `satisfies Record<...>` 讓後端新增第六種旗標時這裡直接編譯錯誤，而不是渲染出一個空白標籤
 * （同 `sync-status.ts` 的既有手法）。
 */
const ATTENDANCE_RESULT_STATUS_PRESENTATIONS = {
  NO_SCHEDULE: { labelKey: 'attendance.result-status.no-schedule', tone: 'info' },
  LATE: { labelKey: 'attendance.result-status.late', tone: 'warning' },
  EARLY_LEAVE: { labelKey: 'attendance.result-status.early-leave', tone: 'warning' },
  ABSENT: { labelKey: 'attendance.result-status.absent', tone: 'danger' },
  ON_LEAVE: { labelKey: 'attendance.result-status.on-leave', tone: 'info' },
} as const satisfies Record<AttendanceResultStatusFlag, AttendanceResultStatusPresentation>

/** 一整列的旗標陣列 → 對應的呈現陣列，順序與輸入相同，呼叫端逐一渲染，不得只取第一個。 */
export const attendanceResultStatusPresentations = (
  statuses: readonly AttendanceResultStatusFlag[],
): readonly AttendanceResultStatusPresentation[] =>
  statuses.map((status) => ATTENDANCE_RESULT_STATUS_PRESENTATIONS[status])
