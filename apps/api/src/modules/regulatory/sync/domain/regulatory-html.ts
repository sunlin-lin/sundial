/**
 * 政府網頁的讀取（零 IO 純函式，§0.1）。`dataset_code=8`、`9` 用，其餘七個資料集用不到。
 *
 * ## 為什麼會有這個檔案：這兩個資料集**只有網頁**
 *
 * 前六個資料集全部走 data.gov.tw 的 metadata API，產物是 JSON。這兩個沒有那條路（計畫 §7.0）：
 *
 * - `8` 最低工資：data.gov.tw 的 `6281` **內容停在民國 113 年**、卻仍顯示 2026 年的
 *   `modifiedDate`——自動同步會成功、拿到一個完全合理的舊值、不報任何錯，比沒有資料更危險。
 *   可用的來源是勞動部的公告頁，而那是一頁 HTML。
 * - `9` 薪資所得扣繳稅額表：data.gov.tw 的 `25627` 只有當年度一份，且 title／description／
 *   資源名稱／`coverageStartedDate` 四處都沒有年度，單靠它推不出生效日。可用的來源是財政部
 *   臺北國稅局的 Open Data 下載專區，而那也是一頁 HTML。
 *
 * ## 失敗的方向必須是「抓不到」，不是「抓到錯的值」
 *
 * 這是爬 HTML 與讀 JSON 最大的差別，也是本檔每一支函式的設計依據：**頁面改版時，
 * 我們要的是「一則公告都找不到」而不是「找到一則長得不太一樣的公告」。**
 * 因此三支函式全部是「找不到就回空的／回 null」，而呼叫端把「空的」一律當成失敗
 * （見 `regulatory-minimum-wage.ts` 與 `regulatory-withholding-tax.ts` 的資源探索）。
 *
 * 反過來說，本檔**刻意不做任何補救**：不修補未閉合的標籤、不猜屬性的邊界、不容忍大小寫以外的變形。
 * 一台會盡力猜的 HTML parser 在頁面改版時最可能的結果，正是「抓到一個看起來合理的錯東西」。
 *
 * ## 為什麼不引一個 HTML parser 套件
 *
 * 需要的只有三件事：切出內容區塊、列出 `<li>`、列出 `<a>` 的三個欄位。
 * 一個完整的 DOM parser 會**多做**很多事——最要命的是它會替我們修補壞掉的標籤，
 * 而那正好把上一段那條規則反過來。另外它也是一個新的執行期相依（§1.1）。
 */

/**
 * HTML 實體的最小集合。
 *
 * **刻意只解這六個**：它們是政府 CMS 實際會輸出的（`&amp;` 出現在網址、`&nbsp;` 出現在條列之間）。
 * 認不得的實體**原樣留著**，於是它若出現在金額或日期裡，句型比對就會失敗——
 * 那正是要的方向。做一台通用的實體解碼器等於替頁面改版預先補好破口。
 */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** 一組標籤（含屬性）。`[^>]*` 不跨 `>`，因此屬性值裡有 `>` 時會停在錯的位置——見下方說明。 */
const HTML_TAG_PATTERN = /<[^>]*>/g

/** 連續空白（含全形空白與換行）壓成一個半形空白。 */
const WHITESPACE_RUN_PATTERN = /[\s　]+/g

/**
 * 一段 HTML → 純文字：去掉標籤、解實體、把連續空白壓成一個空白、去頭尾空白。
 *
 * ⚠️ **屬性值裡若出現 `>`，這一支會切錯位置**（`<a title="a>b">` 會被切成兩半）。
 * 這是已知且**刻意不處理**的：政府那兩頁的屬性值裡沒有 `>`（實測），
 * 而真的出現時的結果是文字裡多出一段 `b">`，於是句型比對失敗——同樣是「抓不到」的方向。
 * 要正確處理就得引進一台會做狀態追蹤的 parser，而那台 parser 也會順手修補別的東西。
 */
export const toPlainText = (fragment: string): string => {
  const withoutTags = fragment.replace(HTML_TAG_PATTERN, '')
  const decoded = Object.entries(HTML_ENTITIES).reduce(
    (text, [entity, character]) => text.replaceAll(entity, character),
    withoutTags,
  )
  return decoded.replace(WHITESPACE_RUN_PATTERN, ' ').trim()
}

/**
 * 切出 `open` 與其後第一個 `close` 之間那一段（不含兩端的標記本身）。
 *
 * @param html 整頁原始碼。
 * @param open 開頭標記，**逐字比對**（`<section class="cp">`）。
 * @param close 結尾標記（`</section>`）。
 *
 * 找不到開頭、或開頭之後找不到結尾時回 `null`，呼叫端一律當成「頁面結構已變更」的失敗。
 *
 * **取「其後第一個」結尾標記，因此不支援巢狀。** 兩頁的內容區塊裡都沒有巢狀的同名標籤（實測），
 * 而真的巢狀時我們會少切一段——結果是條列變少甚至一則都沒有，仍然是「抓不到」的方向。
 * 寫一個會數層數的版本要多一台狀態機，而它的失敗方向是「多切一段」，比較糟。
 */
export const sliceHtmlBetween = (html: string, open: string, close: string): string | null => {
  const start = html.indexOf(open)
  if (start === -1) return null
  const from = start + open.length
  const end = html.indexOf(close, from)
  if (end === -1) return null
  return html.slice(from, end)
}

/** `<li …>` … `</li>`。非貪婪，因此巢狀 `<li>` 會切在內層——兩頁都沒有巢狀清單（實測）。 */
const LIST_ITEM_PATTERN = /<li\b[^>]*>([\s\S]*?)<\/li>/g

/** 列出一段 HTML 裡每一個 `<li>` 的**內層原始碼**（還沒去標籤，因為呼叫端可能要讀裡面的 `<a>`）。 */
export const listHtmlListItems = (html: string): readonly string[] =>
  [...html.matchAll(LIST_ITEM_PATTERN)].map((matched) => matched[1] ?? '')

/** `<a href="…" title="…">…</a>`。`title` 選填（政府那一頁每一個都有，但屬性順序不是我們能保證的事）。 */
const ANCHOR_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a>/g

/** 從一段標籤屬性裡取一個雙引號屬性值。單引號的寫法回 `null`——政府那兩頁都是雙引號（實測）。 */
const readAttribute = (attributes: string, name: string): string | null => {
  const matched = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)
  return matched === null ? null : (matched[1] ?? null)
}

export type HtmlAnchor = {
  /** `href` 原值（可能是相對路徑）。組成絕對網址是呼叫端的事——不同來源的網域不同。 */
  readonly href: string | null
  /** `title` 屬性，已解實體。財政部下載專區把**檔名**放在這裡，那是該資料集的資源名稱。 */
  readonly title: string | null
  /** 連結文字，已去標籤與解實體。 */
  readonly text: string
}

/**
 * 列出一段 HTML 裡的每一個 `<a>`。
 *
 * 三個欄位都回傳，由呼叫端決定哪一個才是「這個資源的名字」——
 * `dataset_code=9` 用的是 `title`（檔名），不是 `text`（版面上的短標籤），理由寫在那支解析器裡。
 */
export const listHtmlAnchors = (html: string): readonly HtmlAnchor[] =>
  [...html.matchAll(ANCHOR_PATTERN)].map((matched) => {
    const attributes = matched[1] ?? ''
    const title = readAttribute(attributes, 'title')
    return {
      href: readAttribute(attributes, 'href'),
      title: title === null ? null : toPlainText(title),
      text: toPlainText(matched[2] ?? ''),
    }
  })
