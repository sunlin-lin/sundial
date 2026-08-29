/**
 * 出勤設定的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）：錯誤分組用具名常數表達，
 * 「這個分組在某個入口上對應什麼狀態碼」是入口的事。
 *
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2）：本檔決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定。字面中文在 `shared/i18n/locales/zh-TW/attendance.ts`。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

/**
 * 本模組的錯誤碼（§1.3，格式見下）。
 *
 * **碼由模組路徑機械推導**：`<大目錄>.<次目錄>.<類別>.<訊息名>`，本模組在
 * `modules/attendance/settings/`，因此一律 `attendance.settings.errors.*`。
 */
export const AttendanceSettingsErrorCode = {
  ConcurrentlyInitialized: 'attendance.settings.errors.concurrently-initialized',
} as const satisfies Record<string, ErrorCode>

export type AttendanceSettingsErrorCodeValue =
  (typeof AttendanceSettingsErrorCode)[keyof typeof AttendanceSettingsErrorCode]

/**
 * 兩個人同時對一間**還沒有存過設定**的公司第一次送出 `update`：兩者都讀到「還沒有設定」，
 * 都嘗試建立第一筆，先到的成功，後到的撞唯一鍵（完整推論見 `impl/attendance-settings.update.
 * service.ts` 檔頭）。
 *
 * 分組是 `Conflict`（→ 409）而不是 `Unprocessable`：這不是「這個值格式不對」，是「與另一筆
 * 幾乎同時發生的寫入撞了」，前端的處置是重新查詢一次目前設定再重新送出，不是要求使用者改值
 * ——事實上再送一次同樣的內容就會成功（此時公司已經有設定了，這支端點會走更新分支）。
 */
export const attendanceSettingsConcurrentlyInitialized = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: AttendanceSettingsErrorCode.ConcurrentlyInitialized,
  msg: AttendanceSettingsErrorCode.ConcurrentlyInitialized,
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 * （`http/error-boundary.ts`），業務程式碼一行都不會讀它。
 */
export type AttendanceSettingsErrorDeclaration = {
  readonly code: AttendanceSettingsErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`。 */
  readonly webFlowCode: '300'
}

const conflict = (code: AttendanceSettingsErrorCodeValue): AttendanceSettingsErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

/**
 * 每支端點會吐出哪些業務錯誤。
 *
 * **不會吐出任何業務錯誤的端點也必須宣告空清單**（§1.8.3）：省略時「這支沒有業務錯誤」與
 * 「有人忘了宣告」在契約上長得一模一樣。
 */
export const ATTENDANCE_SETTINGS_ENDPOINT_ERRORS = {
  /** 查詢類：查無設定回 `data: null`，不是錯誤（§3.1.3）。跨公司存取同樣回 `null`（§3.2）。 */
  get: [],
  update: [conflict(AttendanceSettingsErrorCode.ConcurrentlyInitialized)],
} as const satisfies Record<string, readonly AttendanceSettingsErrorDeclaration[]>

/**
 * 把宣告清單轉成 OpenAPI 的 `description` 文字。
 */
export const describeAttendanceSettingsErrors = (
  declarations: readonly AttendanceSettingsErrorDeclaration[],
): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
