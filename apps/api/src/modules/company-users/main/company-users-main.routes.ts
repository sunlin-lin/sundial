/**
 * `company-users/main` 的端點目錄（§0.4「routes 不拆」、§1.9）。目前只有一支：重設密碼
 * （UI 定案 `docs/ui/20-employee-list.md` §3.5「管理者直接輸入員工的新密碼」）。
 *
 * **端點自己不宣告認證方式**（§1.9.1）：本 plugin 由 `app/routes.ts` 掛進「已登入群組」，
 * 認證是群組的屬性。權限碼也不在這裡寫，它由路徑機械推導（§5.2.2）。
 *
 * `companyId` 不在 body 裡（§1.1）：公司範圍一律由已驗證的 token 決定。
 */
import { Elysia, t } from 'elysia'
import { requestContext, type RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, Uuid } from '../../../shared/field-schemas.ts'
import { COMPANY_USERS_MAIN_RESET_PASSWORD_ERROR_CODES } from './company-users-main.errors.ts'
import { resetPasswordHandler, type CompanyUsersMainDependencies } from './company-users-main.handler.ts'

/**
 * 新密碼。長度上限與下限對齊 `employees/onboarding` 的 `InitialPassword`（該檔頭：密碼複雜度
 * 尚未定案，見 `docs/schema/01-company-access-organization.md`「密碼欄位、複雜度…仍待逐欄／
 * 逐項確認」，§9 之外的另一項待拍板，這裡不自創一套規則）。
 */
const NewPassword = t.String({ minLength: 8, maxLength: 128 })

const PasswordResetData = t.Object({ companyUserId: Uuid })

/** 業務錯誤的回應形狀。409 與 422 在 envelope 上都是 `code='300'`，差別只在錯誤分組（§1.3）。 */
const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

/**
 * 每支端點都可能出現的非業務回應（比照 `company-users/roles`／`employees-main.routes.ts`）。
 * §2 要求 `response` 涵蓋該端點可能回的每一種狀態碼。
 */
const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/**
 * 取出本次請求的已驗證身分。走到 `null` 代表組裝錯誤（這支端點沒有落在已登入群組內，§1.9.2），
 * 因此拋例外而不是回一個業務錯誤（§3.1.2）。
 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('端點取不到已驗證身分：這支端點沒有落在已登入群組內，路由組裝有誤')
  }
  return session.identity
}

const describeErrorCodes = (codes: readonly string[]): string =>
  codes.length === 0 ? '本端點不會吐出任何業務錯誤碼。' : `可能的業務錯誤碼：${codes.join('、')}`

export const companyUsersMainRoutes = (dependencies: CompanyUsersMainDependencies) =>
  new Elysia({ name: 'company-users-main-routes' }).use(requestContext).post(
    '/company-users/main/reset-password',
    async ({ body, requestContext: context, set }) => {
      const outcome = await resetPasswordHandler(dependencies, requireIdentity(context.session), {
        companyUserId: body.companyUserId,
        newPassword: body.newPassword,
      })
      // 只設定 status，不碰回應本體：`code`／`errors` 由邊界層的錯誤映射一起決定（§1.8.1）。
      set.status = outcome.status
      return outcome.body
    },
    {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('company-users.main.reset-password'),
        companyUserId: Uuid,
        newPassword: NewPassword,
      }),
      response: {
        200: envelope(PasswordResetData),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '管理者重設公司成員的登入密碼',
        description: `${describeErrorCodes(COMPANY_USERS_MAIN_RESET_PASSWORD_ERROR_CODES)} 不寄送 Email、簡訊或系統通知（UI 定案 \`docs/ui/20-employee-list.md\` §3.5）；重設後 \`must_change_password\` 一律為 true；密碼與密碼雜湊不進稽核內容，只記「重設了」這件事。`,
      },
    },
  )
