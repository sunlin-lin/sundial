/**
 * `sessions` 大目錄對「其他模組」的唯一出口（§0.3）。
 *
 * **只有 re-export，沒有任何宣告、常數或函式本體**：`index.ts` 是沒有層後綴的檔案，
 * 所有分層規則都不以它為對象——不限制的話它會長成一個沒有任何規則管得到的第六層，
 * 而且是最方便亂放東西的那一層（「這段兩邊都要用，先放 index」）。
 *
 * **只 export service 與 errors，不 export repository 與 routes。**
 * 這一條在本模組特別要緊：re-export repository 會讓一行 `import { ... } from 'modules/sessions'`
 * 把**身分解析查詢**（§4.2 唯一一支不帶公司條件的查詢）拖過大目錄邊界，
 * 而它一旦在別的模組被呼叫得到，§4.2 的三項邊界就只剩第 1 項還成立——
 * 而繞過的路徑在 import 語句上完全看不出來。
 *
 * 不 export routes 的理由同構：那會讓任何 import 本模組 service 的檔案把 HTTP 框架一起拖過來，
 * §3.1.1「service／domain 不得 import http 層」那條規則會被一行看似無害的 import 繞過。
 * routes 走第二個出口 `routes.ts`，只有路由組裝點碰得到。
 */
export * from './main/sessions-main.service.ts'
export * from './main/sessions-main.errors.ts'

/**
 * `hashPassword` 已透過 `export * from './main/sessions-main.service.ts'` 匯出（見該檔），
 * 這裡不重複宣告——`index.ts` 只允許 `export ... from`，`export *` 已經涵蓋它。
 *
 * `revokeSessionsForDeactivation` 同理已由上面那行涵蓋：`company-users/main` 停用一個成員的
 * 登入帳號時，透過這個出口在同一筆交易內作廢該成員的所有 refresh token 鏈（安全落差修補，
 * 完整理由見 `main/impl/sessions-main.revoke-for-deactivation.service.ts` 檔頭）。`sessions`
 * 被 `company-users` import 不是新方向——`company-users-main.create.service.ts`／
 * `reset-password.service.ts` 早就在用這個出口的 `hashPassword`；`sessions` 本身不 import
 * `company-users`，方向不會形成循環。
 */
