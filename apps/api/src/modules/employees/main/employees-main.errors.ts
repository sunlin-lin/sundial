/**
 * 員工主檔的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * 本檔刻意把「所有可能的業務拒絕」放在同一頁：§3.2 要求某些錯誤**必須刻意含糊**
 * （跨公司存取必須與「目標不存在」逐字相同；敏感識別值的唯一性檢查只能回「無法建立」，
 * 不得回聲與哪一筆重複），而那件事只有把全部錯誤並排看才檢查得出來
 * ——拆散之後，下一個人只會看到自己那一支的錯誤，然後「順手」把訊息寫得更精確一點。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）：錯誤分組用具名常數表達，
 * 「這個分組在某個入口上對應什麼狀態碼」是入口的事。
 *
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2）：本檔決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定。字面中文在 `shared/i18n/locales/`（查詢入口是 `shared/i18n/messages.ts`）——因此下面每一段
 * 「訊息不得寫得更精確」的說明（§3.2），要連著那一頁一起看：規格在這裡，字在那裡。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

/**
 * 本模組的錯誤碼（§1.3 的 `<領域>.<原因>`）。
 *
 * `satisfies Record<string, ErrorCode>` 把每一個碼釘在集中聯集（`shared/i18n/messages.ts`）上：
 * 新增一個碼卻忘了寫訊息時，**這一行當場編譯不過**，而不是等到執行期回一句查不到的訊息。
 *
 * 領域一律用單數的 `employee`，而不是路徑上的 `employees`：錯誤碼的領域與路徑段名是兩套
 * 獨立的命名空間（§1.3）。寫成 `employees.` 會讓錯誤碼看起來像權限碼／`cmd`（那兩者才等於路徑），
 * 而它們的比對規則完全不同——混淆之後，log 上用同一個字串搜尋會撈到兩種不相干的東西。
 */
export const EmployeeErrorCode = {
  CodeDuplicated: 'employee.code-duplicated',
  IdentityNumberDuplicated: 'employee.identity-number-duplicated',
  NotFound: 'employee.not-found',
  StateChanged: 'employee.state-changed',
} as const satisfies Record<string, ErrorCode>

export type EmployeeErrorCodeValue = (typeof EmployeeErrorCode)[keyof typeof EmployeeErrorCode]

/**
 * 員工編號重複。
 *
 * 分組是 `Conflict`（→ 409）而不是 `Unprocessable`：這不是「這個值格式不對」，
 * 而是「這個值與另一筆既有資料撞了」，前端的處置是請使用者換一個編號，不是重填整張表。
 *
 * §3.2：訊息**只說重複，不回聲是哪一位員工佔用了這個編號**——回聲等於讓任何人用建立表單
 * 反查公司內有哪些員工。這是規格不是疏漏，請勿「修好」。
 */
export const employeeCodeDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: EmployeeErrorCode.CodeDuplicated,
  msg: EmployeeErrorCode.CodeDuplicated,
  data: { field: 'employeeCode' },
})

/**
 * 身分證字號重複（同公司內已有同一個人）。
 *
 * §3.2 對「敏感識別值的唯一性檢查」有一條**比員工編號更嚴格**的要求：只能回「無法建立」，
 * **禁止回聲與哪一筆既有資料重複**——回聲等於用建立表單反查他人的身分證。
 * 因此這裡的 `msg` 不提任何人名、不提員工編號，`data` 也只有 `field` 一個欄位名，
 * **連使用者剛剛送來的那個身分證都不放進去**（§5.1：禁止把敏感值寫進 `errors[].data`）。
 *
 * 分組同樣是 `Conflict`：使用者的處置是「這個人已經在系統裡了，去找他」，不是重填表單。
 */
export const employeeIdentityNumberDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: EmployeeErrorCode.IdentityNumberDuplicated,
  msg: EmployeeErrorCode.IdentityNumberDuplicated,
  data: { field: 'identityNumber' },
})

/**
 * 目標員工不存在（動作類端點，§3.1.3）。
 *
 * **跨公司存取一律回這一筆**，與「這個 id 根本不存在」逐字相同（§3.2）：兩者一旦可區分，
 * 攻擊者拿 id 枚舉就能探測出別家公司有哪些員工存在——他不需要看到任何內容，
 * 「存在」本身就是外洩。實作上不是「記得回同一句」，而是查詢一律帶 `company_id`（§4.2），
 * 於是兩條路徑走的是同一行程式碼。
 */
export const employeeNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: EmployeeErrorCode.NotFound,
  msg: EmployeeErrorCode.NotFound,
  data: { field: 'id' },
})

/**
 * 條件式 UPDATE 影響 0 列（§4.4）：在讀取與寫入之間，別人已經改過（或刪掉）這筆資料。
 *
 * 與 {@link employeeNotFound} 分成兩個碼，是因為使用者的處置不同：一個是重新載入清單就好，
 * 一個是資料真的沒了（§3.1.3）。混用會讓前端只能一律叫使用者重新整理。
 */
export const employeeStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: EmployeeErrorCode.StateChanged,
  msg: EmployeeErrorCode.StateChanged,
  data: { field: 'id' },
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 * （`http/error-boundary.ts`：出現任一 `Conflict` → 409，其餘 → 422），業務程式碼一行都不會讀它。
 * 之所以仍然寫出來，是因為 §1.8.3 要求「每個錯誤碼在宣告時必須同時標明它對應的 HTTP status ＋
 * envelope `code`，且一個錯誤碼只能對應一種」——而那份資訊要進 OpenAPI 給前端看。
 */
export type EmployeeErrorDeclaration = {
  readonly code: EmployeeErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`，其餘代碼不會帶 `errors`。 */
  readonly webFlowCode: '300'
}

const conflict = (code: EmployeeErrorCodeValue): EmployeeErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: EmployeeErrorCodeValue): EmployeeErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

/**
 * 每支端點會吐出哪些業務錯誤。
 *
 * **不會吐出任何業務錯誤的端點也必須宣告空清單**（§1.8.3）：省略時「這支沒有業務錯誤」與
 * 「有人忘了宣告」在契約上長得一模一樣，前端只能一律當作「可能有沒寫出來的錯誤」而退回保守處理。
 */
export const EMPLOYEE_ENDPOINT_ERRORS = {
  /** 查詢類：查無資料回空清單，不是錯誤（§3.1.3）。 */
  list: [],
  /** 查詢類：查無資料回 `data: null`，不是錯誤（§3.1.3）。跨公司存取同樣回 `null`（§3.2）。 */
  get: [],
  create: [conflict(EmployeeErrorCode.CodeDuplicated), conflict(EmployeeErrorCode.IdentityNumberDuplicated)],
  update: [
    unprocessable(EmployeeErrorCode.NotFound),
    conflict(EmployeeErrorCode.CodeDuplicated),
    conflict(EmployeeErrorCode.IdentityNumberDuplicated),
    conflict(EmployeeErrorCode.StateChanged),
  ],
  delete: [unprocessable(EmployeeErrorCode.NotFound), conflict(EmployeeErrorCode.StateChanged)],
} as const satisfies Record<string, readonly EmployeeErrorDeclaration[]>

/**
 * 把宣告清單轉成 OpenAPI 的 `description` 文字。
 *
 * 清單必須進契約（§1.8.3），而 Elysia 的 `detail` 只吃標準 OpenAPI 欄位；塞進 `description`
 * 是目前唯一不需要自訂擴充欄位就能讓前端看到這份清單的位置。
 */
export const describeEmployeeErrors = (declarations: readonly EmployeeErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
