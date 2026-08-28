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

/**
 * 探索到的**全部**該格式資源（多版本資料集用，見 {@link listDataGovResources}）。
 *
 * 與 {@link DataGovResourceResult} 分開而不是讓後者回一個陣列：單資源那四個資料集的呼叫端
 * 拿到的必須是「一個資源」，讓它們去處理一個長度可能不是 1 的陣列，等於把多版本的問題
 * 搬進一條現在是直線的路。
 */
export type DataGovResourceListResult =
  | { readonly ok: true; readonly values: readonly DataGovResource[] }
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
 * **這一支是給「一個資源 → 一個版本」的資料集用的**（`1`、`3`、`4`、`6`）。
 * `2`、`5` 的每一筆資源都是一個年度版本，要的是 {@link listDataGovResources}。
 *
 * 同一種格式有多筆時取**第一筆**：實測 `6258` 每種格式各只有一筆，多筆的情況代表政府改變了
 * 這個資料集的組織方式（例如一次發佈多個年度），那時挑哪一筆需要人決定，不是這裡猜。
 * 這一點刻意不做成「失敗」——多一筆同格式資源是政府端很常見的相容變更，
 * 讓同步整個停掉的代價高於取第一筆（而 `government_resource_id` 會記下實際取了哪一個）。
 */
/** 讀完 metadata 的外殼之後剩下的東西：資源清單 ＋ 整個資料集的最後修改時間。 */
type DataGovDistribution = {
  readonly entries: readonly Record<string, unknown>[]
  /** 台北牆鐘 `YYYY-MM-DD HH:mm:ss`；格式對不上時是 `null`（理由見 `sourceModifiedAt`）。 */
  readonly sourceModifiedAt: string | null
}

type DataGovDistributionResult =
  | { readonly ok: true; readonly value: DataGovDistribution }
  | { readonly ok: false; readonly reason: string }

/**
 * metadata 的外殼：JSON → `result.distribution`。
 *
 * 抽出來是因為 {@link selectDataGovResource} 與 {@link listDataGovResources} 的**前半段完全一樣**，
 * 而這一段正是「政府改了 metadata 的結構」時唯一會發現的地方——抄成兩份的話，
 * 其中一份哪天為了讓某個新形態通過而放寬，另一份不會跟著鬆。
 */
const readDistribution = (rawMetadata: string): DataGovDistributionResult => {
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

  const modifiedDate = readString(result, 'modifiedDate')
  return {
    ok: true,
    value: {
      entries: distribution.filter(isPlainObject),
      sourceModifiedAt: modifiedDate !== null && MODIFIED_DATE_PATTERN.test(modifiedDate) ? modifiedDate : null,
    },
  }
}

/**
 * 一筆 `distribution[]` → 一個可以下載的資源。
 *
 * 三道檢查都在這裡，兩個呼叫端因此不可能有不同的嚴格度：有沒有網址、是不是 https、
 * 長度會不會超過 `government_resource_id` 的欄位上限。
 */
const toDataGovResource = (
  entry: Record<string, unknown>,
  format: string,
  sourceModifiedAt: string | null,
): DataGovResourceResult => {
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

  return {
    ok: true,
    value: {
      downloadUrl,
      resourceDescription: readString(entry, 'resourceDescription'),
      sourceModifiedAt,
    },
  }
}

/** 沒有比對到指定格式時的說明：把實際有哪些格式印出來，那是「政府改版了」最典型的樣子。 */
const describeMissingFormat = (resourceFormat: string, availableFormats: readonly string[]): string =>
  `metadata 的 distribution 裡沒有 ${resourceFormat} 格式的資源（實際有：${availableFormats.join('、') || '無'}）`

export const selectDataGovResource = (rawMetadata: string, resourceFormat: string): DataGovResourceResult => {
  const distribution = readDistribution(rawMetadata)
  if (!distribution.ok) return distribution

  const wanted = resourceFormat.toUpperCase()
  const availableFormats: string[] = []
  for (const entry of distribution.value.entries) {
    const format = readString(entry, 'resourceFormat')
    if (format === null) continue
    availableFormats.push(format)
    if (format.toUpperCase() !== wanted) continue
    return toDataGovResource(entry, format, distribution.value.sourceModifiedAt)
  }

  return { ok: false, reason: describeMissingFormat(resourceFormat, availableFormats) }
}

/**
 * 從 metadata 挑出指定格式的**全部**資源（多版本資料集：`dataset_code=2`、`5`）。
 *
 * @param rawMetadata metadata API 的原始回應內容。
 * @param resourceFormat 要哪一種格式。比對規則與 {@link selectDataGovResource} 完全相同。
 *
 * ## 與 `selectDataGovResource` 的差別只有「取幾個」，而那個差別是資料集的性質
 *
 * `6258` 那四個資料集每種格式各只有一筆，多一筆代表政府改變了組織方式，因此那一支取第一筆。
 * `20251`（16 筆 CSV）、`20246`（19 筆 CSV）**本來就每一筆是一個年度版本**，
 * 取第一筆會讓我們永遠只看得到民國 100 年那一份。
 *
 * **順序照 metadata 原樣回傳**，不在這裡排序：排序的依據是生效日，而生效日要由資源說明推導，
 * 那是 `regulatory-multi-version-plan.ts` 的事——在這裡排等於讓 metadata 的解讀多知道一件
 * 它不需要知道的事（而且那個推導會失敗，這一層沒有表達失敗的位置）。
 *
 * **任何一筆讀不出合法網址就整批失敗**，不是「跳過壞掉的那一筆」：跳過會讓某一個年度的版本
 * 安靜地永遠不進來，而症狀是幾個月後有人問「補算 111 年的薪資怎麼查不到版本」。
 */
export const listDataGovResources = (rawMetadata: string, resourceFormat: string): DataGovResourceListResult => {
  const distribution = readDistribution(rawMetadata)
  if (!distribution.ok) return distribution

  const wanted = resourceFormat.toUpperCase()
  const availableFormats: string[] = []
  const values: DataGovResource[] = []

  for (const entry of distribution.value.entries) {
    const format = readString(entry, 'resourceFormat')
    if (format === null) continue
    availableFormats.push(format)
    if (format.toUpperCase() !== wanted) continue

    const resource = toDataGovResource(entry, format, distribution.value.sourceModifiedAt)
    if (!resource.ok) return resource
    values.push(resource.value)
  }

  if (values.length === 0) {
    return { ok: false, reason: describeMissingFormat(resourceFormat, availableFormats) }
  }

  return { ok: true, values }
}
