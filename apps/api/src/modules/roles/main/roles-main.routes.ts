/**
 * 角色主檔的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自收什麼、回什麼**，因此它只有宣告，
 * 沒有任何函式本體——業務在 service，資料收斂在 handler。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * （`app/routes.ts`）把整個 plugin 掛進已登入群組。寫在每支端點上就是把同一件事抄 N 遍，
 * 而漏抄的那一支不會報錯、不會少一個檔案，它只是**變成不驗證身分**。
 *
 * **權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換（`/roles/main/list` →
 * `roles.main.list`），由身分驗證 middleware 自己推導。手寫的碼會在路徑改名時漂移，
 * 而漂移不會有任何地方變紅——結果是那個權限實際上授不出去，或者授到了不該授的東西。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
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
import { ROLE_SORT_FIELDS } from './domain/role-list-view.ts'
import {
  handleRoleActivate,
  handleRoleCreate,
  handleRoleDeactivate,
  handleRoleDelete,
  handleRoleGet,
  handleRoleList,
  handleRoleUpdate,
  type RolesMainDependencies,
} from './roles-main.handler.ts'
import { describeRoleErrors, ROLE_ENDPOINT_ERRORS } from './roles-main.errors.ts'

/**
 * 角色代碼。
 *
 * 限制成英數與 `-`／`_`，是因為這個值同時是**公司內的唯一鍵**與人要輸入、比對、在權限設定畫面上
 * 唸出來的識別字串：允許空白與全形字元之後，「HR」與「H R」「ＨＲ」會是三個不同的角色，
 * 而畫面上看起來幾乎一樣。長度上限對齊 `roles.code` 的 `VARCHAR(64)`。
 *
 * 註：§2 要求共用欄位型別集中在 `shared/field-schemas.ts`，但那是骨架的檔案（本次不得修改），
 * 且目前只有本模組用得到這三個欄位。第二個模組要用時應該升格上去（已寫進交付回報）。
 */
const RoleCode = t.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' })

/** 角色名稱。長度上限對齊 `roles.name` 的 `VARCHAR(128)`。 */
const RoleName = t.String({ minLength: 1, maxLength: 128 })

/** 角色說明。長度上限對齊 `roles.description` 的 `VARCHAR(255)`。 */
const RoleDescription = t.String({ maxLength: 255 })

/** 列表的關鍵字：比對代碼與名稱。上限刻意小於代碼與名稱的長度上限，超過就不可能命中任何資料。 */
const RoleKeyword = t.String({ maxLength: 128 })

/**
 * 角色狀態，聯集字面值（§2：固定代碼欄位必須用聯集字面值，不可只寫 `t.String()`）。
 *
 * 值必須與 `db/schema/roles.ts` 的 `RoleStatus` 相同。**兩邊不一致時會編譯失敗**——
 * handler 收的是 `RoleStatusValue`，這裡多一個或少一個字面值，路由的委派呼叫當場對不上型別。
 * 不直接 import 那個常數，是為了讓路由層不相依資料庫 schema。
 */
const RoleStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('INACTIVE')])

/** 權限 ID 清單。**至少一個**：一個沒有任何權限的角色授出去等於什麼都沒授，卻看起來像有授。 */
const PermissionIds = t.Array(Uuid, { minItems: 1 })

const RoleSummarySchema = t.Object({
  id: Uuid,
  code: RoleCode,
  name: RoleName,
  status: RoleStatusSchema,
  /**
   * 系統預設角色的保護旗標。UI **不以它顯示「預設／自訂」分類**
   * （`docs/ui/07-ui-role-permission.md`），回傳它是為了讓前端能停用「刪除」與「編輯」按鈕
   * ——後端一定會擋（§5.2），前端的停用只是體驗優化。
   */
  isSystem: t.Boolean(),
})

const RoleDetailSchema = t.Object({
  id: Uuid,
  code: RoleCode,
  name: RoleName,
  description: Nullable(RoleDescription),
  status: RoleStatusSchema,
  isSystem: t.Boolean(),
  permissionIds: t.Array(Uuid),
  /** 目前仍有效指派給幾位公司成員。前端據此在刪除前提示「仍有 N 位成員使用」。 */
  assignedUserCount: t.Integer({ minimum: 0 }),
  /** 業務時間，台北牆鐘、不帶時區標記（§6.1）：帶了標記前端會依瀏覽器時區再換算一次。 */
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
})

/** 列表的搜尋條件回聲（§1.4）。使用者沒送的條件就不出現，前端才比對得出這包是不是自己要的。 */
const RoleSearchSchema = t.Object({
  keyword: t.Optional(RoleKeyword),
  status: t.Optional(RoleStatusSchema),
})

/**
 * 每支端點都可能出現的非業務回應。
 *
 * §2 要求 `response` 涵蓋該端點可能回的每一種狀態碼。這三種與業務邏輯無關，由 middleware 與
 * 統一 error handler 產生（`900` 未登入／`901` 無權限／`400` 系統錯誤），`data` 恆為 `null`、
 * `errors` 恆為空陣列（§1.3）。
 */
const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/** 業務錯誤的回應形狀。409 與 422 在 envelope 上都是 `code='300'`，差別只在錯誤分組（§1.3）。 */
const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

/**
 * 角色主檔的端點。
 *
 * @param dependencies 由組裝點注入的資料庫與 clock。**不在模組層建立連線**（§1.7）：
 *   `bun run gen:api` 必須能在資料庫未連線的情況下產出契約，否則新人的第一天就會卡在這裡。
 */
export const rolesMainRoutes = (dependencies: RolesMainDependencies) =>
  new Elysia({ name: 'roles-main-routes' })
    .use(requestContext)
    .post('/roles/main/list', (context) => handleRoleList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('roles.main.list'),
        keyword: t.Optional(RoleKeyword),
        /**
         * 篩選用的狀態。
         *
         * §1.2 禁止 request body 帶 `status` **來完成核准或作廢**——那條防的是「客戶端直接把資料
         * 改成任一目標狀態，跳過該轉移應有的前置檢查」。這裡是查詢條件，不會寫入任何東西；
         * 角色的狀態變更只能走 `/roles/main/activate` 與 `/roles/main/deactivate`。
         */
        status: t.Optional(RoleStatusSchema),
        ...PageRequest,
        sort: t.Optional(sortRequest(ROLE_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(RoleSearchSchema, RoleSummarySchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢角色清單',
        description: describeRoleErrors(ROLE_ENDPOINT_ERRORS.list),
      },
    })
    .post('/roles/main/get', (context) => handleRoleGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('roles.main.get'), id: Uuid }),
      response: {
        // 查無資料是 `data: null`，不是 404（§1.3）。別家公司的角色也回這一種（§3.2）。
        200: envelope(Nullable(RoleDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單一角色',
        description: describeRoleErrors(ROLE_ENDPOINT_ERRORS.get),
      },
    })
    .post('/roles/main/create', (context) => handleRoleCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('roles.main.create'),
        code: RoleCode,
        name: RoleName,
        description: t.Optional(RoleDescription),
        permissionIds: PermissionIds,
      }),
      response: {
        200: envelope(RoleDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增角色',
        description: describeRoleErrors(ROLE_ENDPOINT_ERRORS.create),
      },
    })
    .post('/roles/main/update', (context) => handleRoleUpdate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('roles.main.update'),
        id: Uuid,
        name: RoleName,
        description: t.Optional(RoleDescription),
        permissionIds: PermissionIds,
        // 刻意沒有 `code`：角色代碼建立後不修改，它是權限設定與歷史紀錄辨識角色的依據。
        // 也刻意沒有 `status`：狀態變更只能走狀態動作端點（§1.2）。
      }),
      response: {
        200: envelope(RoleDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '修改角色',
        description: describeRoleErrors(ROLE_ENDPOINT_ERRORS.update),
      },
    })
    .post('/roles/main/delete', (context) => handleRoleDelete(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('roles.main.delete'), id: Uuid }),
      response: {
        // 軟刪除（§4.3）：只回識別碼，刪掉之後沒有「變更後的完整資源」可回。
        200: envelope(t.Object({ id: Uuid })),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '刪除角色（軟刪除）',
        description: describeRoleErrors(ROLE_ENDPOINT_ERRORS.delete),
      },
    })
    .post('/roles/main/activate', (context) => handleRoleActivate(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('roles.main.activate'), id: Uuid }),
      response: {
        // 狀態動作端點必須回**變更後的完整資源**（§1.2），讓前端不必再打一次查詢端點。
        200: envelope(RoleDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '啟用角色',
        description: describeRoleErrors(ROLE_ENDPOINT_ERRORS.activate),
      },
    })
    .post('/roles/main/deactivate', (context) => handleRoleDeactivate(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('roles.main.deactivate'), id: Uuid }),
      response: {
        200: envelope(RoleDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '停用角色',
        description: describeRoleErrors(ROLE_ENDPOINT_ERRORS.deactivate),
      },
    })
