/**
 * 「一個可以下載的政府資源」是什麼，以及它必須通過哪三道檢查（零 IO 純函式，§0.1）。
 *
 * ## 為什麼這個型別不姓 data.gov
 *
 * 前六個資料集的資源全部來自 data.gov.tw 的 metadata API，因此這個型別原本住在
 * `regulatory-data-gov.ts` 裡、叫做 `DataGovResource`。`dataset_code=8`（勞動部最低工資公告頁）
 * 與 `9`（財政部臺北國稅局 Open Data 下載專區）**沒有 data.gov.tw 這一層**——
 * 前者的「資源」是公告頁上的一則條列，後者是下載專區列表頁上的一個年度連結（計畫 §7.0）。
 *
 * 留在原地的話，那兩支解析器要從一個名字寫著 data.gov 的檔案 import 一個與 data.gov 無關的型別，
 * 而下一個人會合理地以為它們也走 metadata API。**資源探索的「產物」是一個通用概念，
 * 「怎麼探索出來的」才是各來源自己的事**，因此兩者分兩個檔案。
 *
 * ## 三道檢查放在這裡，不放在各來源的探索函式裡
 *
 * 有沒有網址、是不是 https、長度會不會超過 `government_resource_id` 的欄位上限——
 * 三個來源（data.gov.tw、勞動部、財政部）因此不可能有不同的嚴格度。
 * 抄成三份的代價不是行數，是**分岔**：其中一份哪天為了讓某個新形態通過而放寬，另外兩份不會跟著鬆。
 */

/**
 * `government_resource_id` 欄位長度（`varchar(150)`）。
 *
 * 超長時**在這裡失敗**，而不是讓 MariaDB 截斷或報錯：截斷後的網址仍然像一個網址，
 * 而它是事後追查「這一版是從哪裡抓來的」唯一的線索。
 */
const MAX_RESOURCE_ID_LENGTH = 150

export type RegulatorySourceResource = {
  /** 本次要下載的網址，同時寫進 `regulatory_dataset_versions.government_resource_id`。 */
  readonly downloadUrl: string
  /**
   * 資源說明——**這一份資源自己的名字**。
   *
   * 三個來源各自對應到不同的東西，但角色相同（版本代碼的唯一材料，計畫 §7.1.1）：
   *
   * | 來源 | 這一欄是什麼 |
   * |---|---|
   * | data.gov.tw | metadata 的 `resourceDescription`（`115年1月全民健康保險投保金額分級表`） |
   * | 財政部下載專區 | 連結的檔名（`財政部臺北國稅局薪資所得扣繳稅額表_115年度.csv`） |
   * | 勞動部公告頁 | 那一則公告的原文（`民國114年10月21日發布，自115年1月1日起實施，…`） |
   *
   * 只進 log、錯誤訊息與生效日推導，不進資料表。
   */
  readonly resourceDescription: string | null
  /**
   * 政府標示的最後修改時間，台北牆鐘 `YYYY-MM-DD HH:mm:ss`（§6）。
   *
   * **時區在探索這一步就確定，不留到寫入時再想**（計畫 §3.2）：三個來源都是我國政府的網站，
   * 這個時戳本來就是台北時間，因此換算是**恆等**——但這句話必須寫下來，
   * 否則下一個資料集的解析器會不知道這一欄到底換算過沒有，而漏換算的症狀是時間差 8 小時、不報錯。
   *
   * 拿不到時是 `null` 而不是失敗：這一欄在資料表上是選填，它**不是** `effective_from`
   * （後者適用計畫 §7.2 那條「推導不出就失敗」）。為了一個只供參考的時戳讓整次同步失敗，
   * 會讓真正該紅的那條規則被稀釋。
   */
  readonly sourceModifiedAt: string | null
}

export type RegulatorySourceResourceResult =
  { readonly ok: true; readonly value: RegulatorySourceResource } | { readonly ok: false; readonly reason: string }

/**
 * 探索到的**全部**資源（多版本資料集用）。
 *
 * 與 {@link RegulatorySourceResourceResult} 分開而不是讓後者回一個陣列：單資源那四個資料集的呼叫端
 * 拿到的必須是「一個資源」，讓它們去處理一個長度可能不是 1 的陣列，等於把多版本的問題
 * 搬進一條現在是直線的路。
 */
export type RegulatorySourceResourceListResult =
  | { readonly ok: true; readonly values: readonly RegulatorySourceResource[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 建一個資源，並跑完三道檢查。
 *
 * @param input 各來源的探索函式讀出來的三個值。
 * @param label 這是哪一種來源的資源（`metadata 的 JSON 資源`、`下載專區的連結`），
 *   只用來組錯誤訊息——那句話會原樣進 `regulatory_sync_logs.error_message`。
 */
export const toSourceResource = (
  input: {
    readonly downloadUrl: string | null
    readonly resourceDescription: string | null
    readonly sourceModifiedAt: string | null
  },
  label: string,
): RegulatorySourceResourceResult => {
  const { downloadUrl } = input
  if (downloadUrl === null) return { ok: false, reason: `${label}沒有下載網址` }

  // 只走 TLS：這份內容會成為薪資結算的法定基準，明文 HTTP 的內容在傳輸途中可以被改寫，
  // 而被改寫過的分級表在系統裡與正確的分級表長得一模一樣。
  if (!downloadUrl.startsWith('https://')) {
    return { ok: false, reason: `${label}的網址不是 https：${downloadUrl}` }
  }
  if (downloadUrl.length > MAX_RESOURCE_ID_LENGTH) {
    return {
      ok: false,
      reason: `${label}的網址長度 ${String(downloadUrl.length)} 超過 government_resource_id 的 ${String(MAX_RESOURCE_ID_LENGTH)} 字元上限：${downloadUrl}`,
    }
  }

  return {
    ok: true,
    value: {
      downloadUrl,
      resourceDescription: input.resourceDescription,
      sourceModifiedAt: input.sourceModifiedAt,
    },
  }
}

/** 資源在錯誤訊息裡的稱呼：說明優先（`115年1月…`），沒有說明時退回網址。 */
export const describeResource = (resource: RegulatorySourceResource): string =>
  resource.resourceDescription ?? resource.downloadUrl
