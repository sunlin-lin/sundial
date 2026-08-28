/**
 * 部門主檔的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自收什麼、回什麼**，因此它只有宣告，
 * 沒有任何函式本體——業務在 service，資料收斂在 handler。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。
 *
 * **權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換（`/departments/main/tree` →
 * `departments.main.tree`），由身分驗證 middleware 自己推導。
 *
 * ---
 *
 * ## `tree` 不分頁——這是刻意偏離 §1.4，必須在這裡寫清楚為什麼
 *
 * §1.4 規定「列表端點一律分頁，禁止無上限查詢」。`tree` 是查詢類端點、路徑上看起來像一支列表，
 * 但它**不分頁**，理由是分頁在這裡沒有意義，不是「忘了加」：
 *
 * - **分頁的前提是「一頁看不完全部，而每一頁自己是完整的一份資料」。** 部門樹不滿足這個前提——
 *   把樹切成兩頁之後，第二頁裡的某個節點，它的父節點可能落在第一頁（甚至可能因為分頁排序的
 *   關係整個不在同一次回應裡），前端拿到第二頁時**組不出正確的樹狀結構**，因為它找不到那個
 *   節點該掛在哪裡。分頁清單假設「第 N 筆」與「第 N+1 筆」互相獨立，樹狀資料的每一筆都依賴
 *   它的祖先，這個假設在這裡不成立。
 * - **部門樹通常不大**（資料字典「定案：樹的四條規則」表格：「排序欄位不做，樹狀按名稱排」
 *   那一列的理由同樣適用於這裡——「排序欄位要維護，而部門樹通常不大」）。一家公司的組織架構
 *   從總部到課級，深度與節點數都是人力可以一頁看完的規模，不會有「查出十萬筆」的情境需要分頁
 *   去保護記憶體與連線池（§1.4 分頁存在的原始理由）。
 *
 * 因此本端點的 `data` 直接是 `DepartmentTreeNode[]`（遞迴形狀），不是 `PaginationResponse` 包裝。
 * UI 定案（`docs/ui/08-ui-organization-structure.md`）本來就是「左側樹狀列表，一次載入整棵樹」，
 * 不是分頁列表——這支端點的形狀是照著畫面需求推出來的，不是自己發明的例外。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, codeField, Nullable, Uuid } from '../../../shared/field-schemas.ts'
import {
  handleDepartmentCreate,
  handleDepartmentDelete,
  handleDepartmentGet,
  handleDepartmentTree,
  handleDepartmentUpdate,
  type DepartmentsMainDependencies,
} from './departments-main.handler.ts'
import { describeDepartmentErrors, DEPARTMENT_ENDPOINT_ERRORS } from './departments-main.errors.ts'

/**
 * 部門代碼。字元格式與長度上限說明見 {@link codeField}——長度對齊
 * `departments.code` 的 `VARCHAR(64)`。
 */
const DepartmentCode = codeField(64)

/** 部門名稱。長度上限對齊 `departments.name` 的 `VARCHAR(128)`。 */
const DepartmentName = t.String({ minLength: 1, maxLength: 128 })

/**
 * 部門說明。**選填**（資料字典「departments」節、UI 定案兩處都標「選填」，與 `shifts.description`
 * 的「必須非空字串」不同，不可照抄那支的 schema）。長度上限對齊 `departments.description` 的
 * `VARCHAR(255)`。
 */
const DepartmentDescription = t.String({ maxLength: 255 })

/**
 * 部門狀態，聯集字面值（§2：固定代碼欄位必須用聯集字面值，不可只寫 `t.String()`）。
 *
 * 值必須與 `db/schema/departments.ts` 的 `DepartmentStatus` 相同。不直接 import 那個常數，
 * 是為了讓路由層不相依資料庫 schema（比照 `shifts-main.routes.ts` 的 `ShiftWorkTypeSchema`）。
 */
const DepartmentStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('INACTIVE')])

/**
 * 上層部門 id。**必填欄位、值可為 `null`**（不是 `t.Optional`）：呼叫端必須明確表達「根部門」
 * 這個意圖（送 `null`），不能靠「沒帶這個欄位」表示同一件事——兩者長得不一樣，`null` 是
 * 一個看得見、可以被質疑的宣告，「沒帶」則容易被誤解成呼叫端忘了填。
 */
const ParentId = Nullable(Uuid)

/** 樹狀節點（遞迴形狀），見本檔頭「`tree` 不分頁」那一段。 */
const DepartmentTreeNodeSchema = t.Recursive((self) =>
  t.Object({
    id: Uuid,
    code: DepartmentCode,
    name: DepartmentName,
    description: Nullable(DepartmentDescription),
    status: DepartmentStatusSchema,
    children: t.Array(self),
  }),
)

const DepartmentDetailSchema = t.Object({
  id: Uuid,
  parentId: ParentId,
  code: DepartmentCode,
  name: DepartmentName,
  description: Nullable(DepartmentDescription),
  status: DepartmentStatusSchema,
  createdAt: t.String(),
  updatedAt: t.String(),
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
 * 部門主檔的端點。
 *
 * @param dependencies 由組裝點注入的資料庫與 clock。**不在模組層建立連線**（§1.7）：
 *   `bun run gen:api` 必須能在資料庫未連線的情況下產出契約，否則新人的第一天就會卡在這裡。
 */
export const departmentsMainRoutes = (dependencies: DepartmentsMainDependencies) =>
  new Elysia({ name: 'departments-main-routes' })
    .use(requestContext)
    .post('/departments/main/tree', (context) => handleDepartmentTree(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('departments.main.tree') }),
      response: {
        200: envelope(t.Array(DepartmentTreeNodeSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢整棵部門樹',
        description: `${describeDepartmentErrors(DEPARTMENT_ENDPOINT_ERRORS.tree)} 不分頁，回傳完整的樹狀結構（見本檔頭說明）。`,
      },
    })
    .post('/departments/main/get', (context) => handleDepartmentGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('departments.main.get'), id: Uuid }),
      response: {
        // 查無資料是 `data: null`，不是 404（§1.3）。別家公司的部門也回這一種（§3.2）。
        200: envelope(Nullable(DepartmentDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單一部門',
        description: describeDepartmentErrors(DEPARTMENT_ENDPOINT_ERRORS.get),
      },
    })
    .post('/departments/main/create', (context) => handleDepartmentCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('departments.main.create'),
        parentId: ParentId,
        code: DepartmentCode,
        name: DepartmentName,
        description: t.Optional(DepartmentDescription),
        // 刻意沒有 status：建立時一律 ACTIVE，由系統帶入，不要求使用者輸入（UI 定案）。
      }),
      response: {
        200: envelope(DepartmentDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增部門（可指定上層）',
        description: describeDepartmentErrors(DEPARTMENT_ENDPOINT_ERRORS.create),
      },
    })
    .post('/departments/main/update', (context) => handleDepartmentUpdate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('departments.main.update'),
        id: Uuid,
        parentId: ParentId,
        code: DepartmentCode,
        name: DepartmentName,
        description: t.Optional(DepartmentDescription),
        status: DepartmentStatusSchema,
        // 啟用／停用走本端點的 status，不另開端點（比照 shifts 的 isActive 處置）：它只是一個
        // 欄位值，另開端點會讓「改狀態」與「改內容」走兩條路，而兩條路的稽核與權限要各自維護。
      }),
      response: {
        200: envelope(DepartmentDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '修改部門（含改上層部門＝搬移子樹，與啟用／停用）',
        description: describeDepartmentErrors(DEPARTMENT_ENDPOINT_ERRORS.update),
      },
    })
    .post('/departments/main/delete', (context) => handleDepartmentDelete(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('departments.main.delete'), id: Uuid }),
      response: {
        // 軟刪除（§4.3）：只回識別碼，刪掉之後沒有「變更後的完整資源」可回。
        200: envelope(t.Object({ id: Uuid })),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '刪除部門（軟刪除；有子部門時拒絕，見本模組的規則 3）',
        description: describeDepartmentErrors(DEPARTMENT_ENDPOINT_ERRORS.delete),
      },
    })
