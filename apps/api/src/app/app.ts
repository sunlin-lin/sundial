/**
 * 應用程式組裝點。
 *
 * **本檔不連資料庫、不 `listen`。** §1.7 要求 `bun run gen:api` 必須能在後端服務未啟動、
 * 資料庫未連線的情況下執行（它只需要一份型別）；若非得先起 MariaDB 才能產生契約，
 * 這個指令就會在新人的第一天失敗，結果是「跑不起來，先沿用舊型別」，契約單一來源等於沒有。
 * 因此所有需要外部資源的東西一律由參數注入，不在模組層初始化。
 *
 * 中介層的註冊順序即執行順序，不可任意調換：
 * error handler 要包住後面所有東西才攔得到它們的例外；出口層要在路由之前註冊，
 * 才會涵蓋每一個群組的回應（含身分驗證 middleware 就地回的 `900`／`901`）。
 */
import { Elysia } from 'elysia'
import { errorHandler } from '../http/error-handler.ts'
import { infrastructureEndpoints } from '../http/infrastructure-endpoints.ts'
import { requestContext } from '../http/request-context.ts'
import { responseEnvelope } from '../http/response-envelope.ts'
import type { AppDependencies } from './app-dependencies.ts'
import { registerRoutes } from './routes.ts'

// 相依型別住在 `app-dependencies.ts`（理由寫在那個檔頭：避免與 `routes.ts` 形成循環相依），
// 但呼叫端只需要認得 `app/app.ts` 這一個入口，因此在這裡把型別再匯出一次。
export type { AppDependencies }

export const buildApp = (dependencies: AppDependencies) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(dependencies.clock))
    .use(responseEnvelope(dependencies.clock))
    .use(infrastructureEndpoints)
    .use(registerRoutes(dependencies))
