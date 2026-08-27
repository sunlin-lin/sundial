/**
 * `permissions/main` 的端點目錄（§0.4：routes 不拆）。
 *
 * 打開這一個檔案就能看完：這個次實體對外開了哪些口、各自收什麼 body、回什麼 `data`。
 * **端點自己不宣告任何認證方式**（§1.9.1）——本 plugin 由 `app/routes.ts` 掛進「已登入群組」，
 * 認證是群組的屬性；寫在每支端點上就是把同一件事抄 N 遍，而漏抄的那一支只是靜靜地變成不驗證身分。
 *
 * 權限碼同樣不在這裡宣告：它由路徑機械推導（§5.2.2），身分驗證 middleware 自己算得出來。
 */
import { Elysia, t } from 'elysia'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, Nullable, Uuid } from '../../../shared/field-schemas.ts'
import { treePermissionsHandler, type PermissionsMainDependencies } from './permissions-main.handler.ts'
import { PERMISSIONS_MAIN_TREE_ERROR_CODES } from './permissions-main.errors.ts'

/**
 * 權限樹節點。
 *
 * 用 `t.Recursive` 而不是把層數展開成固定的兩、三層：權限樹的深度由 seed 資料決定
 * （目前是「大目錄／次目錄／端點」三層），寫死層數之後，多加一層就是一次破壞性的契約變更，
 * 而且前端會先拿到一個少一層的型別、卻收到多一層的資料。
 */
const PermissionNodeSchema = t.Recursive(
  (self) =>
    t.Object({
      id: Uuid,
      code: t.String(),
      name: t.String(),
      description: Nullable(t.String()),
      isAssignable: t.Boolean(),
      sortOrder: t.Integer(),
      children: t.Array(self),
    }),
  { $id: 'PermissionNode' },
)

const PermissionTreeData = t.Object({ nodes: t.Array(PermissionNodeSchema) })

/** 沒有業務錯誤時仍要寫出清單（§1.8.3），這裡把它帶進 OpenAPI 的說明文字，讓前端看得到「確實是空的」。 */
const describeErrorCodes = (codes: readonly string[]): string =>
  codes.length === 0 ? '本端點不會吐出任何業務錯誤碼。' : `可能的業務錯誤碼：${codes.join('、')}`

export const permissionsMainRoutes = (dependencies: PermissionsMainDependencies) =>
  new Elysia({ name: 'permissions-main-routes' }).post(
    '/permissions/main/tree',
    () => treePermissionsHandler(dependencies),
    {
      body: t.Object({
        ...BaseRequest,
        // `cmd` 收窄成本端點的字面值：值由路徑機械推導（§1.3），不得手寫成別的字串。
        cmd: t.Literal('permissions.main.tree'),
      }),
      response: {
        200: envelope(PermissionTreeData),
        // schema 驗證不符會走統一 error handler 的 `VALIDATION` 分支（422／`300`）；
        // 宣告出來前端才知道這個 status 也是這包信封的形狀，而不是另一種東西。
        422: envelope(t.Null()),
      },
      detail: {
        summary: '取得角色設定用的權限樹',
        description: describeErrorCodes(PERMISSIONS_MAIN_TREE_ERROR_CODES),
      },
    },
  )
