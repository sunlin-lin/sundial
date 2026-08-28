/**
 * 班別主檔的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * 本檔刻意把「所有可能的業務拒絕」放在同一頁：§3.2 要求某些錯誤**必須刻意含糊**（跨公司存取
 * 必須與「目標不存在」逐字相同），而那件事只有把全部錯誤並排看才檢查得出來——拆散之後，
 * 下一個人只會看到自己那一支的錯誤，然後「順手」把訊息寫得更精確一點。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）：錯誤分組用具名常數表達，
 * 「這個分組在某個入口上對應什麼狀態碼」是入口的事。
 *
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2）：本檔決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定。字面中文在 `shared/i18n/locales/zh-TW/shifts.ts`。
 *
 * ---
 *
 * **本模組欠一道防護，這裡是它的第一個提醒（第二個在 `db/schema/shift-definitions.ts` 檔頭）：**
 * 「班別被排班引用後不得直接覆蓋歷史」（資料字典明文定案）本輪**刻意不實作**——沒有任何表
 * 引用 `shift_definitions`（排班那幾張表還不存在），所以「這個班別被引用了嗎」這個查詢的答案
 * 恆為否。寫一個永遠回 `false` 的檢查比不寫更糟（通用規範 §7.1「永遠是綠的規則比沒有規則更糟」）
 * ——它看起來守著一條規則，實際上一次都擋不到，而下一個人會**假設它有效**。
 *
 * **因此本輪 `update` 對任何班別都可以自由修改，這是安全的、也是事實。**
 * 排班模組動工的第一件事就是補上這道防護（計畫 §7）：屆時 `update`／`delete` 需要新增一支
 * 「目標已被排班引用」的業務錯誤，並在 service 寫入前查一次排班那幾張表。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

/**
 * 本模組的錯誤碼（§1.3，格式見下）。
 *
 * `satisfies Record<string, ErrorCode>` 把每一個碼釘在集中聯集（`shared/i18n/messages.ts`）上：
 * 新增一個碼卻忘了寫訊息時，這一行當場編譯不過，而不是等到執行期回一句查不到的訊息。
 *
 * **碼由模組路徑機械推導**：`<大目錄>.<次目錄>.<類別>.<訊息名>`，本模組在 `modules/shifts/main/`，
 * 因此一律 `shifts.main.errors.*`。
 */
export const ShiftErrorCode = {
  CodeDuplicated: 'shifts.main.errors.code-duplicated',
  NotFound: 'shifts.main.errors.not-found',
  StateChanged: 'shifts.main.errors.state-changed',
  WorkPeriodsEmpty: 'shifts.main.errors.work-periods-empty',
  WorkPeriodInvalidRange: 'shifts.main.errors.work-period-invalid-range',
  WorkPeriodsOverlap: 'shifts.main.errors.work-periods-overlap',
  WorkPeriodSequenceDuplicated: 'shifts.main.errors.work-period-sequence-duplicated',
  BreakInvalidRange: 'shifts.main.errors.break-invalid-range',
  BreakOutsideWorkPeriod: 'shifts.main.errors.break-outside-work-period',
  BreakSequenceDuplicated: 'shifts.main.errors.break-sequence-duplicated',
  BreaksOverlap: 'shifts.main.errors.breaks-overlap',
  RequiredWorkMinutesNotPositive: 'shifts.main.errors.required-work-minutes-not-positive',
} as const satisfies Record<string, ErrorCode>

export type ShiftErrorCodeValue = (typeof ShiftErrorCode)[keyof typeof ShiftErrorCode]

/**
 * 班別代碼重複。
 *
 * 分組是 `Conflict`（→ 409）而不是 `Unprocessable`：這不是「這個值格式不對」，而是「這個值與
 * 另一筆既有資料撞了」，前端的處置是請使用者換一個代碼，不是重填整張表。
 *
 * 不回聲是哪一筆既有班別佔用了這個代碼——回聲等於讓任何人用建立表單反查公司內有哪些班別代碼
 * （與 `employees.main.errors.code-duplicated` 同一個理由，§3.2）。
 */
export const shiftCodeDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: ShiftErrorCode.CodeDuplicated,
  msg: ShiftErrorCode.CodeDuplicated,
  data: { field: 'code' },
})

/**
 * 目標班別不存在（動作類端點，§3.1.3）。
 *
 * **跨公司存取一律回這一筆**，與「這個 id 根本不存在」逐字相同（§3.2）：兩者一旦可區分，
 * 攻擊者拿 id 枚舉就能探測出別家公司有哪些班別存在。實作上不是「記得回同一句」，而是查詢
 * 一律帶 `company_id`（§4.2），於是兩條路徑走的是同一行程式碼。
 *
 * @param field 這筆錯誤指的是哪一個識別碼欄位——`update`／`delete` 用 `'id'`，
 *   `copy` 的來源班別不存在用 `'sourceId'`（兩者是不同的 request 欄位，§1.3 的 dot-path 必須
 *   指到真正出錯的那一格）。
 */
export const shiftNotFound = (field: 'id' | 'sourceId' = 'id'): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.NotFound,
  msg: ShiftErrorCode.NotFound,
  data: { field },
})

/**
 * 條件式 UPDATE／軟刪除影響 0 列（§4.4）：在讀取與寫入之間，別人已經改過（或刪掉）這筆資料。
 *
 * 與 {@link shiftNotFound} 分成兩個碼，是因為使用者的處置不同：一個是重新載入清單就好，
 * 一個是資料真的沒了（§3.1.3）。混用會讓前端只能一律叫使用者重新整理。
 */
export const shiftStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: ShiftErrorCode.StateChanged,
  msg: ShiftErrorCode.StateChanged,
  data: { field: 'id' },
})

/** 零段工作時段（計畫 §5.2）：`requiredWorkMinutes` 會變成 0 或負數，這個班別完全沒有意義。 */
export const shiftWorkPeriodsEmpty = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.WorkPeriodsEmpty,
  msg: ShiftErrorCode.WorkPeriodsEmpty,
  data: { field: 'workPeriods' },
})

/**
 * 單一工作時段的起訖換算成絕對分鐘後不是正值（含日偏移）。
 *
 * 最常見的成因：跨日時段忘了把 `endDayOffset` 設成 1（例如 22:00–06:00 卻兩段都填 0），
 * 換算出來的結束時刻反而早於開始時刻。
 */
export const shiftWorkPeriodInvalidRange = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.WorkPeriodInvalidRange,
  msg: ShiftErrorCode.WorkPeriodInvalidRange,
  data: { field: `workPeriods.${index}.endTime` },
})

/**
 * 兩段工作時段重疊（計畫 §5.2）：中空班的**空檔**合法，重疊不合法——兩者的差別是有沒有交集，
 * 已換算成絕對分鐘後比較（含日偏移），不是只比 `startTime`／`endTime`。
 *
 * @param index 較晚開始的那一段在原始陣列中的位置（§1.3 的 dot-path 必須指到使用者畫面上的那一列）。
 * @param conflictWithIndex 與它重疊的另一段的位置。
 */
export const shiftWorkPeriodsOverlap = (index: number, conflictWithIndex: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.WorkPeriodsOverlap,
  msg: ShiftErrorCode.WorkPeriodsOverlap,
  data: { field: `workPeriods.${index}.startTime`, conflictWith: `workPeriods.${conflictWithIndex}` },
})

/**
 * 同一班別內的工作時段 `sequenceNo` 重複。
 *
 * DB 有 `UNIQUE(shift_definition_id, sequence_no)`，但那是寫入後才會報的驅動錯誤——
 * 在同一批新資料裡重複送同一個 `sequenceNo` 時，寫入前就攔下來，不讓它變成 500（計畫要求）。
 */
export const shiftWorkPeriodSequenceDuplicated = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.WorkPeriodSequenceDuplicated,
  msg: ShiftErrorCode.WorkPeriodSequenceDuplicated,
  data: { field: `workPeriods.${index}.sequenceNo` },
})

/** 單一休息時段的起訖換算成絕對分鐘後不是正值（含日偏移）。理由同 {@link shiftWorkPeriodInvalidRange}。 */
export const shiftBreakInvalidRange = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.BreakInvalidRange,
  msg: ShiftErrorCode.BreakInvalidRange,
  data: { field: `breaks.${index}.endTime` },
})

/**
 * 休息時段沒有完整落在任何一段工作時段內（計畫 §5.2）。
 *
 * 已換算成絕對分鐘後比較（含日偏移）：22:00–06:00 的夜班休息 02:00–03:00，`startDayOffset`／
 * `endDayOffset` 都是 1，換算成絕對分鐘 1560–1620 落在工作時段 1320–1800 之內，因此通過；
 * 若日偏移填錯（例如填成 0），換算出來的 120–180 落在工作時段之外，就會被這條擋下。
 */
export const shiftBreakOutsideWorkPeriod = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.BreakOutsideWorkPeriod,
  msg: ShiftErrorCode.BreakOutsideWorkPeriod,
  data: { field: `breaks.${index}.startTime` },
})

/** 同一班別內的休息時段 `sequenceNo` 重複。理由同 {@link shiftWorkPeriodSequenceDuplicated}。 */
export const shiftBreakSequenceDuplicated = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.BreakSequenceDuplicated,
  msg: ShiftErrorCode.BreakSequenceDuplicated,
  data: { field: `breaks.${index}.sequenceNo` },
})

/**
 * 兩段休息時段重疊。
 *
 * **不是 `shiftBreakOutsideWorkPeriod` 的重複檢查**：那一條問的是「這段休息在不在某段工作時段
 * 裡面」，這一條問的是「兩段休息有沒有互相交集」——12:00–13:00 與 12:30–13:30 兩段都可能各自
 * 完整落在同一段工作時段內（因此不會被 `outside-work-period` 擋到），但重疊的那半小時會在
 * `requiredWorkMinutes` 的計算裡被**扣兩次**：那個值是 `attendance_results.scheduled_minutes`
 * 的來源（出勤判定的分母），少算的分鐘會讓每一個上這個班的人每天都被判定超時工作，
 * 而畫面上這張班別看起來完全正常。
 */
export const shiftBreaksOverlap = (index: number, conflictWithIndex: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.BreaksOverlap,
  msg: ShiftErrorCode.BreaksOverlap,
  data: { field: `breaks.${index}.startTime`, conflictWith: `breaks.${conflictWithIndex}` },
})

/**
 * 應工作分鐘算出來不是正值——**最後一道防線**（`domain/shift-validation.ts` 的
 * `validateShiftStructure` 檔頭已詳述：它不依賴休息互斥那條規則是否還在，只看最終算出來的數字）。
 *
 * `data.requiredWorkMinutes` 帶著實際算出來的值（可能是 0 或負數），讓看到這則錯誤的人不必自己
 * 重新加總就知道要調整多少——這張表的錯誤要能讓人直接改，不是只說「不合法」。
 */
export const shiftRequiredWorkMinutesNotPositive = (requiredWorkMinutes: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: ShiftErrorCode.RequiredWorkMinutesNotPositive,
  msg: ShiftErrorCode.RequiredWorkMinutesNotPositive,
  data: { field: 'workPeriods', requiredWorkMinutes },
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 * （`http/error-boundary.ts`：出現任一 `Conflict` → 409，其餘 → 422），業務程式碼一行都不會讀它。
 */
export type ShiftErrorDeclaration = {
  readonly code: ShiftErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`，其餘代碼不會帶 `errors`。 */
  readonly webFlowCode: '300'
}

const conflict = (code: ShiftErrorCodeValue): ShiftErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: ShiftErrorCodeValue): ShiftErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

/** 時段與休息的結構性驗證錯誤（計畫 §5.2）：`create`／`update` 共用同一組。 */
const STRUCTURE_ERRORS: readonly ShiftErrorDeclaration[] = [
  unprocessable(ShiftErrorCode.WorkPeriodsEmpty),
  unprocessable(ShiftErrorCode.WorkPeriodInvalidRange),
  unprocessable(ShiftErrorCode.WorkPeriodsOverlap),
  unprocessable(ShiftErrorCode.WorkPeriodSequenceDuplicated),
  unprocessable(ShiftErrorCode.BreakInvalidRange),
  unprocessable(ShiftErrorCode.BreakOutsideWorkPeriod),
  unprocessable(ShiftErrorCode.BreakSequenceDuplicated),
  unprocessable(ShiftErrorCode.BreaksOverlap),
  unprocessable(ShiftErrorCode.RequiredWorkMinutesNotPositive),
]

/**
 * 每支端點會吐出哪些業務錯誤。
 *
 * **不會吐出任何業務錯誤的端點也必須宣告空清單**（§1.8.3）：省略時「這支沒有業務錯誤」與
 * 「有人忘了宣告」在契約上長得一模一樣。
 *
 * `copy`：**沒有結構性驗證錯誤**——內容整組取自來源班別（計畫 §7），來源在建立時已經驗證過，
 * 複製時不重新檢查時段與休息的形狀；`copy` 只可能撞到新代碼重複，或來源班別不存在（含跨公司）。
 */
export const SHIFT_ENDPOINT_ERRORS = {
  /** 查詢類：查無資料回空清單，不是錯誤（§3.1.3）。 */
  list: [],
  /** 查詢類：查無資料回 `data: null`，不是錯誤（§3.1.3）。跨公司存取同樣回 `null`（§3.2）。 */
  get: [],
  create: [conflict(ShiftErrorCode.CodeDuplicated), ...STRUCTURE_ERRORS],
  // **沒有 `StateChanged`**：`updateShiftProfile` 刻意不檢查影響列數（理由見該檔檔頭，與
  // `roles-main.update-profile.repository.ts` 同構），因此這個碼在 `update` 上不可能被產出——
  // 宣告一個永遠不會發生的錯誤碼，前端會為它準備一段永遠用不到的文案（通用規範 §7.1）。
  update: [unprocessable(ShiftErrorCode.NotFound), conflict(ShiftErrorCode.CodeDuplicated), ...STRUCTURE_ERRORS],
  copy: [unprocessable(ShiftErrorCode.NotFound), conflict(ShiftErrorCode.CodeDuplicated)],
  delete: [unprocessable(ShiftErrorCode.NotFound), conflict(ShiftErrorCode.StateChanged)],
} as const satisfies Record<string, readonly ShiftErrorDeclaration[]>

/**
 * 把宣告清單轉成 OpenAPI 的 `description` 文字。
 *
 * 清單必須進契約（§1.8.3），而 Elysia 的 `detail` 只吃標準 OpenAPI 欄位；塞進 `description`
 * 是目前唯一不需要自訂擴充欄位就能讓前端看到這份清單的位置。
 */
export const describeShiftErrors = (declarations: readonly ShiftErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
