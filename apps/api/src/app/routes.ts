/**
 * 路由組裝點（§1.9）。巢狀順序固定為兩層分組：
 *
 * ```text
 * 入口群組（由 host／domain 決定是哪一個入口，§1.0）
 * └─ 認證群組（這一整組端點共用的驗證方式）
 *    └─ 端點（POST /<大目錄>/<次目錄>/<動作>）
 * ```
 *
 * 目前只有一種入口（Web 前端），因此實際上只有一個入口群組——**但這一層仍然寫出來**，
 * 因為新增入口時加的是一個同層的兄弟群組，而不是把既有群組拆開重排。
 *
 * **本檔是全系統唯一可以 import `modules/<大目錄>/routes.ts` 的檔案**（§0.3）。
 * 那條限制是「`routes.ts` 與 `index.ts` 之所以能分成兩個出口」的執行手段：少了它，
 * `routes.ts` 就只是「另一個 index」，任何模組都能從它把 HTTP 框架撈進來。
 *
 * **本系統的認證群組就是下面這三個，一頁看得完**（§1.9 要求集中的理由）：
 *
 * | 群組 | 憑證來源 | 憑證驗證器 | 續期行為 |
 * |---|---|---|---|
 * | 公開 | **無** | `publicGuard`（明確的「不驗」，不是留空） | 不續期 |
 * | refresh | `sundial_refresh_ticket` cookie | `refreshGuard` | 不續期，改為**發證** |
 * | 已登入 | `Authorization: Bearer` | `identityGuard` | 續期 |
 */
import { Elysia } from 'elysia'
import { identityGuard } from '../http/identity-guard.ts'
import { publicGuard } from '../http/public-guard.ts'
import { refreshGuard } from '../http/refresh-guard.ts'
import { companyUsersRolesRoutes } from '../modules/company-users/routes.ts'
import { employeesMainRoutes } from '../modules/employees/routes.ts'
import { permissionsMainRoutes } from '../modules/permissions/routes.ts'
import { regulatoryDatasetsRoutes, regulatorySyncRoutes } from '../modules/regulatory/routes.ts'
import { rolesMainRoutes } from '../modules/roles/routes.ts'
import {
  sessionsMainAuthenticatedRoutes,
  sessionsMainPublicRoutes,
  sessionsMainRefreshRoutes,
} from '../modules/sessions/routes.ts'
import type { AppDependencies } from './app-dependencies.ts'

/**
 * 把組裝點的相依裁成 `sessions` 模組要的那三樣。
 *
 * **收成一個具名函式而不是在三個群組各寫一次**：`sessions` 的端點分屬三個認證群組（§1.9.1），
 * 抄三次就會出現「其中一組用了不同的 clock」這種對不起來、又完全不會報錯的狀況
 * ——症狀是某一個群組的票在錯誤的時刻過期，而它與「時鐘漂移」長得一模一樣。
 */
const toSessionsContext = (dependencies: AppDependencies) => ({
  db: dependencies.database,
  clock: dependencies.clock,
  session: dependencies.session,
})

/**
 * 公開群組：不需要身分。
 *
 * 公開端點**必須放在這個具名群組內**，不能靠「沒有加驗證」表示公開（§1.9.2）。
 * 兩者長得一樣時，一個沉默的安全漏洞在程式碼上與正常程式碼逐字相同——review 看不出來。
 * 放進具名群組之後，刻意公開是一個看得見、可以在 PR 上被要求說明理由的宣告。
 *
 * 目前只有登入一支。它落在這裡**不是特例**（§1.9.0）：呼叫它的時候使用者手上還沒有憑證，
 * 而「它會發一張新票」是端點自己的業務，不是群組的屬性。
 */
const publicGroup = (dependencies: AppDependencies) =>
  new Elysia({ name: 'public-group' })
    .use(publicGuard)
    .use(sessionsMainPublicRoutes(toSessionsContext(dependencies)))

/**
 * refresh 群組：以 refresh 票（cookie）驗證，驗過**不續期而是發證**。
 *
 * **這個群組刻意只有一支端點**（§5.4.1）：refresh 票只認 `/sessions/main/refresh`，
 * 它出現在其他請求上一律視為錯誤而不是「順便也能用」。一旦它也能當 access token 用，
 * 它就只是一張 30 天壽命的 access token，短命那一半的設計當場失效。
 */
const refreshGroup = (dependencies: AppDependencies) =>
  new Elysia({ name: 'refresh-group' })
    .use(refreshGuard(dependencies.refreshControl))
    .use(sessionsMainRefreshRoutes(toSessionsContext(dependencies)))

/**
 * 已登入群組：以 access token 驗證身分，通過即續期，並依路徑推導的權限碼比對權限。
 *
 * 認證方式寫在群組上、端點自己不宣告（§1.9.1）：認證方式是橫切的，
 * 寫在每支端點上就是把同一件事抄 N 遍，而漏抄的那一支只是靜靜地變成不驗證身分。
 *
 * 掛進來的六組端點各自只是一個 plugin，**它們沒有辦法宣告自己要不要驗身分**——
 * 掛在哪一組是這裡的一行程式碼，掛錯就是掛不上。
 */
const authenticatedGroup = (dependencies: AppDependencies) => {
  const { database, clock, cipher } = dependencies
  return new Elysia({ name: 'authenticated-group' })
    .use(identityGuard(dependencies.accessControl))
    .use(sessionsMainAuthenticatedRoutes(toSessionsContext(dependencies)))
    .use(rolesMainRoutes({ db: database, clock }))
    .use(permissionsMainRoutes({ database }))
    .use(companyUsersRolesRoutes({ database, clock }))
    .use(employeesMainRoutes({ db: database, cipher, clock }))
    // 法規資料集：**刻意不注入 clock**（實作計畫 §4.2）。這三支端點的時間維度只有呼叫端送來的
    // `asOfDate`，拿得到 clock 就寫得出「沒帶就用今天」，而那會讓補算去年 12 月的薪資
    // 抓到今年的費率，算出一個完全合理的數字。也沒有公司範圍——法規三表是平台全域資料。
    .use(regulatoryDatasetsRoutes({ db: database }))
    // 同步歷程：**同樣只注入 `db`**。`sync` 次目錄的另一個動作（`runSync`）需要網路與計時器，
    // 而它們刻意不在這裡——一支 HTTP 查詢不該有能力去打政府端點並寫入版本。人工觸發同步的端點
    // 依計畫 D3 不開放（一家公司的管理者按一個鈕，平台上每一家公司的 Payroll 都跟著換版本）。
    .use(regulatorySyncRoutes({ db: database }))
}

/**
 * Web 前端入口群組。
 *
 * 目前不依 host 分流：只有一種入口時，加上 host 判斷等於憑空多一個部署環境要對齊的設定，
 * 而它擋不掉任何東西。第二種入口出現時，這裡會變成兩個兄弟群組，屆時才需要 host 條件。
 *
 * **三個群組的掛載順序刻意由寬到嚴**：憑證驗證器是以 `as: 'scoped'` 註冊的 `onBeforeHandle`，
 * 而 scoped 在 Elysia 的語意是「本實例 ＋ 往上傳一層」——往上傳的 hook 只會套到**之後**才註冊的路由。
 * 公開群組排在最前面，即使框架的傳播語意在某次升級後變得更寬，被多驗一次的也不會是登入端點
 *（那正是使用者手上不可能有憑證的那一支）。反過來排就是「登入前必須先登入」，
 * 而症狀只有在真的拿一個新帳號去登入時才會出現。
 */
export const registerRoutes = (dependencies: AppDependencies) =>
  new Elysia({ name: 'web-frontend-entry' })
    .use(publicGroup(dependencies))
    .use(refreshGroup(dependencies))
    .use(authenticatedGroup(dependencies))
