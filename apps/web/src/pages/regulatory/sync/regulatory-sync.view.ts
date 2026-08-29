/**
 * 同步歷程「一列怎麼組」與資料集下拉的選項（§1.3 的第 (1)(2) 類、§0.5 的 `.view.ts`）。
 *
 * 這裡的每一支都是不依賴 Vue 的純函式：`.vue` 在本專案不做元件測試（§8.1），
 * 邏輯留在模板或 `computed` 就等於零測試覆蓋，而「狀態顯示成哪一種顏色」「空值長什麼樣」
 * 正好是錯了不會報錯、只會讓人看錯的那一類。
 *
 * **整列在這裡就組成字串**（{@link toDisplayRows}），模板只讀屬性、不呼叫格式化函式。
 * 這不只是為了守 §1.4：Element Plus 的表格 slot 型別是 `Record<PropertyKey, any>`，
 * 在模板裡對 `row` 做任何事都拿不到型別保護——組列的工作放在這裡，那段沒有型別的區域
 * 就縮到「讀一個已經算好的字串」而已。
 *
 * ## 資料集名稱的來源換了三次
 *
 * 這一頁最早有一份手寫的「代碼 → 語系 key」對照（`.dataset.view.ts`），那是「代碼 ↔ 名稱」的
 * 第三份副本，而且**不在 `bun run check:dataset-code` 的守備範圍內**——對調兩個名稱不會有任何
 * 地方變紅，使用者會看到一個標著「勞保」的健保同步歷程。刪掉那份之後改打
 * `regulatory.datasets.overview` 取名稱，代價是這一頁因此也依賴一個與本頁業務無關的權限碼；
 * 改成對九個代碼各探測一次 `sync/list` 又換來九支請求換九個常數字串的代價，在開發機看不出來，
 * 上線後會被注意到。
 *
 * **現在名稱與正式查詢一次到位**：`regulatory.sync.list` 的回應除了當次查詢那個資料集的
 * `datasetName`，另外還帶**固定九筆**的 `datasets`（`{ code, name }[]`，依代碼排序，含人工維護
 * 與尚未同步過的資料集）。下拉的選項因此**直接來自正式查詢的回應**，不必另外打任何請求，
 * 也不必在前端重建任何「代碼 → 名稱」副本。連帶結果：選項要等**第一次查詢**回來才有——這不是
 * 退步，預設資料集（`DEFAULT_DATASET_CODE`）本來就會在進頁面時立刻查一次，選項與第一批列表
 * 資料因此同時就緒，沒有「選項先出現、內容還在轉」或反過來的中間態（見 `.page.vue` 檔頭）。
 *
 * 兄弟檔（§0.7 的主題拆分）：查詢的組裝在 `.payload.ts`。狀態的呈現與回應的處置已經移進共用區
 *（`shared/regulatory/sync-status.ts`、`shared/api/list-echo.ts`、`shared/api/load-failure.ts`），
 * 理由都是 §1.5 的同一條：第二個頁面出現了。
 *
 * `id`／`recordsReceived` 過去曾經需要防禦字串輸入：後端回應方向誤用了可強制轉型的 `t.Integer`，
 * OpenAPI 上留了 `string | number` 的影子。`check:response-coercion` 掃出並修正這一批誤用後，
 * 兩者在回應方向都已經是乾淨的 `number`，字串分支因此拿掉——不要因為「看起來像防禦性寫法」
 * 就加回來。
 */
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import { formatAmount } from '../../../shared/format/decimal.ts'
import { formatDateTime } from '../../../shared/format/business-date.ts'
import { syncStatusPresentation, type SyncStatusPresentation } from '../../../shared/regulatory/sync-status.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import type { RegulatorySyncListData } from '../../../api/generated/api-client.ts'

/** 同步歷程的一列（API 形狀）。由產生型別推導，不在前端另寫一份（§3.2）。 */
export type SyncLogRow = RegulatorySyncListData['data'][number]

/**
 * 資料集下拉的一個選項。**直接是產生型別的 `datasets` 元素**，不是本檔另外宣告的形狀（§3.2）：
 * 後端把 `code`／`name` 其中一個欄位改名，這裡當場編譯錯誤，而不是等到畫面上出現 `undefined`。
 * 呼叫端（`.page.vue`）因此不需要任何轉換函式，`page.datasets` 可以直接指派給下拉的狀態。
 */
export type DatasetOption = RegulatorySyncListData['datasets'][number]

/**
 * 失敗原因這一格要顯示什麼。
 *
 * **原文照印，不截斷、不改寫、不加工**（計畫 §4.3、§5.1）：後端在 `error_message` 裡刻意寫了
 * 可判讀的內容（缺哪一種身分別、兩邊的 checksum、生效日推導不出來的原因、哪些資源不在候選範圍），
 * 而且裡面抄自政府公告的民國年**刻意不轉西元**——改寫它會讓人對不上公告。
 * 截斷或摘要等於把後端那些設計丟掉，所以這一支不碰字串內容，長文的處置全部交給版面（見 `.page.vue`）。
 *
 * 非失敗的列本來就沒有失敗原因，顯示 `EMPTY_DISPLAY`（「沒有值」）。
 * `status_code=3` 卻是 `null` 時同樣顯示 `—`：那是後端違反自己的規格（失敗必填 `error_message`），
 * 而一列標著「失敗」卻寫著「—」的紀錄看起來就是壞的，會被回報——比補一句前端自己編的話好。
 */
export const failureReasonDisplay = (row: SyncLogRow): string => row.errorMessage ?? EMPTY_DISPLAY

/**
 * 收到筆數。
 *
 * 走 `shared/format/` 的千分位（§9.2 要求所有格式化經統一函式）：API 型別是 `number | null`，
 * 這裡先轉成字串再交給 `formatAmount`——`formatAmount` 全程字串運算，不經過數值轉型。
 *
 * `null` 是合法狀態：在解析之前就失敗、以及還在執行中的那幾列都沒有筆數。
 */
export const recordsReceivedDisplay = (value: SyncLogRow['recordsReceived']): string => {
  if (value === null) return EMPTY_DISPLAY
  return formatAmount(String(value))
}

/**
 * 表格實際吃的一列：**全部是已經算好的字串**，模板不再做任何換算或格式化。
 *
 * 攤平而不是巢狀（`statusLabel` / `statusTone` / `statusEffect` 而不是一個 `status` 物件）：
 * 模板那一側沒有型別保護，少一層存取就少一個打錯了不會有人發現的地方。
 */
export type SyncLogDisplayRow = {
  readonly id: string
  readonly dataset: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly statusLabel: string
  readonly statusTone: SyncStatusPresentation['tone']
  readonly statusEffect: SyncStatusPresentation['effect']
  readonly recordsReceived: string
  readonly failureReason: string
}

/**
 * API 的列 → 表格的列。
 *
 * `translate` 由呼叫端傳進來而不是在這裡 import i18n 實例：本檔要能被純函式測試直接呼叫，
 * 而掛一個 vue-i18n 實例進來，測試就得先把整套 app context 立起來（§8.1 要避免的正是這個）。
 *
 * `datasetName` 是**單一字串，不是查表函式**：這一頁一次只查一個資料集（計畫 §4.3），
 * 一整包回應裡的所有列必然屬於同一個資料集，因此呼叫端直接傳 `page.datasetName`
 *（回應本身帶的名稱，見本檔檔頭「資料集名稱的來源換了三次」）即可，不需要靠代碼逐列查表——
 * 查表只有在「一批列可能屬於不同資料集」時才有意義。
 *
 * 時間一律走 `shared/format/`（§9.2）：API 傳來的是台北牆鐘字串，丟進 `new Date()` 會被當成
 * **瀏覽器所在時區**再換算一次——使用者把筆電時區設成東京，整批時間就多一小時，
 * 而畫面上不會有任何錯誤提示。未結束的同步 `finishedAt` 是 `null`，格式化層會給出「沒有值」。
 */
export const toDisplayRows = (
  rows: readonly SyncLogRow[],
  translate: TranslateMessage,
  datasetName: string,
  // 回傳可變陣列（元素本身仍是 readonly）：Element Plus 的表格 `data` 收的是可變陣列，
  // `readonly T[]` 傳不進去，而在頁面那一側複製一份只是把同一件事搬到看不出理由的地方。
): SyncLogDisplayRow[] =>
  rows.map((row) => {
    const status = syncStatusPresentation(row.statusCode)
    return {
      id: String(row.id),
      dataset: datasetName,
      startedAt: formatDateTime(row.startedAt),
      finishedAt: formatDateTime(row.finishedAt),
      statusLabel: translate(status.labelKey),
      statusTone: status.tone,
      statusEffect: status.effect,
      recordsReceived: recordsReceivedDisplay(row.recordsReceived),
      failureReason: failureReasonDisplay(row),
    }
  })
