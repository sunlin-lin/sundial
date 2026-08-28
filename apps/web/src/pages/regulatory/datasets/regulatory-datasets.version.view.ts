/**
 * 版本清單那一張表「一列怎麼組」（§1.3 的第 (1) 類；依 §0.7 從 `.view.ts` 按主題拆出來的兄弟檔）。
 *
 * 它與總覽的「一列怎麼組」互不相干（一個是九個資料集各一列，一個是一個資料集的歷史版本），
 * 放在同一個檔案裡只會讓兩邊都變成翻頁才找得到的東西。
 */
import { formatAmount } from '../../../shared/format/decimal.ts'
import { formatDate, formatDateTime } from '../../../shared/format/business-date.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type { RegulatoryDatasetsListData } from '../../../api/generated/api-client.ts'

/** 版本清單的一列（API 形狀）。由產生型別推導，不在前端另寫一份（§3.2）。 */
export type VersionRow = RegulatoryDatasetsListData['data'][number]

export type VersionDisplayRow = {
  readonly id: string
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly effectiveTo: string
  readonly recordCount: string
  readonly syncedAt: string
  /**
   * 這一版是不是「目前基準日適用的那一版」。
   *
   * 這一欄的存在理由是把基準日這個抽象概念釘在畫面上的一列上：使用者改了基準日之後，
   * 標記會跳到另一列——那一秒他就懂了「適用版本」是什麼意思，而一段說明文字做不到這件事。
   */
  readonly isEffective: boolean
}

/**
 * API 的列 → 表格的列。
 *
 * @param effectiveVersionCode 目前基準日適用的版本代碼（來自 `overview`，`null` 代表沒有適用版本）。
 *   用版本代碼比對而不是版本 id：兩支端點回的 id 型別是 `string | number`，
 *   比對前要先決定怎麼收斂，而版本代碼在同一個資料集內本來就唯一、而且是使用者看得到的那個值。
 *
 * 日期一律走 `shared/format/`（§9.2）：API 傳來的是台北牆鐘字串，丟進 `new Date()` 會被當成
 * **瀏覽器所在時區**再換算一次，而畫面上不會有任何錯誤提示。
 *
 * `effectiveTo` 是 `null` 的版本是**目前仍然有效**的那一版（後端不填一個假的結束日），
 * 顯示 `EMPTY_DISPLAY`：那是「這一邊沒有界線」，與級距表的開放端同一種表達（見後端 schema）。
 */
export const toVersionDisplayRows = (
  rows: readonly VersionRow[],
  effectiveVersionCode: string | null,
  // 回傳可變陣列（元素本身仍是 readonly）：Element Plus 的表格 `data` 收的是可變陣列。
): VersionDisplayRow[] =>
  rows.map((row) => ({
    id: typeof row.id === 'string' ? row.id : String(row.id),
    versionCode: row.versionCode,
    effectiveFrom: formatDate(row.effectiveFrom),
    effectiveTo: formatDate(row.effectiveTo),
    recordCount:
      row.recordCount === null
        ? EMPTY_DISPLAY
        : formatAmount(typeof row.recordCount === 'string' ? row.recordCount : String(row.recordCount)),
    syncedAt: formatDateTime(row.syncedAt),
    isEffective: effectiveVersionCode !== null && row.versionCode === effectiveVersionCode,
  }))
