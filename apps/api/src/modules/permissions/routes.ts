/**
 * `permissions` 大目錄對「路由組裝點」的唯一出口（§0.3）。
 *
 * 形狀與 `index.ts` **完全相同**（只允許 `export ... from`），用途完全互斥：
 * 被 re-export 的來源檔名後綴**只能是 `.routes.ts`**，而**只有路由組裝點可以 import 本檔**。
 *
 * 不與 `index.ts` 合併的理由：合併之後，任何模組 import 本模組的 service，都會把 HTTP 框架
 * 一起拖過大目錄邊界，§3.1.1「service／domain 不得 import http 層」那條規則會被一行看似無害的
 * import 繞過——與「re-export repository 會把 db client 拖過去」逐字同構。
 *
 * 本檔**不建立群組、不宣告驗證方式**（§1.9）：`permissions/main/tree` 落在哪一個認證群組，
 * 由組裝點 `app/routes.ts` 決定，看那裡就知道。
 */
export * from './main/permissions-main.routes.ts'
