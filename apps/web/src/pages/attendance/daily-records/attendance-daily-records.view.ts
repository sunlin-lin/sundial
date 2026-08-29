/**
 * 每日全員打卡明細：列表呈現、明細呈現、座標三種狀態判斷（前端規範 §1.3 第 (1)(2) 類）。
 * UI 定案 `docs/ui/23-ui-daily-attendance-records.md`。
 */
import { formatDateTime } from '../../../shared/format/business-date.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type {
  AttendanceRecordsGetData,
  AttendanceRecordsListByDateData,
  DepartmentsMainTreeData,
  EmployeesMainListData,
} from '../../../api/generated/api-client.ts'
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 打卡類型代碼。值必須與後端 `db/schema/attendance-records.ts` 的 `AttendanceTypeCode` 相同。 */
export const ATTENDANCE_TYPE_CLOCK_IN = 1
export const ATTENDANCE_TYPE_CLOCK_OUT = 2
type AttendanceTypeCodeValue = typeof ATTENDANCE_TYPE_CLOCK_IN | typeof ATTENDANCE_TYPE_CLOCK_OUT

const ATTENDANCE_TYPE_LABEL_KEYS = {
  [ATTENDANCE_TYPE_CLOCK_IN]: 'attendance-daily-records.type.clock-in',
  [ATTENDANCE_TYPE_CLOCK_OUT]: 'attendance-daily-records.type.clock-out',
} as const satisfies Record<AttendanceTypeCodeValue, MessageKey>

export const attendanceTypeLabel = (code: AttendanceTypeCodeValue, translate: TranslateMessage): string =>
  translate(ATTENDANCE_TYPE_LABEL_KEYS[code])

/** 打卡來源代碼。值必須與後端 `db/schema/attendance-records.ts` 的 `AttendanceSourceTypeCode` 相同。 */
const SOURCE_TYPE_FIELD = 1
const SOURCE_TYPE_MANUAL_CORRECTION = 2
type AttendanceSourceTypeCodeValue = typeof SOURCE_TYPE_FIELD | typeof SOURCE_TYPE_MANUAL_CORRECTION

const SOURCE_TYPE_LABEL_KEYS = {
  [SOURCE_TYPE_FIELD]: 'attendance-daily-records.source.field',
  [SOURCE_TYPE_MANUAL_CORRECTION]: 'attendance-daily-records.source.manual-correction',
} as const satisfies Record<AttendanceSourceTypeCodeValue, MessageKey>

export const sourceTypeLabel = (code: AttendanceSourceTypeCodeValue, translate: TranslateMessage): string =>
  translate(SOURCE_TYPE_LABEL_KEYS[code])

// --- 列表 ------------------------------------------------------------------------------

/** 列表單筆 API 原始形狀（由產生型別推導，§3.2）。 */
export type AttendanceDailyRecordListItem = AttendanceRecordsListByDateData['data'][number]

/** 表格實際渲染的列——模板只讀這裡算好的字串，不在模板內做任何換算（§1.4）。 */
export type AttendanceDailyRecordDisplayRow = {
  readonly id: string
  readonly employeeCode: string
  readonly employeeName: string
  readonly departmentName: string
  readonly attendanceTypeLabel: string
  readonly clockedAtDisplay: string
  readonly locationDisplay: string
  readonly sourceLabel: string
  readonly statusLabel: string
  /** 已撤銷的列整列灰階、操作欄不出現撤銷按鈕（UI 23「已撤銷紀錄的呈現」），
   * `AttendanceDailyRecordsTable.vue` 與 `.actions.ts` 都靠這一欄判斷，不重複算一次。 */
  readonly isRevoked: boolean
}

export const toDisplayRows = (
  items: readonly AttendanceDailyRecordListItem[],
  translate: TranslateMessage,
): AttendanceDailyRecordDisplayRow[] =>
  items.map((item) => {
    const isRevoked = item.revokedAt !== null
    return {
      id: item.id,
      employeeCode: item.employeeCode,
      employeeName: item.employeeName,
      departmentName: item.departmentName ?? EMPTY_DISPLAY,
      attendanceTypeLabel: attendanceTypeLabel(item.attendanceTypeCode, translate),
      clockedAtDisplay: formatDateTime(item.clockedAt),
      // 地點欄一律顯示「—」：GPS 反查已暫停（計畫 §4.8），UI 23 已定案這個行為。刻意不讀
      // `item.address`——反查暫停後這一欄理論上恆為 `null`，但即使後端未來某天寫進了值，
      // 這裡也不該因為欄位本身有沒有值而顯示不同的東西（那會讓「暫停」這個決定看起來像 bug）。
      locationDisplay: EMPTY_DISPLAY,
      sourceLabel: sourceTypeLabel(item.sourceTypeCode, translate),
      statusLabel: translate(
        isRevoked ? 'attendance-daily-records.status.revoked' : 'attendance-daily-records.status.active',
      ),
      isRevoked,
    }
  })

/** 已撤銷的列整列灰階（UI 23）。回傳 Tailwind class，供 `ElTable` 的 `row-class-name` 使用。 */
export const revokedRowClass = (row: { readonly isRevoked: boolean }): string => (row.isRevoked ? 'opacity-50' : '')

// --- 明細與座標三種狀態（計畫 §4.2、UI 23「座標顯示規則」） -----------------------------

/** `get` 回應非 `null` 時的形狀（由產生型別推導）。 */
type AttendanceRecordGetDetail = NonNullable<AttendanceRecordsGetData>

export type CoordinateDisplayState =
  | { readonly kind: 'visible'; readonly latitude: number; readonly longitude: number }
  | { readonly kind: 'no-gps' }
  | { readonly kind: 'no-permission' }

/**
 * 座標三種狀態的判斷。**兩層判斷不能合併**（計畫 §4.2、UI 23 原文）：
 * 1. 鍵存不存在 → 有沒有「看別人座標」的權限（沒有權限時 `latitude`／`longitude` 整個不出現）。
 * 2. 鍵存在時值是不是 `null` → 這筆本來就有沒有 GPS。
 *
 * `'latitude' in detail` 用鍵是否存在分辨第一層，`detail.latitude === null` 分辨第二層——
 * 兩個 `if` 各自獨立判斷，不寫成 `detail.latitude == null` 這種會把「鍵不存在」與
 * 「鍵存在但是 null」混成同一種結果的寫法。
 */
export const deriveCoordinateDisplayState = (detail: AttendanceRecordGetDetail): CoordinateDisplayState => {
  if (!('latitude' in detail) || !('longitude' in detail)) return { kind: 'no-permission' }
  if (detail.latitude === null || detail.longitude === null) return { kind: 'no-gps' }
  return { kind: 'visible', latitude: detail.latitude, longitude: detail.longitude }
}

/**
 * `accuracyMeters` 的產生型別是 `(string | number) | null`，不是單純的 `number | null`。
 *
 * 這不是本檔的判斷寫錯：後端 `attendance-records.routes.ts` 的 `AccuracyMeters` 欄位用了 Elysia
 * 的 `t.Integer`（可強制轉型版本），而 `field-schemas.ts` 檔頭明講**回應方向的欄位一律要用
 * TypeBox 原生的 `Type.Integer`**，理由正是「避免回應方向的整數在 OpenAPI 上變成
 * `string | integer`」——這一欄踩到了那條規則要防的情況（已在交付報告回報這個後端形狀缺口）。
 *
 * 這裡刻意不用 `Number(...)` 轉型（`check:number-cast` 禁止，且轉型後也不需要拿去計算）：
 * `string` 與 `number` 都能直接嵌進樣板字面值顯示，轉型只是多一個不必要的步驟。
 */
export const accuracyMetersDisplay = (accuracyMeters: string | number | null): string =>
  accuracyMeters === null ? EMPTY_DISPLAY : `${accuracyMeters}`

export type AttendanceDailyRecordDetailDisplay = {
  readonly employeeName: string
  readonly departmentName: string
  readonly attendanceTypeLabel: string
  readonly sourceLabel: string
  readonly clockedAtDisplay: string
  readonly locationDisplay: string
  readonly coordinates: CoordinateDisplayState
  readonly accuracyMetersDisplay: string
  readonly isRevoked: boolean
  readonly revokedAtDisplay: string
  /** 撤銷操作者的識別碼，不是姓名——`get` 回應的 `revokedBy` 只是 `company_users` 的 UUID，
   * 沒有對應的姓名欄位可以 JOIN（不像 `company-users.roles.list` 的 `assignedByName` 那樣
   * 已經回了姓名）。已在交付報告回報這個後端形狀缺口，這裡先如實顯示原始值，不假裝有姓名可顯示。 */
  readonly revokedByDisplay: string
  readonly revokeReasonDisplay: string
}

/**
 * `get` 回應 → 明細對話框顯示用的形狀。**呼叫端所在的列已經知道員工姓名與部門**
 * （列表 JOIN 帶出來的，`get` 回應本身不重複這兩欄——明細只多座標與撤銷資訊），因此
 * `employeeName`／`departmentName` 兩欄由呼叫端從觸發明細的那一列傳進來，不是 `get` 回應的欄位。
 */
export const toDetailDisplay = (
  detail: AttendanceRecordGetDetail,
  row: { readonly employeeName: string; readonly departmentName: string },
  translate: TranslateMessage,
): AttendanceDailyRecordDetailDisplay => ({
  employeeName: row.employeeName,
  departmentName: row.departmentName,
  attendanceTypeLabel: attendanceTypeLabel(detail.attendanceTypeCode, translate),
  sourceLabel: sourceTypeLabel(detail.sourceTypeCode, translate),
  clockedAtDisplay: formatDateTime(detail.clockedAt),
  locationDisplay: EMPTY_DISPLAY, // 見上：§4.8 地址反查暫停，一律顯示「—」。
  coordinates: deriveCoordinateDisplayState(detail),
  accuracyMetersDisplay: accuracyMetersDisplay(detail.accuracyMeters),
  isRevoked: detail.revokedAt !== null,
  revokedAtDisplay: formatDateTime(detail.revokedAt),
  revokedByDisplay: detail.revokedBy ?? EMPTY_DISPLAY,
  revokeReasonDisplay: detail.revokeReason ?? EMPTY_DISPLAY,
})

// --- 篩選用的部門樹／人員選項 ------------------------------------------------------------

/** 部門樹節點（由產生型別推導）。與 `employees-onboarding.view.ts` 的 `DepartmentTreeNode`
 * 形狀相同，但這裡不從那裡 import——兩個頁面互不 import（前端規範 §1.5、§0.11）。 */
export type DepartmentTreeNode = DepartmentsMainTreeData[number]

/** 員工搜尋結果單筆（由產生型別推導）。 */
export type EmployeeSearchResult = EmployeesMainListData['data'][number]

/** `ElTreeSelect` 用的人員選項：把工號併進顯示文字，理由是 UI 23「可依員工編號或姓名搜尋」
 * ——選單本身也要看得出工號，不能只顯示姓名（同名員工無法分辨）。 */
export type EmployeeOption = { readonly id: string; readonly label: string }

export const toEmployeeOptions = (items: readonly EmployeeSearchResult[]): EmployeeOption[] =>
  items.map((item) => ({ id: item.id, label: `${item.employeeCode} ${item.name}` }))
