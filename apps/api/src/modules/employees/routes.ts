/**
 * `employees` 大目錄對「路由組裝點」的唯一出口（§0.3）。
 *
 * 形狀與 `index.ts` **完全相同**（只允許 `export ... from`），用途完全互斥：
 * 被 re-export 的來源檔名後綴**只能是 `.routes.ts`**，而**只有路由組裝點可以 import 本檔**。
 *
 * 不與 `index.ts` 合併的理由：合併之後，任何模組 import 本模組的 service，都會把 HTTP 框架
 * 一起拖過大目錄邊界，§3.1.1 那條規則會被一行看似無害的 import 繞過——與
 * 「re-export repository 會把 db client 拖過去」逐字同構，處置因此也必須同構。
 *
 * 本檔**不建立群組、不宣告驗證方式**（§1.9）：端點全部落在已登入群組，
 * 而那個決定寫在組裝點 `app/routes.ts`，不寫在這裡也不寫在端點上。
 *
 * **`main` 現在只有四支端點**（`list`／`get`／`update`／`delete`），`create` 已移除
 * （實作計畫 `05-employee-onboarding.md` §4.2 定案的破壞性變更）：單頁新增上線後，
 * `/employees/main/create` 只建人員主檔、不建任職與帳號，會產生「沒有任職、沒有帳號」的員工。
 * 新增員工唯一的路是下面的 `onboarding`。
 */
export * from './main/employees-main.routes.ts'
export * from './onboarding/employees-onboarding.routes.ts'
