/**
 * `company-users` 大目錄對「路由組裝點」的唯一出口（§0.3）。
 *
 * 形狀與 `index.ts` **完全相同**（只允許 `export ... from`），用途完全互斥：
 * 被 re-export 的來源檔名後綴**只能是 `.routes.ts`**，而**只有路由組裝點可以 import 本檔**。
 *
 * 不與 `index.ts` 合併的理由：`index.ts` 匯出的 `listPermissionCodes` 是**身分驗證路徑**上的查詢
 *（`app/session-access-control.ts` 會用它），合併之後那條 import 會把整個 HTTP 框架一起拖進
 * 入口層與其他模組——與「re-export repository 會把 db client 拖過去」逐字同構，
 * 而且一樣從 import 語句上完全看不出來。
 *
 * 次目錄是 `roles` 而不是 `main`（§0.2）：子實體是「成員與角色的關聯」，它有自己的名字。
 * `main` 現在也有一支端點（重設密碼），因此本檔一併 re-export 它的 routes。
 * 本檔**不建立群組、不宣告驗證方式**（§1.9）。
 */
export * from './main/company-users-main.routes.ts'
export * from './roles/company-users-roles.routes.ts'
