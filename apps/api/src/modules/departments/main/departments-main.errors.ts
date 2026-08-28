/**
 * 部門主檔的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * 本檔刻意把「所有可能的業務拒絕」放在同一頁：§3.2 要求某些錯誤**必須刻意含糊**（跨公司存取
 * 必須與「目標不存在」逐字相同，候選上層跨公司也必須與「上層不存在」逐字相同），而那件事只有
 * 把全部錯誤並排看才檢查得出來——拆散之後，下一個人只會看到自己那一支的錯誤，然後「順手」
 * 把訊息寫得更精確一點。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）：錯誤分組用具名常數表達，
 * 「這個分組在某個入口上對應什麼狀態碼」是入口的事。
 *
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2）：本檔決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定。字面中文在 `shared/i18n/locales/zh-TW/departments.ts`。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

/**
 * 本模組的錯誤碼（§1.3，格式見下）。
 *
 * `satisfies Record<string, ErrorCode>` 把每一個碼釘在集中聯集（`shared/i18n/messages.ts`）上：
 * 新增一個碼卻忘了寫訊息時，這一行當場編譯不過，而不是等到執行期回一句查不到的訊息。
 *
 * **碼由模組路徑機械推導**：`<大目錄>.<次目錄>.<類別>.<訊息名>`，本模組在 `modules/departments/main/`，
 * 因此一律 `departments.main.errors.*`。
 */
export const DepartmentErrorCode = {
  CodeDuplicated: 'departments.main.errors.code-duplicated',
  NotFound: 'departments.main.errors.not-found',
  ParentNotFound: 'departments.main.errors.parent-not-found',
  ParentCycle: 'departments.main.errors.parent-cycle',
  HasChildren: 'departments.main.errors.has-children',
  StateChanged: 'departments.main.errors.state-changed',
} as const satisfies Record<string, ErrorCode>

export type DepartmentErrorCodeValue = (typeof DepartmentErrorCode)[keyof typeof DepartmentErrorCode]

/**
 * 部門代碼重複。
 *
 * 分組是 `Conflict`（→ 409）而不是 `Unprocessable`：這不是「這個值格式不對」，而是「這個值與
 * 另一筆既有資料撞了」，前端的處置是請使用者換一個代碼，不是重填整張表（比照
 * `shifts.main.errors.code-duplicated`）。
 *
 * 不回聲是哪一筆既有部門佔用了這個代碼——回聲等於讓任何人用建立表單反查公司內有哪些部門代碼
 * （§3.2）。
 */
export const departmentCodeDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: DepartmentErrorCode.CodeDuplicated,
  msg: DepartmentErrorCode.CodeDuplicated,
  data: { field: 'code' },
})

/**
 * 目標部門不存在（動作類端點，§3.1.3）。
 *
 * **跨公司存取一律回這一筆**，與「這個 id 根本不存在」逐字相同（§3.2）：兩者一旦可區分，
 * 攻擊者拿 id 枚舉就能探測出別家公司有哪些部門存在。實作上不是「記得回同一句」，而是查詢
 * 一律帶 `company_id`（§4.2），於是兩條路徑走的是同一行程式碼。
 */
export const departmentNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DepartmentErrorCode.NotFound,
  msg: DepartmentErrorCode.NotFound,
  data: { field: 'id' },
})

/**
 * 候選上層部門不存在——含「根本沒有這個 id」與「這個 id 存在但屬於別家公司」兩種情況，
 * **兩者回同一筆**（§3.2），因為 `findDepartmentDetail` 已經把公司範圍寫進查詢的 `WHERE`，
 * 兩條路徑走的是同一行程式碼；也含「這個 id 曾經存在但已被軟刪除」——軟刪除的部門不得被選為
 * 新部門的上層（§4.3：軟刪除表的預設查詢一律排除已刪除的列）。
 *
 * `create`／`update` 共用；`field` 固定為 `parentId`，是這兩支端點唯一會用到候選上層的欄位名。
 */
export const departmentParentNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DepartmentErrorCode.ParentNotFound,
  msg: DepartmentErrorCode.ParentNotFound,
  data: { field: 'parentId' },
})

/**
 * 規則 1：不得成環。涵蓋「把自己設成自己的上層」與「把上層改成自己的某個子孫」兩種情況——
 * 兩者是同一條規則的 degenerate case，`domain/department-tree.ts` 的 `wouldCreateCycle`
 * 用同一個判法算出來，這裡也只需要一個錯誤碼。
 *
 * 只有 `update` 會產出：`create` 的新部門不可能有子孫，不會撞到這條規則。
 */
export const departmentParentCycle = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DepartmentErrorCode.ParentCycle,
  msg: DepartmentErrorCode.ParentCycle,
  data: { field: 'parentId' },
})

/**
 * 規則 3（本輪只做這一半，見 `impl/departments-main.delete.service.ts` 檔頭）：有子部門不得刪除。
 *
 * 分組是 `Unprocessable` 而不是 `Conflict`：這不是併發衝突（不是「兩個人同時操作」），
 * 是這筆資料**當下的狀態**本來就不允許這個操作——與「零工作時段」（`shifts.main.errors.
 * work-periods-empty`）同一類，不是與「資料已被別人改過」同一類。
 */
export const departmentHasChildren = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DepartmentErrorCode.HasChildren,
  msg: DepartmentErrorCode.HasChildren,
  data: { field: 'id' },
})

/**
 * 條件式 UPDATE／軟刪除影響 0 列（§4.4）：在讀取與寫入之間，別人已經改過（或刪掉）這筆資料。
 *
 * 與 {@link departmentNotFound} 分成兩個碼，是因為使用者的處置不同：一個是重新載入清單就好，
 * 一個是資料真的沒了（§3.1.3）。混用會讓前端只能一律叫使用者重新整理。
 */
export const departmentStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: DepartmentErrorCode.StateChanged,
  msg: DepartmentErrorCode.StateChanged,
  data: { field: 'id' },
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 * （`http/error-boundary.ts`：出現任一 `Conflict` → 409，其餘 → 422），業務程式碼一行都不會讀它。
 */
export type DepartmentErrorDeclaration = {
  readonly code: DepartmentErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`，其餘代碼不會帶 `errors`。 */
  readonly webFlowCode: '300'
}

const conflict = (code: DepartmentErrorCodeValue): DepartmentErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: DepartmentErrorCodeValue): DepartmentErrorDeclaration => ({
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
export const DEPARTMENT_ENDPOINT_ERRORS = {
  /** 不分頁的樹狀查詢（§1.4 的例外，見 routes 檔）：查無資料回空陣列，不是錯誤（§3.1.3）。 */
  tree: [],
  /** 查詢類：查無資料回 `data: null`，不是錯誤（§3.1.3）。跨公司存取同樣回 `null`（§3.2）。 */
  get: [],
  create: [conflict(DepartmentErrorCode.CodeDuplicated), unprocessable(DepartmentErrorCode.ParentNotFound)],
  update: [
    unprocessable(DepartmentErrorCode.NotFound),
    conflict(DepartmentErrorCode.CodeDuplicated),
    unprocessable(DepartmentErrorCode.ParentNotFound),
    unprocessable(DepartmentErrorCode.ParentCycle),
  ],
  delete: [
    unprocessable(DepartmentErrorCode.NotFound),
    unprocessable(DepartmentErrorCode.HasChildren),
    conflict(DepartmentErrorCode.StateChanged),
  ],
} as const satisfies Record<string, readonly DepartmentErrorDeclaration[]>

/**
 * 把宣告清單轉成 OpenAPI 的 `description` 文字。
 *
 * 清單必須進契約（§1.8.3），而 Elysia 的 `detail` 只吃標準 OpenAPI 欄位；塞進 `description`
 * 是目前唯一不需要自訂擴充欄位就能讓前端看到這份清單的位置。
 */
export const describeDepartmentErrors = (declarations: readonly DepartmentErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
