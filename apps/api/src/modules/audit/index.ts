/**
 * `audit` 大目錄的唯一出口（§0.3）。
 *
 * **只有 re-export，沒有任何宣告、常數或函式本體**：`index.ts` 是唯一沒有層後綴的檔案，
 * 所有分層規則都不以它為對象——不限制的話它會長成一個沒有任何規則管得到的第六層，
 * 而且是最方便亂放東西的那一層（「這段兩邊都要用，先放 index」）。
 *
 * **只 export service**：本模組沒有 `errors.ts`（稽核寫入沒有業務錯誤可以收集，計畫 §6），
 * 也不 export repository——re-export repository 會讓跨模組的一行 import 把資料庫連線一起拖進來，
 * 而「裸 db client 限資料存取層」那條規則會被繞過，且繞過的路徑在 import 語句上完全看不出來。
 *
 * **沒有 `routes.ts`**：本輪不開任何端點（計畫 §7、§8），而零端點的大目錄只有 `index.ts`
 * ——生一個什麼都不 re-export 的 `routes.ts` 只會多一個空殼。
 */
export * from './main/audit-main.service.ts'
