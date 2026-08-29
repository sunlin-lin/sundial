/**
 * 權限碼的型別化聯集（前端規範 §4.1：**權限碼是型別化聯集而非字串**）。
 *
 * ## 為什麼要有這一份，而不是直接用 `string`
 *
 * 權限碼在執行期只是字串，打錯一個字母（`regulatory.datasets.overivew`）的後果是
 * **那個判斷永遠回 false**：選單少一項、路由永遠擋下，而且完全不會報錯——
 * 對讀程式的人來說，它與「這個人真的沒有權限」長得一模一樣。收成聯集之後，同一個錯字是編譯錯誤。
 *
 * ## 這一份怎麼維護：手寫清單 ＋ 由產生型別推導的機械檢查
 *
 * 後端**沒有**任何一支端點回得出「全部合法權限碼」當作 OpenAPI schema
 *（`sessions/main/context` 回的 `permissionCodes` 在型別上就是 `string[]`），
 * 所以這份清單只能由前端維護。但它不是全手寫：
 *
 * - 權限碼與端點的 `cmd` **是同一個字串**——兩者都由端點路徑機械推導（`/a/b/c` → `a.b.c`，
 *   後端規範 §1.3 的 `cmd`、§5.2.2 的權限碼，兩條規則各自寫著「由路徑推導、沒有例外分支」）。
 *   因此下面的 `satisfies readonly ApiCommand[]` 把「這個字串是不是一支真實端點的名字」交給
 *   產生型別去判斷：**拼錯字、或後端把端點改名／刪掉，這一行當場編譯不過。**
 * - 剩下**唯一**要靠人核對的是「這支端點的權限碼有沒有被 seed 出來」。這一份的五個值已逐字比對過
 *   `apps/api/drizzle/0014`／`0016`／`0017` 三支 seed migration。
 *
 * ⚠️ **反過來不成立：不是每一支端點都有權限碼。** 公開群組的端點（登入、refresh）沒有權限碼，
 * 而 `ApiCommand` 涵蓋它們。所以這個 `satisfies` 擋的是「不存在的端點」，不是「不存在的權限碼」；
 * 後者由上面那句人工核對負責，規範 §8.2 第 (3) 條的掃描測試（程式碼用到的權限碼必須存在於後端
 * 權限目錄）是它真正的自動化把關，那支掃描不在本檔的守備範圍。
 *
 * ## 只列「這一輪真的有人判斷」的權限碼
 *
 * 後端已 seed 的權限碼遠不只五個。先把它們全部抄進來看起來比較完整，實際上會得到一份
 * **沒有人讀、也沒有辦法知道它對不對**的清單（§1.5 禁止孤兒程式碼）。要判斷第六個權限碼時
 * 再加第六行，那一行的正確性當下就會被使用它的程式碼驗證。
 */
import type { paths } from '../../api/generated/api-types.ts'

/** `a/b/c` → `a.b.c`。遞迴到最後一段時 `TSegments` 已經沒有 `/`，直接回它自己。 */
type DottedPath<TSegments extends string> = TSegments extends `${infer Head}/${infer Rest}`
  ? `${Head}.${DottedPath<Rest>}`
  : TSegments

/** `/a/b/c` → `a.b.c`。開頭沒有 `/` 的字串不是端點路徑，回 `never`（用它會編譯錯誤）。 */
type EndpointCommand<TPath extends string> = TPath extends `/${infer Rest}` ? DottedPath<Rest> : never

/**
 * 後端每一支端點的指令名，由 `bun run gen:api` 的產生型別推導。
 *
 * 由 `paths` 推導而不是另外列一份：另外列的那一份會在後端加端點時安靜地過期，
 * 而過期的清單與正確的清單在 CI 上長得一模一樣。
 */
type ApiCommand = EndpointCommand<keyof paths & string>

/**
 * 本前端會判斷的權限碼（計畫 03 §6）。
 *
 * 刻意不 export：它的用途只有推導出 {@link PermissionCode}，而一份「可以被別人 map 出來的
 * 權限碼清單」會立刻長出「把全部權限碼列出來給人勾選」這種消費者——那是後端權限目錄端點的事
 *（`permissions.main.list`），不是前端硬編清單的事。
 */
// 這個 const 只在下一行的 `typeof PERMISSION_CODES` 型別查詢中被參照，執行期的值本身
// 確實沒有第二個使用者；這正是「const 陣列 + typeof [number]」推導聯集型別的標準寫法
//（全站另有多處同構寫法，差別只在那些都用 `export const`——匯出後 ESLint 看不到
// 「有沒有第二個使用者」，不會誤判。這裡刻意不匯出，見上方檔頭：避免長出
// 「把全部權限碼列出來」的消費者，因此需要這一行說明，而不是為了過 lint 反過來匯出它）。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PERMISSION_CODES = [
  'regulatory.datasets.overview',
  'regulatory.datasets.list',
  'regulatory.datasets.get',
  'regulatory.datasets.resolve',
  'regulatory.sync.list',
  // 班別設定（計畫 04 §6、§8）。六碼逐一比對過 `apps/api/drizzle/0022_seed_permission_codes_shifts.sql`。
  'shifts.main.list',
  'shifts.main.get',
  'shifts.main.create',
  'shifts.main.update',
  'shifts.main.copy',
  'shifts.main.delete',
  // 員工清單與新增員工（計畫 05 Stage 6 第一段，UI 定案 `docs/ui/20-employee-list.md` §1、§2）。
  // 兩碼逐一比對過 `apps/api/drizzle/0009_seed_permission_codes_employees.sql`（`employees.main.list`）
  // 與 `0027_onboarding_permission_codes.sql`（`employees.onboarding.create`）。
  'employees.main.list',
  'employees.onboarding.create',
  // 修改員工與離職（計畫 05 Stage 6 第二段，UI 定案 `docs/ui/20-employee-list.md` §3.1～§3.4）。
  // `employees.main.get`／`employees.main.update` 逐字比對過 `0009_seed_permission_codes_
  // employees.sql`；`employments.*` 三碼與 `withholding.*` 一碼比對過
  // `0026_seed_permission_codes_employments_withholding.sql`；`employments.department-histories.
  // create` 比對過 `0030_seed_permission_codes_employments_department_histories_create.sql`；
  // `employments.job-title-histories.create`／`employments.job-position-histories.create`
  // 比對過 `0029_seed_permission_codes_job_titles_positions.sql`。
  //
  'employees.main.get',
  'employees.main.update',
  'employments.main.create',
  'employments.main.leave',
  'employments.department-histories.create',
  'employments.job-title-histories.create',
  'employments.job-position-histories.create',
  'withholding.main.create',
  // §3.5 帳號與角色（計畫 05 Stage 6 第三段）：`employees.main.get` 現在回 `companyUserId`，
  // 這三碼因此接上了消費者（`AccountRoleAssignmentSection.vue`／`AccountResetPasswordSection.vue`
  // 分別呼叫 `canAssignRole`／`canRevokeRole`／`canResetPassword`）。逐字比對過
  // `0003_seed_permission_codes_company_users.sql`（`company-users.roles.create`／`.revoke`）、
  // `0031_seed_permission_codes_company_users_main.sql`（`company-users.main.reset-password`）。
  //
  // **`roles.main.list`／`company-users.roles.list` 不在這份清單裡**：兩者都只是清單查詢
  // （可指派角色字典、目前角色指派），與 `employments.main.list`（同檔案已經確立的先例，同樣
  // 不在清單裡）同構——這一輪沒有任何 `can(...)` 呼叫點會判斷這兩碼，兩支端點各自的 `901`
  // 由 `toLoadFailure` 分流處理，不需要前端另外用 `can` 決定要不要發出查詢。
  'company-users.roles.create',
  'company-users.roles.revoke',
  'company-users.main.reset-password',
] as const satisfies readonly ApiCommand[]

/** 權限碼。全站判斷權限一律用這個型別，不用 `string`。 */
export type PermissionCode = (typeof PERMISSION_CODES)[number]
