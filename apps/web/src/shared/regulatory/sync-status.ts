/**
 * 同步狀態（`status_code`）在畫面上長什麼樣（§1.3 的第 (2) 類，共用版）。
 *
 * ## 為什麼在 `shared/`
 *
 * §1.5：**兩個以上的頁面實際共用時才移入共用區。** 這一份原本在 `pages/regulatory/sync/` 裡，
 * 因為當時只有同步歷程那一頁在用；`regulatory/datasets` 的總覽要顯示「最後同步的時間 ＋ 狀態」
 *（計畫 03 §4.1 的欄位表），於是有了第二個使用者。
 *
 * 兩頁顯示的必須是**同一種**東西：同一個 `status_code` 在 A 頁是紅色的「失敗」、在 B 頁是灰色的
 * 「異常」時，使用者看到的是兩種狀態，而沒有人說得出哪一個才對（§5.2 對狀態色的同一條理由）。
 *
 * ## 為什麼放在 `shared/regulatory/` 而不是塞進既有的四個目錄
 *
 * 它不是格式化（`shared/format/` 是「值 → 字串」，這裡是「代碼 → 一組呈現決策」）、
 * 不是 API 處置、不是元件、也不是設計 token。硬塞進其中一個只會讓那個目錄的定義變模糊。
 * 以後端模組名分目錄則有一個實際好處：`status_code` 的四個值由後端的 `RegulatorySyncStatus`
 * 定義，日後要找「這個代碼的前端呈現在哪」，答案與後端的目錄名對得起來。
 */
import type { RegulatorySyncListData } from '../../api/generated/api-client.ts'
import type { MessageKey } from '../i18n/messages.ts'

/** 同步狀態代碼。由產生型別推導，不在前端另列一份（§3.2）。 */
export type SyncStatusCode = RegulatorySyncListData['data'][number]['statusCode']

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
export type SyncStatusPresentation = {
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
const SYNC_STATUS_PRESENTATIONS = {
  1: { labelKey: 'regulatory.sync-status.running', tone: 'warning', effect: 'light' },
  2: { labelKey: 'regulatory.sync-status.succeeded', tone: 'success', effect: 'light' },
  3: { labelKey: 'regulatory.sync-status.failed', tone: 'danger', effect: 'dark' },
  4: { labelKey: 'regulatory.sync-status.no-change', tone: 'info', effect: 'light' },
} as const satisfies Record<SyncStatusCode, SyncStatusPresentation>

export const syncStatusPresentation = (code: SyncStatusCode): SyncStatusPresentation =>
  SYNC_STATUS_PRESENTATIONS[code]
