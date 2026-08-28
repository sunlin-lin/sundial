/**
 * `regulatory` 大目錄對「路由組裝點」的唯一出口（§0.3）。
 *
 * 形狀與 `index.ts` **完全相同**（只允許 `export ... from`），用途完全互斥：
 * 被 re-export 的來源檔名後綴**只能是 `.routes.ts`**，而**只有路由組裝點可以 import 本檔**。
 *
 * 不與 `index.ts` 合併的理由：合併之後，任何模組 import 本模組的 service，都會把 HTTP 框架
 * 一起拖過大目錄邊界——而本模組的 service 正是 Payroll 會直接呼叫的那一支（計畫 §4.1），
 * 它一旦連帶把 Elysia 拉進薪資結算模組，§3.1.1 那條「service／domain 不得 import http 層」
 * 就被一行看似無害的 import 繞過了。
 *
 * 本檔**不建立群組、不宣告驗證方式**（§1.9）：三支端點全部落在已登入群組（計畫 §4.2），
 * 而那個決定寫在組裝點 `app/routes.ts`，不寫在這裡也不寫在端點上。
 */
export * from './datasets/regulatory-datasets.routes.ts'
