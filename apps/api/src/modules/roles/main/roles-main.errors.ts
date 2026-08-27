/**
 * 角色主檔的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * 本檔刻意把「所有可能的業務拒絕」放在同一頁：§3.2 要求某些錯誤**必須刻意含糊**
 * （跨公司存取必須與「目標不存在」逐字相同），而那件事只有把全部錯誤並排看才檢查得出來
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
 * 領域一律用單數的 `role`，而不是路徑上的 `roles`：錯誤碼的領域與路徑段名是兩套獨立的命名空間
 * （§1.3）。寫成 `roles.` 會讓錯誤碼看起來像權限碼／`cmd`（那兩者才等於路徑），
 * 而它們的比對規則完全不同——混淆之後，log 上用同一個字串搜尋會撈到兩種不相干的東西。
 */
export const RoleErrorCode = {
  CodeDuplicated: 'role.code-duplicated',
  NotFound: 'role.not-found',
  PermissionNotFound: 'role.permission-not-found',
  PermissionNotAssignable: 'role.permission-not-assignable',
  SystemRoleProtected: 'role.system-role-protected',
  InUse: 'role.in-use',
  LastAdminRole: 'role.last-admin-role',
  StateChanged: 'role.state-changed',
} as const satisfies Record<string, ErrorCode>

export type RoleErrorCodeValue = (typeof RoleErrorCode)[keyof typeof RoleErrorCode]

/**
 * `errors[].data.field` 的 dot-path（§1.3）。
 *
 * **索引一定要帶進來**：角色設定畫面的權限是一整排勾選框，只回 `field: "permissionIds"`
 * 前端無法回答「是第幾個權限出問題」，只能退化成一句全域提示，使用者得自己逐項比對。
 */
const permissionIdField = (index: number): string => `permissionIds.${index}`

/**
 * 角色代碼重複。
 *
 * 分組是 `Conflict`（→ 409）而不是 `Unprocessable`：這不是「這個值格式不對」，
 * 而是「這個值與另一筆既有資料撞了」，前端的處置是請使用者換一個代碼，不是重填整張表。
 *
 * §3.2：訊息**只說無法建立，不回聲是哪一筆既有角色與它重複**——回聲等於讓任何人用建立表單
 * 反查公司內已存在哪些角色代碼。這是規格不是疏漏，請勿「修好」。
 */
export const roleCodeDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleErrorCode.CodeDuplicated,
  msg: RoleErrorCode.CodeDuplicated,
  data: { field: 'code' },
})

/**
 * 目標角色不存在（動作類端點，§3.1.3）。
 *
 * **跨公司存取一律回這一筆**，與「這個 id 根本不存在」逐字相同（§3.2）：兩者一旦可區分，
 * 攻擊者拿 id 枚舉就能探測出別家公司有哪些角色存在。實作上不是「記得回同一句」，
 * 而是查詢一律帶 `company_id`（§4.2），於是兩條路徑走的是同一行程式碼。
 */
export const roleNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleErrorCode.NotFound,
  msg: RoleErrorCode.NotFound,
  data: { field: 'id' },
})

/** 選取的權限不存在（或已被刪除）。逐筆檢查、逐筆累積，`field` 帶索引。 */
export const permissionNotFound = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleErrorCode.PermissionNotFound,
  msg: RoleErrorCode.PermissionNotFound,
  data: { field: permissionIdField(index) },
})

/**
 * 選取的權限存在但不可指派：權限樹的分類節點（`is_assignable = false`），或已停用的權限。
 *
 * 與「不存在」分成兩個碼，是因為使用者的處置不同：不存在代表畫面上的權限樹過期了、該重新載入；
 * 不可指派代表他勾到了一個只是標題的節點，應該改勾底下的實際權限。
 */
export const permissionNotAssignable = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleErrorCode.PermissionNotAssignable,
  msg: RoleErrorCode.PermissionNotAssignable,
  data: { field: permissionIdField(index) },
})

/**
 * 系統預設角色受保護：不得修改、不得刪除（`roles.is_system`）。
 *
 * UI 不顯示「系統預設／自訂」的分類（`docs/ui/07-ui-role-permission.md`），因此這個碼是
 * 使用者唯一會知道「這個角色動不得」的管道，訊息必須說得出原因。
 */
export const systemRoleProtected = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleErrorCode.SystemRoleProtected,
  msg: RoleErrorCode.SystemRoleProtected,
  data: { field: 'id' },
})

/**
 * 角色仍被公司成員使用，必須先移轉。
 *
 * `assignedUserCount` 進 `data` 是安全的：它只是本公司自己的統計，不揭露任何人的身分
 * （§5.1 禁止把敏感值放進 `errors[].data`）。帶著這個數字，前端才能把訊息寫成
 * 「仍有 3 位成員使用此角色」而不是一句沒有下一步的「無法刪除」。
 *
 * **同一個數字也進 `params`，那是給後端自己的訊息插值用的**（`shared/i18n/`）：`data` 是回給前端的
 * 定位資訊，`params` 是造句用的輸入，兩者的去向不同（`params` 不會出現在 JSON 回應裡）。
 * 這一則是本檔唯一帶插值的錯誤，因此也是唯一在型別上被要求填 `params` 的
 * ——少填是編譯錯誤，不是一句留著 `{{assignedUserCount}}` 的訊息。
 */
export const roleInUse = (assignedUserCount: number): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleErrorCode.InUse,
  msg: RoleErrorCode.InUse,
  params: { assignedUserCount },
  data: { field: 'id', assignedUserCount },
})

/**
 * 公司最後一個具管理能力的角色，不得刪除或停用。
 *
 * 沒有這道防線的話，公司可以把自己鎖在門外：最後一個能改權限的角色一旦消失，
 * 就再也沒有人能把權限加回來，只能靠人工進資料庫救——而那是一條沒有稽核、沒有防呆的路徑。
 */
export const lastAdminRole = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleErrorCode.LastAdminRole,
  msg: RoleErrorCode.LastAdminRole,
  data: { field: 'id' },
})

/**
 * 條件式 UPDATE 影響 0 列（§4.4）：在讀取與寫入之間，別人已經改過這筆資料。
 *
 * 與 {@link roleNotFound} 分成兩個碼，是因為使用者的處置不同：一個是重新載入清單就好，
 * 一個是資料真的沒了（§3.1.3）。混用會讓前端只能一律叫使用者重新整理。
 */
export const roleStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleErrorCode.StateChanged,
  msg: RoleErrorCode.StateChanged,
  data: { field: 'id' },
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 * （`http/error-boundary.ts`：出現任一 `Conflict` → 409，其餘 → 422），業務程式碼一行都不會讀它。
 * 之所以仍然寫出來，是因為 §1.8.3 要求「每個錯誤碼在宣告時必須同時標明它對應的 HTTP status ＋
 * envelope `code`，且一個錯誤碼只能對應一種」——而那份資訊要進 OpenAPI 給前端看。
 * 由 `group` 唯一決定，因此不可能與實際回應不一致。
 */
export type RoleErrorDeclaration = {
  readonly code: RoleErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`，其餘代碼不會帶 `errors`。 */
  readonly webFlowCode: '300'
}

const conflict = (code: RoleErrorCodeValue): RoleErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: RoleErrorCodeValue): RoleErrorDeclaration => ({
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
export const ROLE_ENDPOINT_ERRORS = {
  /** 查詢類：查無資料回空清單，不是錯誤（§3.1.3）。 */
  list: [],
  /** 查詢類：查無資料回 `data: null`，不是錯誤（§3.1.3）。跨公司存取同樣回 `null`（§3.2）。 */
  get: [],
  create: [
    conflict(RoleErrorCode.CodeDuplicated),
    unprocessable(RoleErrorCode.PermissionNotFound),
    unprocessable(RoleErrorCode.PermissionNotAssignable),
  ],
  update: [
    unprocessable(RoleErrorCode.NotFound),
    unprocessable(RoleErrorCode.PermissionNotFound),
    unprocessable(RoleErrorCode.PermissionNotAssignable),
    conflict(RoleErrorCode.SystemRoleProtected),
  ],
  delete: [
    unprocessable(RoleErrorCode.NotFound),
    conflict(RoleErrorCode.InUse),
    conflict(RoleErrorCode.LastAdminRole),
    conflict(RoleErrorCode.SystemRoleProtected),
    conflict(RoleErrorCode.StateChanged),
  ],
  activate: [unprocessable(RoleErrorCode.NotFound), conflict(RoleErrorCode.StateChanged)],
  deactivate: [
    unprocessable(RoleErrorCode.NotFound),
    conflict(RoleErrorCode.LastAdminRole),
    conflict(RoleErrorCode.StateChanged),
  ],
} as const satisfies Record<string, readonly RoleErrorDeclaration[]>

/**
 * 把宣告清單轉成 OpenAPI 的 `description` 文字。
 *
 * 清單必須進契約（§1.8.3），而 Elysia 的 `detail` 只吃標準 OpenAPI 欄位；塞進 `description`
 * 是目前唯一不需要自訂擴充欄位就能讓前端看到這份清單的位置。
 */
export const describeRoleErrors = (declarations: readonly RoleErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
