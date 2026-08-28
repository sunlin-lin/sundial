/**
 * data.gov.tw metadata 的解讀（零 IO 純函式，§0.1）。網路那一段在 `impl/` 的 run 切片。
 *
 * ## 這一步存在的唯一理由：`government_resource_id` 不得硬編
 *
 * 資料字典明寫 `government_resource_id`「不視為永久固定 URL」，計畫 §7.0 給了因應手段：
 *
 * ```
 * GET https://data.gov.tw/api/v2/rest/dataset/{datasetId}
 * ```
 *
 * 免金鑰、回 JSON，`result.distribution[].resourceDownloadUrl` 就是這一次要抓的網址。
 * **程式只硬編 `datasetId`（一個穩定的數字），每次同步先打這支 API 重新探索。**
 * 實測勞動部的資源網址帶隨機尾碼（`A17000000J-020014-Uy8`／`-rpF`／`-pYx`，同一個資料集的
 * CSV／JSON／XML 各一個），硬編一定會壞，而壞掉的形式是 404——政府改版的那一天同步從此失敗。
 *
 * ## 讀不懂就失敗，不挑一個「看起來對」的資源
 *
 * `distribution[]` 同時有 CSV／JSON／XML／WEBSERVICES 四筆。挑錯格式不會報錯：
 * 解析器會拿到一串 CSV 然後在 `JSON.parse` 失敗，而錯誤訊息會指向解析器，
 * 不會指向「探索階段挑錯了」。因此格式是**由呼叫端指定、比對不到就失敗**，沒有回退順序。
 */

/** metadata 的 `modifiedDate`：`YYYY-MM-DD HH:mm:ss`。 */
const MODIFIED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/**
 * `government_resource_id` 欄位長度（`varchar(150)`）。
 *
 * 超長時**在這裡失敗**，而不是讓 MariaDB 截斷或報錯：截斷後的網址仍然像一個網址，
 * 而它是事後追查「這一版是從哪裡抓來的」唯一的線索。
 */
const MAX_RESOURCE_ID_LENGTH = 150

export type DataGovResource = {
  /** 本次要下載的網址，同時寫進 `regulatory_dataset_versions.government_resource_id`。 */
  readonly downloadUrl: string
  /** 資源說明（`勞工保險投保薪資分級表(115年1月1日起適用)`）。只進 log 與錯誤訊息，不進資料表。 */
  readonly resourceDescription: string | null
  /**
   * 政府標示的最後修改時間，台北牆鐘 `YYYY-MM-DD HH:mm:ss`（§6）。
   *
   * **時區在這一步就確定，不留到寫入時再想**（計畫 §3.2）：data.gov.tw 是我國政府的平台，
   * 這個時戳本來就是台北時間，因此換算是**恆等**——但這句話必須寫下來，否則下一個資料集的
   * 解析器會不知道這一欄到底換算過沒有，而漏換算的症狀是時間差 8 小時、不報錯。
   *
   * 格式對不上時是 `null` 而不是失敗：這一欄在資料表上是選填，它**不是** `effective_from`
   * （後者適用計畫 §7.2 那條「推導不出就失敗」）。為了一個只供參考的時戳讓整次同步失敗，
   * 會讓真正該紅的那條規則被稀釋。
   */
  readonly sourceModifiedAt: string | null
}

export type DataGovResourceResult =
  | { readonly ok: true; readonly value: DataGovResource }
  | { readonly ok: false; readonly reason: string }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readString = (source: Record<string, unknown>, key: string): string | null => {
  const value = source[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** metadata API 的網址。`datasetId` 是穩定的數字，這是本模組唯一寫死的政府識別碼（計畫 §7.0）。 */
export const toDataGovMetadataUrl = (datasetId: number): string =>
  `https://data.gov.tw/api/v2/rest/dataset/${String(datasetId)}`

/**
 * 從 metadata 挑出指定格式的資源。
 *
 * @param rawMetadata metadata API 的原始回應內容。
 * @param resourceFormat 要哪一種格式（`JSON`／`CSV`／`XML`）。比對忽略大小寫，
 *   因為那是政府端的顯示慣例而不是語意；比對不到就失敗，不回退到別的格式（理由見檔頭）。
 *
 * 同一種格式有多筆時取**第一筆**：實測 `6258` 每種格式各只有一筆，多筆的情況代表政府改變了
 * 這個資料集的組織方式（例如一次發佈多個年度），那時挑哪一筆需要人決定，不是這裡猜。
 * 這一點刻意不做成「失敗」——多一筆同格式資源是政府端很常見的相容變更，
 * 讓同步整個停掉的代價高於取第一筆（而 `government_resource_id` 會記下實際取了哪一個）。
 */
export const selectDataGovResource = (rawMetadata: string, resourceFormat: string): DataGovResourceResult => {
  let payload: unknown
  try {
    payload = JSON.parse(rawMetadata)
  } catch (error) {
    return {
      ok: false,
      reason: `metadata 不是合法的 JSON（${error instanceof Error ? error.message : String(error)}）；開頭：${JSON.stringify(rawMetadata.slice(0, 80))}`,
    }
  }

  if (!isPlainObject(payload)) return { ok: false, reason: 'metadata 的根層不是物件' }

  const result = payload['result']
  if (!isPlainObject(result)) return { ok: false, reason: 'metadata 沒有 result 物件' }

  const distribution = result['distribution']
  if (!Array.isArray(distribution)) return { ok: false, reason: 'metadata 的 result.distribution 不是陣列' }

  const wanted = resourceFormat.toUpperCase()
  const availableFormats: string[] = []
  for (const entry of distribution) {
    if (!isPlainObject(entry)) continue
    const format = readString(entry, 'resourceFormat')
    if (format === null) continue
    availableFormats.push(format)
    if (format.toUpperCase() !== wanted) continue

    const downloadUrl = readString(entry, 'resourceDownloadUrl')
    if (downloadUrl === null) {
      return { ok: false, reason: `metadata 的 ${format} 資源沒有 resourceDownloadUrl` }
    }
    // 只走 TLS：這份內容會成為薪資結算的法定基準，明文 HTTP 的內容在傳輸途中可以被改寫，
    // 而被改寫過的分級表在系統裡與正確的分級表長得一模一樣。
    if (!downloadUrl.startsWith('https://')) {
      return { ok: false, reason: `metadata 的資源網址不是 https：${downloadUrl}` }
    }
    if (downloadUrl.length > MAX_RESOURCE_ID_LENGTH) {
      return {
        ok: false,
        reason: `資源網址長度 ${String(downloadUrl.length)} 超過 government_resource_id 的 ${String(MAX_RESOURCE_ID_LENGTH)} 字元上限：${downloadUrl}`,
      }
    }

    const modifiedDate = readString(result, 'modifiedDate')
    return {
      ok: true,
      value: {
        downloadUrl,
        resourceDescription: readString(entry, 'resourceDescription'),
        sourceModifiedAt: modifiedDate !== null && MODIFIED_DATE_PATTERN.test(modifiedDate) ? modifiedDate : null,
      },
    }
  }

  return {
    ok: false,
    reason: `metadata 的 distribution 裡沒有 ${resourceFormat} 格式的資源（實際有：${availableFormats.join('、') || '無'}）`,
  }
}
