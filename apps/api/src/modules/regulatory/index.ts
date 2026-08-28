/**
 * `regulatory` 大目錄對「其他模組」的唯一出口（§0.3）。
 *
 * **這一條特別容易被誤會，因此寫在最前面**（計畫 §4.1）：**Payroll 呼叫的是這裡的
 * `resolveEffectiveDataset({ datasetCode, asOfDate })`，不是打 `/regulatory/datasets/resolve`。**
 * HTTP 端點的存在是給前端顯示用的，兩者共用同一支 service。
 *
 * 差別在失敗時看到的形狀：service 這一側回 `ServiceResult` 的失敗分支（帶
 * `regulatory.datasets.errors.no-effective-version`），HTTP 那一側依 §3.1.3 回 `data: null`。
 * 這不是不一致——前端該顯示空狀態，Payroll 則必須停下來：300 人的批次結算裡若有一人查無版本
 * 而呼叫端「log 並 continue」，那個人的薪資單會直接從當期結果中消失，而批次跑完看起來是成功的。
 *
 * **經這裡呼叫時 `records[].data` 是收斂的，不必自己收窄**：`resolveEffectiveDataset` 以
 * `datasetCode` 為泛型參數，因此 `resolveEffectiveDataset(ctx, { datasetCode: 1, asOfDate })`
 * 拿回來的 `data` 就是勞保分級表那一個形狀，`data.monthlyInsuredSalary` 直接取得到。
 * **同一支端點 `/regulatory/datasets/resolve` 的 response schema 仍然是全部形狀的聯集，
 * 而那不是漏改**：端點的 `datasetCode` 要到執行期才知道，OpenAPI 契約本來就得涵蓋每一種可能。
 * 完整的理由（以及「為什麼不該讓兩邊一致」）寫在 `datasets/regulatory-datasets.service.ts` 檔頭。
 *
 * **跨模組的錯誤碼必須由呼叫端轉譯成自己的碼**（計畫 §4.4）：Payroll 的端點依 §1.8.3 要宣告
 * 自己會吐哪些錯誤碼，那份清單只能是 `payrolls.*`。轉譯時請把 `datasetCode` 與 `asOfDate`
 * 放進自己那筆錯誤的 `data`（本模組已經把兩者放在 `errors[].data` 裡），否則
 * 「哪個資料集、哪一天」這個唯一有用的資訊會在轉譯過程中掉光。
 *
 * ---
 *
 * **只有 re-export，沒有任何宣告、常數或函式本體**：`index.ts` 是唯一沒有層後綴的檔案，
 * 所有分層規則都不以它為對象——不限制的話它會長成一個沒有任何規則管得到的第六層。
 *
 * **只 export service 與 errors，不 export repository 與 routes**：re-export repository 會讓
 * 跨模組的一行 import 把資料庫連線一起拖進來，而「裸 db client 限資料存取層」那條規則會被繞過，
 * 且繞過的路徑在 import 語句上完全看不出來。
 */
export * from './datasets/regulatory-datasets.service.ts'
export * from './datasets/regulatory-datasets.errors.ts'
// `sync` 次目錄同樣只出 service 與 errors。它的 `runSync` **沒有端點**（計畫 D3），
// 呼叫者是伺服器端的程序——而「所有呼叫必須經過入口」在跨大目錄時就是這個檔案（§0.3）。
// 少了這兩行，那個動作在型別上沒有任何合法的呼叫路徑。
export * from './sync/regulatory-sync.service.ts'
export * from './sync/regulatory-sync.errors.ts'
