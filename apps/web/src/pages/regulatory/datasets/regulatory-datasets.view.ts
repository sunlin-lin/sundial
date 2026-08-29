/**
 * 總覽那一張表「一列怎麼組」（§1.3 的第 (1)(2) 類、§0.5 的 `.view.ts`）。
 *
 * 這裡的每一支都是不依賴 Vue 的純函式：`.vue` 在本專案不做元件測試（§8.1），
 * 邏輯留在模板或 `computed` 就等於零測試覆蓋，而「空值長什麼樣」「不適用怎麼表達」
 * 正好是錯了不會報錯、只會讓人看錯的那一類。
 *
 * **整列在這裡就組成字串**，模板只讀屬性、不呼叫格式化函式：Element Plus 的表格 slot 型別是
 * `Record<PropertyKey, any>`，在模板裡對 `row` 做任何事都拿不到型別保護。
 *
 * ## 本檔最重要的一條：「不適用」不能用空白表達（計畫 §4.1）
 *
 * `lastSync` 是一個判別聯集（`not-applicable` / `never-synced` / `synced`），**三種都要有各自的
 * 顯示文字**，而且 `not-applicable` 與 `never-synced` 不得顯示成同一個東西：
 *
 * | kind | 意思 | 為什麼不能混 |
 * |---|---|---|
 * | `not-applicable` | 這個資料集**本來就不會有**同步紀錄（人工維護，`dataset_code=10`） | 那是規格，不是故障 |
 * | `never-synced` | 應該要有、但**還沒發生過** | 那是「排程沒跑起來」，要有人去看 |
 * | `synced` | 跑過，時間與結果如下 | — |
 *
 * 空白會被讀成「同步壞了」或「還沒跑過」，而補充保險費率永遠不會有同步紀錄。
 * 這也是 `shared/format/empty-display.ts` 的檔頭寫著「頁面不得拿 `EMPTY_DISPLAY` 表達不適用」
 * 的原因：format 層看到的只是一個 `null`，分辨不出這個 `null` 是「沒跑過」還是「不會跑」。
 *
 * 兄弟檔（§0.7 的主題拆分）：版本清單在 `.version.view.ts`，版本內容的欄位定義在
 * `.columns.view.ts` 與 `.record.view.ts`，查詢組裝在 `.payload.ts`。
 *
 * `effectiveVersion.recordCount` 過去曾經需要防禦字串輸入：後端回應方向誤用了可強制轉型的
 * `t.Integer`，OpenAPI 上留了 `string | number` 的影子。`check:response-coercion` 掃出並修正
 * 這一批誤用後，回應方向的 `recordCount` 已經是乾淨的 `number`，字串分支因此拿掉——不要因為
 * 「看起來像防禦性寫法」就加回來。
 */
import { formatAmount } from '../../../shared/format/decimal.ts'
import { formatDate, formatDateTime } from '../../../shared/format/business-date.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import { syncStatusPresentation, type SyncStatusPresentation } from '../../../shared/regulatory/sync-status.ts'
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'
import type { RegulatoryDatasetsOverviewData } from '../../../api/generated/api-client.ts'
import type { DatasetCode } from './regulatory-datasets.payload.ts'

/** 總覽的一列（API 形狀）。由產生型別推導，不在前端另寫一份（§3.2）。 */
export type OverviewRow = RegulatoryDatasetsOverviewData[number]

/**
 * 維護方式 → 語系 key。
 *
 * ⚠️ 後端的值是 `'sync'` / `'manual'`，不是 `'auto'` / `'manual'`。`satisfies Record<...>` 讓
 * 後端改動這組值時這裡直接編譯錯誤，而不是渲染出一個空白的儲存格。
 *
 * 計畫 §2 要求總覽「要能讓人看出這一項是人工維護的」——否則它看起來會像一個很久沒同步的資料集。
 */
const MAINTENANCE_LABEL_KEYS = {
  sync: 'regulatory-datasets.maintenance.sync',
  manual: 'regulatory-datasets.maintenance.manual',
} as const satisfies Record<OverviewRow['maintenance'], MessageKey>

/**
 * 表格實際吃的一列：**全部是已經算好的字串**。
 *
 * 攤平而不是巢狀，理由與同步歷程那一頁相同：模板那一側沒有型別保護，
 * 少一層存取就少一個打錯了不會有人發現的地方。
 */
export type OverviewDisplayRow = {
  readonly datasetCode: DatasetCode
  readonly name: string
  readonly maintenance: string
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly recordCount: string
  readonly lastSync: string
  /**
   * 最後同步的狀態標籤文字。**空字串代表「這一列沒有狀態標籤」**（不適用、從未同步）。
   *
   * 為什麼用空字串而不是 `null`：模板那一側是 `Record<PropertyKey, any>`，`null` 與
   * `undefined` 在那裡分不出來，而「欄位名打錯」的症狀恰好也是 `undefined`。
   * 空字串在模板的 `v-if` 上是一個明確的單一比較（§1.4 允許），而且打錯欄位名時
   * 得到的是 `undefined !== ''` ＝ 真，標籤會渲染成空白方塊——一個看得見的錯誤。
   */
  readonly lastSyncStatusLabel: string
  readonly lastSyncTone: SyncStatusPresentation['tone']
  readonly lastSyncEffect: SyncStatusPresentation['effect']
}

/** 「筆數」那一格。API 型別是 `number | null`，一律走千分位，中間不經過數值轉型。 */
const recordCountDisplay = (value: OverviewRow['effectiveVersion']): string => {
  if (value === null) return EMPTY_DISPLAY
  const count = value.recordCount
  if (count === null) return EMPTY_DISPLAY
  return formatAmount(String(count))
}

/**
 * 「最後同步」那一格的時間文字。
 *
 * `synced` 時顯示**結束時間**，還在跑（`finishedAt === null`）時退回開始時間：
 * 這一欄要回答的是「上一次同步是什麼時候」，而一次正在跑的同步的答案只能是「它幾點開始的」。
 * 兩者都不存在的情況不會發生（後端的 `synced` 必有 `startedAt`）。
 */
const lastSyncTimeDisplay = (lastSync: OverviewRow['lastSync'], translate: TranslateMessage): string => {
  switch (lastSync.kind) {
    case 'not-applicable':
      return translate('regulatory-datasets.last-sync.not-applicable')
    case 'never-synced':
      return translate('regulatory-datasets.last-sync.never-synced')
    case 'synced':
      return formatDateTime(lastSync.finishedAt ?? lastSync.startedAt)
  }
}

/**
 * API 的列 → 表格的列。
 *
 * `translate` 由呼叫端傳進來而不是在這裡 import i18n 實例：本檔要能被純函式測試直接呼叫，
 * 而掛一個 vue-i18n 實例進來，測試就得先把整套 app context 立起來（§8.1 要避免的正是這個）。
 *
 * **`name` 一律用後端回的名稱**，前端不在語系檔另外維護一份（那會是「代碼 ↔ 名稱」的第三份副本，
 * 而它不在 `bun run check:dataset-code` 的守備範圍內——對調兩個名稱不會有任何地方變紅）。
 *
 * **九列固定回傳**，即使某一列在該基準日沒有適用版本（`effectiveVersion: null`）。
 * 因此這裡不做任何「查無資料」的判斷：那一列仍然要出現，只是版本那一格寫著「無適用版本」。
 */
export const toOverviewDisplayRows = (
  rows: readonly OverviewRow[],
  translate: TranslateMessage,
  // 回傳可變陣列（元素本身仍是 readonly）：Element Plus 的表格 `data` 收的是可變陣列。
): OverviewDisplayRow[] =>
  rows.map((row) => {
    const status = row.lastSync.kind === 'synced' ? syncStatusPresentation(row.lastSync.statusCode) : null

    return {
      datasetCode: row.datasetCode,
      name: row.name,
      maintenance: translate(MAINTENANCE_LABEL_KEYS[row.maintenance]),
      // 「這一天沒有任何一版適用」是一個結果，不是缺資料——所以它有自己的一句話，不是 `—`。
      versionCode: row.effectiveVersion?.versionCode ?? translate('regulatory-datasets.no-effective-version'),
      effectiveFrom: formatDate(row.effectiveVersion?.effectiveFrom ?? null),
      recordCount: recordCountDisplay(row.effectiveVersion),
      lastSync: lastSyncTimeDisplay(row.lastSync, translate),
      lastSyncStatusLabel: status === null ? '' : translate(status.labelKey),
      lastSyncTone: status?.tone ?? 'info',
      lastSyncEffect: status?.effect ?? 'light',
    }
  })

/** 某個資料集在目前基準日適用的版本代碼；沒有適用版本時回 `null`。 */
export const effectiveVersionCodeOf = (rows: readonly OverviewRow[], datasetCode: DatasetCode): string | null =>
  rows.find((row) => row.datasetCode === datasetCode)?.effectiveVersion?.versionCode ?? null

/** 某個資料集的名稱；找不到時回代碼本身（理由同同步歷程那一頁：一格寫著數字看起來就是壞的）。 */
export const datasetNameOf = (rows: readonly OverviewRow[], datasetCode: DatasetCode): string =>
  rows.find((row) => row.datasetCode === datasetCode)?.name ?? String(datasetCode)
