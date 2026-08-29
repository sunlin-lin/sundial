/**
 * 打卡的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）：錯誤分組用具名常數表達，
 * 「這個分組在某個入口上對應什麼狀態碼」是入口的事。
 *
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2）：本檔決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定。字面中文在 `shared/i18n/locales/zh-TW/attendance.ts`。
 *
 * **`get`／`list-by-date` 沒有業務錯誤可以吐**（座標可見範圍是回應形狀的差異，不是失敗，
 * 見 `domain/attendance-record-visibility.ts` 檔頭），因此兩者的宣告清單是空陣列（§1.8.3：
 * 「不會吐出任何業務錯誤的端點也必須宣告空清單」）。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

/** 本模組的錯誤碼（§1.3，格式見下）。`<大目錄>.<次目錄>.<類別>.<訊息名>`，一律 `attendance.records.errors.*`。 */
export const AttendanceRecordErrorCode = {
  OperatorNotEmployee: 'attendance.records.errors.operator-not-employee',
  AlreadyPunched: 'attendance.records.errors.already-punched',
  NoClockInToPair: 'attendance.records.errors.no-clock-in-to-pair',
  GpsRequired: 'attendance.records.errors.gps-required',
  RecordNotFound: 'attendance.records.errors.not-found',
  AlreadyRevoked: 'attendance.records.errors.already-revoked',
  ClockOutMustBeRevokedFirst: 'attendance.records.errors.clock-out-must-be-revoked-first',
  PeriodLocked: 'attendance.records.errors.period-locked',
} as const satisfies Record<string, ErrorCode>

export type AttendanceRecordErrorCodeValue = (typeof AttendanceRecordErrorCode)[keyof typeof AttendanceRecordErrorCode]

/** 操作者的登入帳號沒有連結員工，或連結的員工目前沒有有效任職——打卡當下無法決定歸屬。 */
export const attendanceRecordOperatorNotEmployee = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceRecordErrorCode.OperatorNotEmployee,
  msg: AttendanceRecordErrorCode.OperatorNotEmployee,
})

/**
 * 這筆任職今天（或配對到的工作日）已經有一張有效的同類型卡。**分組為 `Conflict`（409）**：
 * 這與唯一鍵違反（併發時的最後一道保險）是同一種業務語意——「已經有一筆，不是這筆填錯了什麼」，
 * 前端的處置是重新整理目前狀態，不是要求使用者改值。
 */
export const attendanceRecordAlreadyPunched = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: AttendanceRecordErrorCode.AlreadyPunched,
  msg: AttendanceRecordErrorCode.AlreadyPunched,
})

/** 打下班卡時找不到可配對的有效上班卡，且公司出勤設定要求必須先有上班卡（預設值：要求）。 */
export const attendanceRecordNoClockInToPair = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceRecordErrorCode.NoClockInToPair,
  msg: AttendanceRecordErrorCode.NoClockInToPair,
})

/** 公司出勤設定要求必須有 GPS 座標（`gps_required=true`），但這次打卡沒有帶座標。 */
export const attendanceRecordGpsRequired = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceRecordErrorCode.GpsRequired,
  msg: AttendanceRecordErrorCode.GpsRequired,
})

/**
 * 目標打卡記錄不存在。**`revoke`（本人）比對「這筆記錄是不是本人的」不通過時，也回這一則**
 * （計畫 §4.3.1：不相等就視同找不到，比照 `sessions-main.logout-all.service.ts` 的先例），
 * 不能讓呼叫端從錯誤訊息分辨出「這筆記錄存在、只是不是你的」。
 */
export const attendanceRecordNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceRecordErrorCode.RecordNotFound,
  msg: AttendanceRecordErrorCode.RecordNotFound,
})

/** 條件式 UPDATE 影響 0 列：讀取與寫入之間已經有人撤銷過這筆記錄了（§4.4）。 */
export const attendanceRecordAlreadyRevoked = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: AttendanceRecordErrorCode.AlreadyRevoked,
  msg: AttendanceRecordErrorCode.AlreadyRevoked,
})

/** 字典「已確認的 Dashboard 打卡與撤銷」：已有下班卡時，需先撤銷下班卡，才能撤銷其前面的上班卡。 */
export const attendanceRecordClockOutMustBeRevokedFirst = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceRecordErrorCode.ClockOutMustBeRevokedFirst,
  msg: AttendanceRecordErrorCode.ClockOutMustBeRevokedFirst,
})

/**
 * 該工作日已被薪資結算鎖定（計畫 §4.3.1）。**訊息要指向正確出路**，因此分組不是 `Forbidden`
 * ——`Forbidden` 在邊界層一律映射成不帶細節的「無權限」（`permissionDenied()`），會把「請改走
 * 補打卡流程」這句指引一起吃掉。
 */
export const attendanceRecordPeriodLocked = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: AttendanceRecordErrorCode.PeriodLocked,
  msg: AttendanceRecordErrorCode.PeriodLocked,
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 * （`http/error-boundary.ts`），業務程式碼一行都不會讀它。
 */
export type AttendanceRecordErrorDeclaration = {
  readonly code: AttendanceRecordErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`。 */
  readonly webFlowCode: '300'
}

const conflict = (code: AttendanceRecordErrorCodeValue): AttendanceRecordErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: AttendanceRecordErrorCodeValue): AttendanceRecordErrorDeclaration => ({
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
export const ATTENDANCE_RECORDS_ENDPOINT_ERRORS = {
  create: [
    unprocessable(AttendanceRecordErrorCode.OperatorNotEmployee),
    conflict(AttendanceRecordErrorCode.AlreadyPunched),
    unprocessable(AttendanceRecordErrorCode.NoClockInToPair),
    unprocessable(AttendanceRecordErrorCode.GpsRequired),
  ],
  revoke: [
    unprocessable(AttendanceRecordErrorCode.RecordNotFound),
    conflict(AttendanceRecordErrorCode.AlreadyRevoked),
    unprocessable(AttendanceRecordErrorCode.ClockOutMustBeRevokedFirst),
    unprocessable(AttendanceRecordErrorCode.PeriodLocked),
  ],
  revokeOther: [
    unprocessable(AttendanceRecordErrorCode.RecordNotFound),
    conflict(AttendanceRecordErrorCode.AlreadyRevoked),
    unprocessable(AttendanceRecordErrorCode.ClockOutMustBeRevokedFirst),
    unprocessable(AttendanceRecordErrorCode.PeriodLocked),
  ],
  get: [],
  listByDate: [],
} as const satisfies Record<string, readonly AttendanceRecordErrorDeclaration[]>

/** 把宣告清單轉成 OpenAPI 的 `description` 文字。 */
export const describeAttendanceRecordErrors = (declarations: readonly AttendanceRecordErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
