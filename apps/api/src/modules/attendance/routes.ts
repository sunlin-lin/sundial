/**
 * `attendance` 大目錄對「路由組裝點」的唯一出口（§0.3）。
 *
 * 形狀與 `index.ts` **完全相同**（只允許 `export ... from`），用途完全互斥：被 re-export 的
 * 來源檔名後綴**只能是 `.routes.ts`**，而**只有路由組裝點可以 import 本檔**。
 *
 * 本檔**不建立群組、不宣告驗證方式**（§1.9）：兩支端點全部落在已登入群組，而那個決定寫在
 * 組裝點 `app/routes.ts`，不寫在這裡也不寫在端點上。
 */
export * from './settings/attendance-settings.routes.ts'
