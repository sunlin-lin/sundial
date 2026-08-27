/**
 * `company-users/roles` 的端點目錄（§0.4：routes 不拆）。
 *
 * 三支端點、各自收什麼 body、回什麼 `data`，一頁看完。**端點自己不宣告認證方式**（§1.9.1）：
 * 本 plugin 由 `app/routes.ts` 掛進「已登入群組」，認證是群組的屬性。權限碼也不在這裡寫，
 * 它由路徑機械推導（§5.2.2）——手寫的權限碼會與路徑漂移，而且不會有任何地方變紅。
 *
 * `companyId` **不在任何一支的 body 裡**（§1.1）：公司範圍一律由已驗證的 token 決定，
 * 一旦它來自客戶端，任何人改一個字串就能操作別家公司的帳號。
 */
import { Elysia, t } from 'elysia'
import { requestContext, type RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  Nullable,
  PageRequest,
  paginationResponse,
  sortRequest,
  TaipeiDateTime,
  Uuid,
} from '../../../shared/field-schemas.ts'
import { ASSIGNMENT_SORT_FIELDS } from './domain/role-assignment-sort.ts'
import {
  COMPANY_USERS_ROLES_CREATE_ERROR_CODES,
  COMPANY_USERS_ROLES_LIST_ERROR_CODES,
  COMPANY_USERS_ROLES_REVOKE_ERROR_CODES,
} from './company-users-roles.errors.ts'
import {
  createRoleAssignmentsHandler,
  listRoleAssignmentsHandler,
  revokeRoleAssignmentsHandler,
  type CompanyUsersRolesDependencies,
} from './company-users-roles.handler.ts'

/**
 * 一次能處理的角色數上限。
 *
 * 沒有上限的話，一個帶著五萬個 id 的請求就能讓交易鎖住成員列數十秒，
 * 而這條路徑上每個請求都要等那把鎖。50 遠大於任何實際的角色數（一家公司的角色是個位數到數十個）。
 */
const MAX_ROLE_IDS = 50

/**
 * 清單的搜尋條件。
 *
 * 同一個 schema 同時用於 request（展開進 body）與 response 的回聲（§1.4），
 * 兩者因此不可能漂移。分成兩份寫的時候，回聲會在某次加篩選條件後靜靜少一欄，
 * 而前端的 race condition 防護（比對「這包回應是不是我現在畫面上這組條件的結果」）跟著失效。
 */
const ListSearch = t.Object({
  companyUserId: t.Optional(Uuid),
  roleId: t.Optional(Uuid),
  /** 帶預設值而不是選填：撤銷紀錄預設不顯示，但「有沒有帶這個條件」不該讓回聲的形狀改變。 */
  includeRevoked: t.Boolean({ default: false }),
})

const ListItem = t.Object({
  id: Uuid,
  companyUserId: Uuid,
  roleId: Uuid,
  roleCode: t.String(),
  roleName: t.String(),
  assignedAt: TaipeiDateTime,
  /**
   * 指派者。**目前是登入帳號名稱，不是員工姓名**——`employees` 表尚未建立。
   * 該表落地後，這一欄要改成員工姓名，並補上 `employeeNo`／`employeeName`
   * （在 response 新增欄位是相容變更，§1.6）。
   */
  assignedByName: t.String(),
  /** 仍然有效的指派為 `null`。 */
  revokedAt: Nullable(TaipeiDateTime),
  revokedByName: Nullable(t.String()),
})

const ListData = paginationResponse(ListSearch, ListItem)

const AssignedRole = t.Object({
  assignmentId: Uuid,
  roleId: Uuid,
  roleCode: t.String(),
  roleName: t.String(),
  assignedAt: TaipeiDateTime,
})

/** 狀態變更端點一律回變更後的完整資源，讓前端不必再打一次查詢端點（§1.2）。 */
const SnapshotData = t.Object({
  companyUserId: Uuid,
  roles: t.Array(AssignedRole),
})

/**
 * `roleIds` 用 `uniqueItems` 擋掉重複。
 *
 * 重複的 id 送進來是呼叫端沒照契約（同一個角色不可能指派兩次），屬開發期問題；
 * 在 schema 擋掉，service 就不必為它另外編一個對使用者沒有意義的錯誤訊息。
 * （domain 仍有第二道判斷，因為漏掉的後果是唯一鍵違反造成的 500，而不是一句看得懂的話。）
 */
const RoleIds = t.Array(Uuid, { minItems: 1, maxItems: MAX_ROLE_IDS, uniqueItems: true })

/** 業務錯誤的回應形狀。409 與 422 在 envelope 上都是 `code='300'`，差別只在錯誤分組（§1.3）。 */
const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

/** 每支端點都可能因 body schema 不符而回 422／`300`（§1.8.0 的③），因此一律宣告。 */
const ValidationFailureResponse = { 422: envelope(t.Null()) } as const

/**
 * 取出本次請求的已驗證身分。
 *
 * 走到 `null` 代表這支端點沒有落在掛著身分驗證 middleware 的群組裡（§1.9.2），
 * 那是**組裝錯誤而不是業務拒絕**：這裡拋例外讓它走系統錯誤路徑（§3.1.2）並進告警，
 * 因為另一種寫法（當成「沒有公司範圍」繼續查下去）會安靜地變成一個跨公司的資料外洩。
 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('端點取不到已驗證身分：這支端點沒有落在已登入群組內，路由組裝有誤')
  }
  return session.identity
}

/** 把錯誤碼清單帶進 OpenAPI 說明（§1.8.3：沒有業務錯誤的端點也必須明確宣告空清單）。 */
const describeErrorCodes = (codes: readonly string[]): string =>
  codes.length === 0 ? '本端點不會吐出任何業務錯誤碼。' : `可能的業務錯誤碼：${codes.join('、')}`

export const companyUsersRolesRoutes = (dependencies: CompanyUsersRolesDependencies) =>
  new Elysia({ name: 'company-users-roles-routes' })
    .use(requestContext)
    .post(
      '/company-users/roles/list',
      ({ body, requestContext: context }) =>
        listRoleAssignmentsHandler(dependencies, requireIdentity(context.session), body),
      {
        body: t.Object({
          ...BaseRequest,
          // `cmd` 收窄成本端點的字面值：值由路徑機械推導（§1.3），不得手寫成別的字串。
          cmd: t.Literal('company-users.roles.list'),
          ...ListSearch.properties,
          ...PageRequest,
          sort: t.Optional(sortRequest(ASSIGNMENT_SORT_FIELDS)),
        }),
        response: {
          200: envelope(ListData),
          ...ValidationFailureResponse,
        },
        detail: {
          summary: '查詢成員角色指派紀錄',
          description: describeErrorCodes(COMPANY_USERS_ROLES_LIST_ERROR_CODES),
        },
      },
    )
    .post(
      '/company-users/roles/create',
      async ({ body, requestContext: context, set }) => {
        const outcome = await createRoleAssignmentsHandler(dependencies, requireIdentity(context.session), body)
        // 只設定 status，不碰回應本體：`code`／`errors` 由邊界層的錯誤映射一起決定（§1.8.1），
        // 事後單獨改其中一個，三者就會脫鉤成前端無法處置的組合。
        set.status = outcome.status
        return outcome.body
      },
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('company-users.roles.create'),
          companyUserId: Uuid,
          roleIds: RoleIds,
        }),
        response: {
          200: envelope(SnapshotData),
          ...BusinessFailureResponses,
        },
        detail: {
          summary: '指派角色給公司成員',
          description: describeErrorCodes(COMPANY_USERS_ROLES_CREATE_ERROR_CODES),
        },
      },
    )
    .post(
      '/company-users/roles/revoke',
      async ({ body, requestContext: context, set }) => {
        const outcome = await revokeRoleAssignmentsHandler(dependencies, requireIdentity(context.session), body)
        set.status = outcome.status
        return outcome.body
      },
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('company-users.roles.revoke'),
          companyUserId: Uuid,
          roleIds: RoleIds,
        }),
        response: {
          200: envelope(SnapshotData),
          ...BusinessFailureResponses,
        },
        detail: {
          summary: '撤銷公司成員的角色',
          description: describeErrorCodes(COMPANY_USERS_ROLES_REVOKE_ERROR_CODES),
        },
      },
    )
