/**
 * 打卡來源代碼（`sourceTypeCode`）在畫面上的文字（§1.3 的第 (2) 類，共用版）。
 *
 * ## 為什麼在 `shared/`
 *
 * §1.5：兩個以上頁面實際共用時才移入共用區。全體出勤（`pages/attendance/all/`）與我的出勤
 * （`pages/attendance/mine/`）是本輪一起新增的兩頁，「來源」欄都要顯示同一組文字——從第一天就
 * 有兩個使用者（理由同 `result-status.ts`、`shared/employees/gender.ts` 檔頭，不重述）。
 *
 * `pages/attendance/daily-records/attendance-daily-records.view.ts` 也有一份幾乎相同的
 * `sourceTypeLabel`（Stage 6 既有頁面），但本輪選擇**不回頭重構那一頁**：它已經上線、通過 CI，
 * 而它的 `sourceTypeLabel` 只有它自己在用，回頭改寫需要同時碰那一頁的呼叫點與既有測試，超出本輪
 * 「全體出勤／我的出勤」兩頁的範圍。這裡是全新的一份，語系 key 也刻意另外命名
 * （`attendance.source.*`，不是 `attendance-daily-records.source.*`），避免誤觸那一頁的既有字串。
 * 若之後要把三個使用者收斂成一份，留在任務回報中列成後續可做的事。
 *
 * ## `sourceTypeCode` 在這裡可能是 `null`（與 `daily-records` 不同）
 *
 * `attendance/records`（打卡事件本身）的 `sourceTypeCode` 永遠有值——每一筆打卡事件一定有來源。
 * 但 `attendance/results`（出勤判定結果）的 `sourceTypeCode` 是
 * `clockIn?.sourceTypeCode ?? clockOut?.sourceTypeCode ?? null`（後端
 * `domain/attendance-result-list-view.ts` 的 `buildAttendanceResultListCore`）：一天的判定結果
 * 若上下班都沒有對應到有效打卡（理論上少見，但形狀上允許），這一欄就是 `null`。因此這裡只匯出
 * 非 `null` 值的標籤函式，`null` → `EMPTY_DISPLAY` 的判斷交給呼叫端的 `.view.ts`（§1.3：
 * 「零值或空值的呈現方式」本來就是頁面依資料語意做的判斷，不是這一層的責任，理由同
 * `shared/format/empty-display.ts` 檔頭「頁面不得拿它去表達『不適用』」的同一種分工）。
 */
import type { AttendanceResultsListOwnData } from '../../api/generated/api-client.ts'
import type { MessageKey } from '../i18n/messages.ts'

/** 打卡來源代碼（非 `null` 的部分）。由產生型別推導，不在前端另列一份（§3.2）。 */
export type AttendanceSourceTypeCodeValue = NonNullable<AttendanceResultsListOwnData['data'][number]['sourceTypeCode']>

const SOURCE_TYPE_LABEL_KEYS = {
  1: 'attendance.source.field',
  2: 'attendance.source.manual-correction',
} as const satisfies Record<AttendanceSourceTypeCodeValue, MessageKey>

export const sourceTypeLabel = (code: AttendanceSourceTypeCodeValue, translate: (key: MessageKey) => string): string =>
  translate(SOURCE_TYPE_LABEL_KEYS[code])
