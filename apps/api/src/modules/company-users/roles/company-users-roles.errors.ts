/**
 * `company-users/roles` 的錯誤字典（§0.4：errors 不拆）。
 *
 * 集中在一個檔案，是為了讓「哪些錯誤必須刻意含糊」（§3.2）能一起看——那正是最需要並排比對、
 * 最不能只看單筆的東西。本檔最關鍵的一條是 {@link companyUserNotFound}：**它是「查無此成員」
 * 與「這位成員屬於別家公司」共用的唯一出口**，兩者一旦可區分，攻擊者拿 id 枚舉就能探測出
 * 別家公司有哪些成員存在，而每一次探測在系統看來都只是一個正常請求。
 *
 * **錯誤碼由模組路徑機械推導**：`<大目錄>.<次目錄>.<類別>.<訊息名>`，本次目錄是
 * `modules/company-users/roles/`，因此一律 `company-users.roles.errors.*`
 * ——前兩段就是目錄，不是另外取的領域名（完整規則與它推翻了什麼，見 `sessions-main.errors.ts`）。
 *
 * 這批碼曾經以 `role-assignment` 為領域，理由是「角色指派」這個語意日後也會被新增員工
 * （一次建立帳號＋角色）那條流程用到。**代價換過來了**：那支端點日後要用自己的碼，
 * 於是同一句文案會在兩個語系檔各寫一次；換來的是這裡不必再判斷「這個語意該叫什麼」。
 *
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2）：本檔決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定。字面中文在 `shared/i18n/locales/`（查詢入口是 `shared/i18n/messages.ts`）——因此下面
 * 「必須刻意含糊」的說明（§3.2），要連著那一頁一起看：規格在這裡，字在那裡。
 */
import { ErrorGroup, type DomainError, type ErrorCode } from '../../../shared/service-result.ts'

/**
 * 本次目錄的錯誤碼。
 *
 * 每一個碼**只對應一種分組**（§1.8.3）：同一個碼有時 409、有時 422 的話，
 * 前端就無法只憑碼決定要「就地標欄位」還是「請使用者重新載入」，只能兩種都寫。
 *
 * `satisfies Record<string, ErrorCode>` 把每一個碼釘在集中聯集（`shared/i18n/messages.ts`）上：
 * 新增一個碼卻忘了寫訊息時，**這一行當場編譯不過**，而不是等到執行期回一句查不到的訊息。
 */
export const RoleAssignmentErrorCode = {
  /** 422。查無此公司成員——**包含「屬於其他公司」**（§3.2）。 */
  CompanyUserNotFound: 'company-users.roles.errors.company-user-not-found',
  /** 422。成員帳號已停用，不得再授予角色。 */
  CompanyUserInactive: 'company-users.roles.errors.company-user-inactive',
  /** 422。查無此角色——**包含「屬於其他公司」與「已軟刪除」**（§3.2、§4.3）。 */
  RoleNotFound: 'company-users.roles.errors.role-not-found',
  /** 422。角色已停用，停用後不可再授予（UI §右側角色資料）。 */
  RoleInactive: 'company-users.roles.errors.role-inactive',
  /** 409。這位成員已經有這個角色的有效指派。 */
  AlreadyAssigned: 'company-users.roles.errors.already-assigned',
  /** 422。要撤銷的指派不存在或已被撤銷。 */
  NotFound: 'company-users.roles.errors.not-found',
  /** 409。撤銷後成員會一個有效角色都不剩（UI §3.5「系統禁止移除最後一個角色」）。 */
  LastRoleRequired: 'company-users.roles.errors.last-role-required',
  /** 409。條件式 UPDATE 影響 0 列，代表在本次交易之外已有人改過同一批指派（§4.4）。 */
  StateChanged: 'company-users.roles.errors.state-changed',
} as const satisfies Record<string, ErrorCode>

/**
 * 查無此公司成員。
 *
 * **不要「修好」這個訊息。** 它刻意不區分「這個 id 不存在」與「這個成員屬於別家公司」：
 * 兩者走的是同一行程式碼（repository 把 `company_id` 寫進 `WHERE`，別家公司的資料在查詢階段
 * 就等同於不存在，§4.2），因此想寫出不一致的回應都寫不出來。
 */
export const companyUserNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleAssignmentErrorCode.CompanyUserNotFound,
  msg: RoleAssignmentErrorCode.CompanyUserNotFound,
  data: { field: 'companyUserId' },
})

export const companyUserInactive = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleAssignmentErrorCode.CompanyUserInactive,
  msg: RoleAssignmentErrorCode.CompanyUserInactive,
  data: { field: 'companyUserId' },
})

/**
 * 查無此角色，理由同 {@link companyUserNotFound}：別家公司的角色與不存在的角色回應必須逐項相同。
 *
 * @param index 這筆錯誤對應 `roleIds` 陣列的第幾個元素，0 起算。
 *   **索引一定要從迴圈變數帶進來**（§1.3）：漏帶不會有任何錯誤，只是前端從此定位不到是哪一列，
 *   使用者面對一排角色只被告知「有角色不存在」，得自己逐個比對。
 */
export const roleNotFound = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleAssignmentErrorCode.RoleNotFound,
  msg: RoleAssignmentErrorCode.RoleNotFound,
  data: { field: `roleIds.${index}` },
})

export const roleInactive = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleAssignmentErrorCode.RoleInactive,
  msg: RoleAssignmentErrorCode.RoleInactive,
  data: { field: `roleIds.${index}` },
})

export const roleAlreadyAssigned = (index: number): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleAssignmentErrorCode.AlreadyAssigned,
  msg: RoleAssignmentErrorCode.AlreadyAssigned,
  data: { field: `roleIds.${index}` },
})

export const assignmentNotFound = (index: number): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleAssignmentErrorCode.NotFound,
  msg: RoleAssignmentErrorCode.NotFound,
  data: { field: `roleIds.${index}` },
})

/** `field` 指到整個陣列而不是某一格：被拒的是整批操作，沒有哪一筆比別筆更該負責。 */
export const lastRoleRequired = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleAssignmentErrorCode.LastRoleRequired,
  msg: RoleAssignmentErrorCode.LastRoleRequired,
  data: { field: 'roleIds' },
})

export const assignmentStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleAssignmentErrorCode.StateChanged,
  msg: RoleAssignmentErrorCode.StateChanged,
  data: { field: 'roleIds' },
})

/** `POST /company-users/roles/list` 可能吐出的業務錯誤碼（§1.8.3）。查詢類端點沒有業務拒絕（§3.1.3）。 */
export const COMPANY_USERS_ROLES_LIST_ERROR_CODES: readonly ErrorCode[] = []

/** `POST /company-users/roles/create` 可能吐出的業務錯誤碼（§1.8.3）。 */
export const COMPANY_USERS_ROLES_CREATE_ERROR_CODES: readonly ErrorCode[] = [
  RoleAssignmentErrorCode.CompanyUserNotFound,
  RoleAssignmentErrorCode.CompanyUserInactive,
  RoleAssignmentErrorCode.RoleNotFound,
  RoleAssignmentErrorCode.RoleInactive,
  RoleAssignmentErrorCode.AlreadyAssigned,
]

/** `POST /company-users/roles/revoke` 可能吐出的業務錯誤碼（§1.8.3）。 */
export const COMPANY_USERS_ROLES_REVOKE_ERROR_CODES: readonly ErrorCode[] = [
  RoleAssignmentErrorCode.CompanyUserNotFound,
  RoleAssignmentErrorCode.NotFound,
  RoleAssignmentErrorCode.LastRoleRequired,
  RoleAssignmentErrorCode.StateChanged,
]
