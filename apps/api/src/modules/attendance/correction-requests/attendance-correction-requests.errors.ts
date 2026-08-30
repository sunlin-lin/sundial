/**
 * 補打卡申請的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）：錯誤分組用具名常數表達，
 * 「這個分組在某個入口上對應什麼狀態碼」是入口的事。
 *
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2）：本檔決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定。字面中文在 `shared/i18n/locales/zh-TW/attendance.ts`。
 *
 * **`list-own` 沒有業務錯誤可以吐**（查詢類端點，呼叫者沒有連結員工時回空清單，不是錯誤，
 * 見 `impl/attendance-correction-requests.list-own.service.ts`），因此宣告清單是空陣列
 * （§1.8.3：「不會吐出任何業務錯誤的端點也必須宣告空清單」）。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

/** 本模組的錯誤碼（§1.3，格式見下）。`<大目錄>.<次目錄>.<類別>.<訊息名>`，一律
 * `attendance.correction-requests.errors.*`。 */
export const AttendanceCorrectionRequestErrorCode = {
  OperatorNotEmployee: 'attendance.correction-requests.errors.operator-not-employee',
  FutureDateNotAllowed: 'attendance.correction-requests.errors.future-date-not-allowed',
  AlreadyPunched: 'attendance.correction-requests.errors.already-punched',
  InvalidClockOrder: 'attendance.correction-requests.errors.invalid-clock-order',
  DuplicatePendingRequest: 'attendance.correction-requests.errors.duplicate-pending-request',
  PeriodLocked: 'attendance.correction-requests.errors.period-locked',
  CorrectionRequestNotAllowed: 'attendance.correction-requests.errors.correction-request-not-allowed',
  NotFound: 'attendance.correction-requests.errors.not-found',
  NotWithdrawable: 'attendance.correction-requests.errors.not-withdrawable',
} as const satisfies Record<string, ErrorCode>

export type AttendanceCorrectionRequestErrorCodeValue =
  (typeof AttendanceCorrectionRequestErrorCode)[keyof typeof AttendanceCorrectionRequestErrorCode]

/** 操作者的登入帳號沒有連結員工，或連結的員工目前沒有有效任職——無法決定這筆申請的歸屬。 */
export const attendanceCorrectionRequestOperatorNotEmployee = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceCorrectionRequestErrorCode.OperatorNotEmployee,
  msg: AttendanceCorrectionRequestErrorCode.OperatorNotEmployee,
})

/** UI 13「不可選擇未來日期」。 */
export const attendanceCorrectionRequestFutureDateNotAllowed = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceCorrectionRequestErrorCode.FutureDateNotAllowed,
  msg: AttendanceCorrectionRequestErrorCode.FutureDateNotAllowed,
})

/** UI 13「已有效打卡的類型不可重複申請」。分組為 `Conflict`（409）：與 `attendance/records` 的
 * `already-punched` 是同一種業務語意——已經有一筆正式打卡，不是這次填的值有問題。 */
export const attendanceCorrectionRequestAlreadyPunched = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: AttendanceCorrectionRequestErrorCode.AlreadyPunched,
  msg: AttendanceCorrectionRequestErrorCode.AlreadyPunched,
})

/** UI 13「補卡時間需符合上下班基本先後關係」：與同一工作日已存在的有效打卡比較時，順序不符。 */
export const attendanceCorrectionRequestInvalidClockOrder = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceCorrectionRequestErrorCode.InvalidClockOrder,
  msg: AttendanceCorrectionRequestErrorCode.InvalidClockOrder,
})

/** UI 13「同一工作日、同一類型已有待審核申請時，不可重複送出」。分組為 `Conflict`：狀態衝突，
 * 不是這次填的值本身有問題。 */
export const attendanceCorrectionRequestDuplicatePendingRequest = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: AttendanceCorrectionRequestErrorCode.DuplicatePendingRequest,
  msg: AttendanceCorrectionRequestErrorCode.DuplicatePendingRequest,
})

/**
 * 該工作日已被薪資結算鎖定（字典「已確認流程與約束」：已結算月份不得提出申請）。**分組不是
 * `Forbidden`**——理由與 `attendance/records` 的 `attendanceRecordPeriodLocked` 相同：
 * `Forbidden` 在邊界層一律映射成不帶細節的「無權限」，會把訊息內容一起吃掉。
 */
export const attendanceCorrectionRequestPeriodLocked = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceCorrectionRequestErrorCode.PeriodLocked,
  msg: AttendanceCorrectionRequestErrorCode.PeriodLocked,
})

/** `attendance_settings.allow_correction_request = false`：公司關閉補打卡申請功能。**分組不是
 * `Forbidden`**，理由與 `attendanceCorrectionRequestPeriodLocked` 相同。 */
export const attendanceCorrectionRequestNotAllowed = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceCorrectionRequestErrorCode.CorrectionRequestNotAllowed,
  msg: AttendanceCorrectionRequestErrorCode.CorrectionRequestNotAllowed,
})

/** 目標申請不存在，或存在但不是本人的——回同一則（比照 `attendance/records` 的 `revoke`，
 * 不讓呼叫端從錯誤訊息分辨「這筆申請存在、只是不是你的」）。 */
export const attendanceCorrectionRequestNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceCorrectionRequestErrorCode.NotFound,
  msg: AttendanceCorrectionRequestErrorCode.NotFound,
})

/** 條件式 UPDATE 影響 0 列，或讀取當下狀態已經不是待審核：這筆申請已核准、已退回或已撤回，
 * UI 13「只有待審核申請可以撤回」。 */
export const attendanceCorrectionRequestNotWithdrawable = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: AttendanceCorrectionRequestErrorCode.NotWithdrawable,
  msg: AttendanceCorrectionRequestErrorCode.NotWithdrawable,
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 * （`http/error-boundary.ts`），業務程式碼一行都不會讀它。
 */
export type AttendanceCorrectionRequestErrorDeclaration = {
  readonly code: AttendanceCorrectionRequestErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`。 */
  readonly webFlowCode: '300'
}

const conflict = (code: AttendanceCorrectionRequestErrorCodeValue): AttendanceCorrectionRequestErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (
  code: AttendanceCorrectionRequestErrorCodeValue,
): AttendanceCorrectionRequestErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

/**
 * 每支端點會吐出哪些業務錯誤。
 *
 * **不會吐出任何業務錯誤的端點也必須宣告空清單**（§1.8.3）：省略時「這支沒有業務錯誤」與
 * 「有人忘了宣告」在契約上長得一模一樣。
 */
export const ATTENDANCE_CORRECTION_REQUESTS_ENDPOINT_ERRORS = {
  submit: [
    unprocessable(AttendanceCorrectionRequestErrorCode.OperatorNotEmployee),
    unprocessable(AttendanceCorrectionRequestErrorCode.FutureDateNotAllowed),
    conflict(AttendanceCorrectionRequestErrorCode.AlreadyPunched),
    unprocessable(AttendanceCorrectionRequestErrorCode.InvalidClockOrder),
    conflict(AttendanceCorrectionRequestErrorCode.DuplicatePendingRequest),
    unprocessable(AttendanceCorrectionRequestErrorCode.PeriodLocked),
    unprocessable(AttendanceCorrectionRequestErrorCode.CorrectionRequestNotAllowed),
  ],
  withdraw: [
    unprocessable(AttendanceCorrectionRequestErrorCode.NotFound),
    conflict(AttendanceCorrectionRequestErrorCode.NotWithdrawable),
  ],
  listOwn: [],
} as const satisfies Record<string, readonly AttendanceCorrectionRequestErrorDeclaration[]>

/** 把宣告清單轉成 OpenAPI 的 `description` 文字。 */
export const describeAttendanceCorrectionRequestErrors = (
  declarations: readonly AttendanceCorrectionRequestErrorDeclaration[],
): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
