/**
 * 同步歷程「一列怎麼組」與狀態怎麼顯示（§1.3 的第 (1)(2) 類、§0.5 的 `.view.ts`）。
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
 * 兄弟檔（§0.7 的主題拆分）：資料集名稱在 `.dataset.view.ts`，回應的處置在 `.response.view.ts`。
 */
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import { formatAmount } from '../../../shared/format/decimal.ts'
import { formatDateTime } from '../../../shared/format/business-date.ts'
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'
import type { RegulatorySyncListData } from '../../../api/generated/api-client.ts'
import { datasetLabelKey } from './regulatory-sync.dataset.view.ts'

/** 同步歷程的一列（API 形狀）。由產生型別推導，不在前端另寫一份（§3.2）。 */
export type SyncLogRow = RegulatorySyncListData['data'][number]

/**
 * 狀態的呈現。
 *
 * §9.1：**不得只用顏色表達狀態**，所以永遠有 `labelKey`；色彩則走具名 token 而不是各頁自選
 * 相近顏色（§5.2）——`tone` 是 Element Plus 的語意色名，`tokens.css` 已經把 `--el-color-*`
 * 接到 `--color-state-*`，兩套顏色因此是同一套。
 *
 * `effect` 是 ElTag 的填色方式：**「失敗」用實心底色，其餘用淡色**——計畫要求失敗要一眼看得
 * 出來，而一張二十列的表格裡，四種同樣淡的色塊需要逐一讀字才分得出哪一列出事了。
 */
export type StatusPresentation = {
  readonly labelKey: MessageKey
  readonly tone: 'success' | 'danger' | 'warning' | 'info'
  readonly effect: 'dark' | 'light'
}

/**
 * 四種狀態的呈現，key 即 `status_code`（後端 `RegulatorySyncStatus`）。
 *
 * 四個值不可合併（後端 schema 檔頭）：`無異動`（跑了但政府沒改）與 `更新成功`（跑了而且寫入
 * 新版本）對「為什麼沒有新版本」的答案完全不同；`執行中` 是唯一還沒有結論的狀態，而且它同時是
 * 心跳逾時可能把它判死的候選，所以用 warning 而不是 info——讀的人應該注意到它。
 *
 * `satisfies Record<...>` 讓後端新增第五種狀態時這裡直接編譯錯誤，而不是渲染出一個空白標籤。
 */
const STATUS_PRESENTATIONS = {
  1: { labelKey: 'regulatory-sync.status.running', tone: 'warning', effect: 'light' },
  2: { labelKey: 'regulatory-sync.status.succeeded', tone: 'success', effect: 'light' },
  3: { labelKey: 'regulatory-sync.status.failed', tone: 'danger', effect: 'dark' },
  4: { labelKey: 'regulatory-sync.status.no-change', tone: 'info', effect: 'light' },
} as const satisfies Record<SyncLogRow['statusCode'], StatusPresentation>

export const statusPresentation = (code: SyncLogRow['statusCode']): StatusPresentation =>
  STATUS_PRESENTATIONS[code]

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
 * 走 `shared/format/` 的千分位（§9.2 要求所有格式化經統一函式），輸入是字串——
 * `formatAmount` 全程字串運算，這一格因此不會經過 `number`。
 *
 * `null` 是合法狀態：在解析之前就失敗、以及還在執行中的那幾列都沒有筆數。
 */
export const recordsReceivedDisplay = (value: SyncLogRow['recordsReceived']): string => {
  if (value === null) return EMPTY_DISPLAY
  return formatAmount(typeof value === 'string' ? value : String(value))
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
  readonly statusTone: StatusPresentation['tone']
  readonly statusEffect: StatusPresentation['effect']
  readonly recordsReceived: string
  readonly failureReason: string
}

/**
 * API 的列 → 表格的列。
 *
 * `translate` 由呼叫端傳進來而不是在這裡 import i18n 實例：本檔要能被純函式測試直接呼叫，
 * 而掛一個 vue-i18n 實例進來，測試就得先把整套 app context 立起來（§8.1 要避免的正是這個）。
 *
 * 時間一律走 `shared/format/`（§9.2）：API 傳來的是台北牆鐘字串，丟進 `new Date()` 會被當成
 * **瀏覽器所在時區**再換算一次——使用者把筆電時區設成東京，整批時間就多一小時，
 * 而畫面上不會有任何錯誤提示。未結束的同步 `finishedAt` 是 `null`，格式化層會給出「沒有值」。
 */
export const toDisplayRows = (
  rows: readonly SyncLogRow[],
  translate: TranslateMessage,
  // 回傳可變陣列（元素本身仍是 readonly）：Element Plus 的表格 `data` 收的是可變陣列，
  // `readonly T[]` 傳不進去，而在頁面那一側複製一份只是把同一件事搬到看不出理由的地方。
): SyncLogDisplayRow[] =>
  rows.map((row) => {
    const status = statusPresentation(row.statusCode)
    return {
      id: typeof row.id === 'string' ? row.id : String(row.id),
      dataset: translate(datasetLabelKey(row.datasetCode)),
      startedAt: formatDateTime(row.startedAt),
      finishedAt: formatDateTime(row.finishedAt),
      statusLabel: translate(status.labelKey),
      statusTone: status.tone,
      statusEffect: status.effect,
      recordsReceived: recordsReceivedDisplay(row.recordsReceived),
      failureReason: failureReasonDisplay(row),
    }
  })
