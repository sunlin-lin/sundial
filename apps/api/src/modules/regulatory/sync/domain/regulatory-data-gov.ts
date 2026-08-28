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
 *
 * ## 產物的型別不在這個檔案裡
 *
 * `RegulatorySourceResource` 與那三道檢查（有沒有網址、是不是 https、長度上限）住在
 * `regulatory-source-resource.ts`：`dataset_code=8`、`9` 的資源不經過 data.gov.tw，
 * 而它們要的是同一個產物與同一組檢查。理由完整寫在那個檔案的檔頭。
 */
import {
  toSourceResource,
  type RegulatorySourceResource,
  type RegulatorySourceResourceListResult,
  type RegulatorySourceResourceResult,
} from './regulatory-source-resource.ts'

/** metadata 的 `modifiedDate`：`YYYY-MM-DD HH:mm:ss`。 */
const MODIFIED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

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
 * 三道檢查不在這裡，在 {@link toSourceResource}：`8`、`9` 的資源不經過 data.gov.tw，
 * 而三個來源必須有同一組嚴格度（見 `regulatory-source-resource.ts` 檔頭）。
 */
const toDataGovResource = (
  entry: Record<string, unknown>,
  format: string,
  sourceModifiedAt: string | null,
): RegulatorySourceResourceResult =>
  toSourceResource(
    {
      downloadUrl: readString(entry, 'resourceDownloadUrl'),
      resourceDescription: readString(entry, 'resourceDescription'),
      sourceModifiedAt,
    },
    `metadata 的 ${format} 資源`,
  )

/** 沒有比對到指定格式時的說明：把實際有哪些格式印出來，那是「政府改版了」最典型的樣子。 */
const describeMissingFormat = (resourceFormat: string, availableFormats: readonly string[]): string =>
  `metadata 的 distribution 裡沒有 ${resourceFormat} 格式的資源（實際有：${availableFormats.join('、') || '無'}）`

export const selectDataGovResource = (rawMetadata: string, resourceFormat: string): RegulatorySourceResourceResult => {
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
export const listDataGovResources = (rawMetadata: string, resourceFormat: string): RegulatorySourceResourceListResult => {
  const distribution = readDistribution(rawMetadata)
  if (!distribution.ok) return distribution

  const wanted = resourceFormat.toUpperCase()
  const availableFormats: string[] = []
  const values: RegulatorySourceResource[] = []

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
