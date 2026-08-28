/**
 * `dataset_code = 9` 薪資所得扣繳稅額表的來源探索與解析器（零 IO 純函式，§0.1）。
 *
 * 來源：財政部臺北國稅局「Open Data 下載專區」列表頁，**不是** data.gov.tw `25627`
 * （2026-08 實地查證）。列表頁上那一項長這樣：
 *
 * ```html
 * <li>財政部臺北國稅局薪資所得扣繳稅額表_CSV
 *   [<a href="/download/15dbf…" title="財政部臺北國稅局107年度薪資所得扣繳稅額表 [CSV]">107</a>]、
 *   …
 *   [<a href="/download/aeb91…" title="財政部臺北國稅局薪資所得扣繳稅額表_115年度.csv">115</a>]</li>
 * ```
 *
 * ## 為什麼不用 data.gov.tw `25627`
 *
 * 它只有**當年度一份**，而且 title／description／資源名稱／`coverageStartedDate`
 * **四處都沒有年度**——單靠它推不出生效日，依 §7.2 只能一律失敗，也就是根本做不出來（計畫 §7.0）。
 *
 * **而且它其實就指向這裡**：`25627` 的 `resourceDownloadUrl` 實測正是
 * `https://www.ntbt.gov.tw/download/aeb91f07592c48a5bc8b4d0aa7c34bdf`，
 * 也就是下載專區列表上「115」那一個。用列表頁不是繞路，是**回到那份資料真正的所在**，
 * 而副作用是好的：**歷史版本可以一次回補**（107–115）。
 *
 * ## 年度取自連結的 `title`（＝檔名），**不是**連結文字
 *
 * 這是本檔第二重要的決定。兩者都在頁面上：`title` 是檔名
 * （`財政部臺北國稅局薪資所得扣繳稅額表_115年度.csv`），連結文字是版面上的短標籤（`115`）。
 *
 * 用 `title` 的理由是**連結文字不自足**：同一頁上「財政部臺北國稅局扣免繳申報收件統計表」那一項
 * 的連結文字也是 `107`、`111`…（實測）。三個數字本身連「這是哪一份資料」都沒有說，
 * 因此拿它當版本的識別，等於**用版面而不是用資源本身識別版本**——哪天我們把 `<li>` 的定位寫壞了，
 * 抓到的會是另一個資料集的年度標籤，而每一個值單獨看都完全合法。
 * `title` 是這一份檔案自己的名字，角色與 data.gov.tw 的 `resourceDescription` 完全相同。
 *
 * ⚠️ **代價要寫清楚：民國 108 年度那一個的 `title` 沒有年度**（實測就是 `薪資所得扣繳稅額表[CSV]`），
 * 因此它**不是候選**，會被排除並計入同步摘要（計畫 §7.1.2）。
 * 順帶一提，那一份在政府端其實已經下架（`/download/…` 實測回 307 轉址到首頁），
 * 但**排除的理由是名稱，不是下載結果**——「下載得到嗎」不能當候選判準，
 * 那會讓「政府哪天把某一年的檔案搬走」變成看不見的資料缺口，而不是一筆有 `error_message` 的失敗。
 *
 * 加上列表頁本來就缺的民國 110 年度，本資料集實際涵蓋 **107、109、111–115 共七個年度**。
 * 108 與 110 那兩年查不到版本——而那是明確的錯誤，不是安靜的錯值（見下一段）。
 *
 * ## 這個資料集有 `effective_to`，而且它是必要的
 *
 * 其餘八個資料集的版本都是「沿用到下一版為止」，`effective_to` 一律 `null`（計畫 §3.2 (d)）。
 * 扣繳稅額表不是：**「115年度」四個字本身就宣告了它管到 2026-12-31 為止**，那是政府明示的失效日。
 *
 * 少了它的後果很具體：`resolve` 取的是 `effective_from <= asOfDate` 裡最新的一版，
 * 於是補算民國 110 年度的薪資會挑到 **109 年度**那一張表，回一個完全合理、不會報錯的錯誤稅額。
 * 有了訖日就會查不到版本，而查不到會有人來看，算錯不會。
 * 推導在 `regulatory-roc-date.ts` 的 `parseRocFiscalYear`。
 *
 * ## CSV 的兩件事：**帶引號**，而且表頭有兩代
 *
 * 每一列的第一欄是 `"80,001 ~ 80,500"`——加引號正是因為值裡有逗號，因此本資料集宣告
 * `quoting: 'rfc4180'`（見 `regulatory-csv.ts` 檔頭：引號處置是呼叫端必須明講的期望）。
 *
 * 表頭在民國 112 年度加上了單位：`配偶及受扶養親屬計0人` → `配偶及受扶養親屬計0人(元)`（實測）。
 * 兩種都接受**不是寬容**：107–111 那幾份是**已經凍結的歷史檔案**，永遠不會再變，
 * 因此這裡是把兩個已知常數都寫出來，而不是放寬一個 pattern。第三種寫法一律失敗。
 */
import type { RegulatoryRecordData } from '../../datasets/regulatory-datasets.service.ts'
import { WITHHOLDING_TAX_DEPENDENT_COUNTS } from '../../datasets/domain/regulatory-record-shape.ts'
import { INTEGER_AMOUNT_PATTERN, normalizeAmount } from './regulatory-amount.ts'
import { parseCsvTable, readCsvField } from './regulatory-csv.ts'
import { listHtmlAnchors, listHtmlListItems, toPlainText } from './regulatory-html.ts'
import { parseRocFiscalYear } from './regulatory-roc-date.ts'
import type {
  ParsedRegulatoryRecord,
  RegulatoryEffectiveFromResult,
  RegulatoryRecordsResult,
} from './regulatory-sync-model.ts'
import { toSourceResource, type RegulatorySourceResourceListResult } from './regulatory-source-resource.ts'

/** `dataset_code=9` 的 `data` 形狀（唯一來源在 `datasets/domain/regulatory-record-shape.ts`）。 */
type WithholdingTaxBracket = RegulatoryRecordData<9>

/** 財政部臺北國稅局的網站根，用來把列表頁上的相對路徑（`/download/…`）組成絕對網址。 */
const NTBT_ORIGIN = 'https://www.ntbt.gov.tw'

/**
 * 下載專區列表頁。**這是這個資料集唯一寫死的政府位址**（沒有 metadata API 可以探索）。
 *
 * 頁面搬家的形式是 404 或找不到下面那一項的標籤，兩者都會讓探索失敗，而不是抓到別的東西。
 */
export const WITHHOLDING_TAX_PAGE_URL =
  'https://www.ntbt.gov.tw/singlehtml/6616b48a1f5a4eeca22d41fe18278b30?cntId=bd9a7bc26c7f4e82bd53602ee58b2d4d'

/**
 * 列表頁上那一項的標籤，**逐字比對**。
 *
 * 這是整支探索唯一的定位點，因此它必須指得夠準：那一頁有 134 個 `<li>`（實測），
 * 其中好幾項的連結文字也是三位民國年（`扣免繳申報收件統計表` 的 107–114）。
 * 標籤改了 → 找不到 → 失敗，而不是抓到隔壁那一項的八個年度。
 */
const DATASET_LABEL = '財政部臺北國稅局薪資所得扣繳稅額表_CSV'

/** 下載連結的路徑前綴。與 data.gov.tw `25627` 指向的網址形式相同（實測）。 */
const DOWNLOAD_PATH_PREFIX = '/download/'

/**
 * 資源探索：列表頁 HTML → 每一個年度連結一個「資源」。
 *
 * `resourceDescription` 放的是連結的 `title`（＝檔名），理由見檔頭。
 * **`title` 是 `null` 的連結也一起回傳**：候選判準統一由 {@link deriveWithholdingTaxEffectiveFrom} 執行，
 * 於是被排除的數量會經過 `planMultiVersionSync` 進到同步摘要（計畫 §7.1.2 要求排除不得靜默）。
 */
export const listWithholdingTaxResources = (pageHtml: string): RegulatorySourceResourceListResult => {
  const item = listHtmlListItems(pageHtml).find((candidate) => toPlainText(candidate).startsWith(DATASET_LABEL))
  if (item === undefined) {
    return { ok: false, reason: `下載專區列表頁找不到「${DATASET_LABEL}」這一項：頁面結構或項目名稱已變更` }
  }

  const values = []
  for (const anchor of listHtmlAnchors(item)) {
    // 只認 `/download/…` 這一種連結：那一項裡若混進說明用的外部連結，我們不會把它當成一個年度檔案。
    if (anchor.href === null || !anchor.href.startsWith(DOWNLOAD_PATH_PREFIX)) continue

    const resource = toSourceResource(
      { downloadUrl: `${NTBT_ORIGIN}${anchor.href}`, resourceDescription: anchor.title, sourceModifiedAt: null },
      '下載專區的年度連結',
    )
    if (!resource.ok) return resource
    values.push(resource.value)
  }

  if (values.length === 0) {
    return { ok: false, reason: `「${DATASET_LABEL}」這一項裡一個 ${DOWNLOAD_PATH_PREFIX} 連結都沒有：頁面結構已變更` }
  }

  return { ok: true, values }
}

/**
 * 生效日推導**與候選判準**（計畫 §7.2 ＋ §7.1.2 在本資料集上的落點）。
 *
 * | 資源名稱（連結的 `title`） | 結局 |
 * |---|---|
 * | 沒有 `title`，或 title 裡沒有「N年度」（實測：民國 108 年度那一個） | **不是候選**，排除並計數 |
 * | 有「N年度」但不是合法民國年 | **失敗**：檔名的寫法變了，要有人去看 |
 * | `…_115年度.csv` | 生效日 `2026-01-01`、**失效日 `2026-12-31`** |
 *
 * 「N年度」讀成一整年**不是猜**：所得稅按年度課徵，一個年度一張表，年度的邊界就是 1/1 到 12/31。
 * 這與 `dataset_code=2` 的「100年」不同（那一年可能有兩次調整，因此推不出唯一的生效日）
 * ——完整論述在 `regulatory-roc-date.ts` 的 `parseRocFiscalYear`。
 */
export const deriveWithholdingTaxEffectiveFrom = (resourceDescription: string | null): RegulatoryEffectiveFromResult => {
  if (resourceDescription === null) {
    return { ok: false, excluded: true, reason: '這個下載連結沒有 title（檔名），無從得知它是哪一個年度' }
  }

  const fiscalYear = parseRocFiscalYear(resourceDescription, '資源名稱')
  if (!fiscalYear.ok) {
    // 「名稱裡沒有『N年度』」與「有但不合法」是兩件事：前者是這個列表頁已知的形態
    //（政府那一個檔名就是沒寫年度），後者代表檔名的寫法改了。
    const hasFiscalYearWord = resourceDescription.includes('年度')
    return {
      ok: false,
      excluded: !hasFiscalYearWord,
      reason: hasFiscalYearWord
        ? fiscalYear.reason
        : `資源名稱裡沒有「N年度」，推導不出這一份是哪一個年度，不在候選範圍：${JSON.stringify(resourceDescription)}`,
    }
  }

  return { ok: true, effectiveFrom: fiscalYear.from, effectiveTo: fiscalYear.to }
}

/**
 * 形狀的欄位 → 政府 CSV 的第一欄欄位名。**逐字寫出來**：欄位改名要當場失敗，
 * 不要靜靜地讀到 `undefined`。
 *
 * `satisfies Record<Exclude<…>, string>` 讓兩邊**總對總**。被排除的三欄各有理由，
 * **排除是寫出來的動作，不是忘了列**：
 *
 * - `monthlySalaryFrom`／`monthlySalaryTo` 是從 `每月薪資所得` **拆出來**的，來源裡沒有對應欄位；
 * - `taxByDependentCount` 對應的不是一欄，是**十二欄**，由 {@link WITHHOLDING_TAX_DEPENDENT_COUNTS}
 *   逐一組出來（見 {@link toHeader}）。
 */
const FIELD = {
  monthlySalaryRangeText: '每月薪資所得',
} as const satisfies Record<
  Exclude<keyof WithholdingTaxBracket, 'monthlySalaryFrom' | 'monthlySalaryTo' | 'taxByDependentCount'>,
  string
>

/**
 * 表頭的兩代。**兩個都是已經凍結的歷史寫法，不是「兩種都容忍」**（見檔頭）。
 *
 * 值是扶養人數欄位的單位後綴：民國 112 年度起加上了 `(元)`，107–111 沒有。
 * 寫成常數陣列而不是「有沒有都行」的 pattern：第三種寫法出現時，表頭比對會失敗並把
 * 兩代的期望值都印進 `error_message`，而那正是我們要有人去看一眼的時刻。
 */
const HEADER_UNIT_GENERATIONS = ['(元)', ''] as const

/** 某一代表頭的完整欄位清單。第一欄是薪資區間，其後十二欄依扶養人數 0…11。 */
const toHeader = (unit: string): readonly string[] => [
  FIELD.monthlySalaryRangeText,
  ...WITHHOLDING_TAX_DEPENDENT_COUNTS.map((count) => `配偶及受扶養親屬計${String(count)}人${unit}`),
]

/**
 * 每月薪資所得的區間句型：`80,001 ~ 80,500`。**兩端都必須有**。
 *
 * ## 為什麼不放進 `regulatory-amount.ts`
 *
 * 那個檔案的區間模型是「N以下／N至N／N以上」三種句型的一組，也就是**允許開放的一端**。
 * 扣繳稅額表沒有開放的一端（最低一級是 `80,001 ~ 80,500`、最高一級是 `499,501 ~ 500,000`），
 * 而把它塞進那個模型等於讓「80,001以下」變成一個**讀得懂**的形態——
 * 那一種在這張表上代表政府改了組織方式，必須失敗。
 *
 * 去逗號與整數檢查仍然共用那個檔案的 `normalizeAmount`／`INTEGER_AMOUNT_PATTERN`，
 * 於是「金額怎麼讀」這件事沒有第二份實作。
 */
const SALARY_RANGE_PATTERN = /^(\d[\d,]*) ~ (\d[\d,]*)$/

/**
 * 這張表最高一級的上限：50 萬元。
 *
 * ## 這是尾端錨定，而它是唯一擋得住「表被截短」的東西
 *
 * 級距連續性（上一級的上限 ＋1 ＝ 這一級的下限）擋得住中間少一列，但擋不住**尾巴少一截**
 * ——被截短的表最後一列仍然是一個完全正常的封閉級距，型別、驗證、資料庫層全部合法，
 * 只是月薪高於它的人從此查不到任何一級。
 *
 * 實測 107、109、111–115 七個年度**全部**以 `499,501 ~ 500,000` 結束（超過 50 萬另依公式計算，
 * 不在這張表上）。政府哪天把表延伸到 60 萬時，這一行會讓同步失敗一次、要有人來改這個常數
 * ——**那是要的**：表的涵蓋範圍變了，是必須有人知道的事。
 */
const HIGHEST_BRACKET_UPPER_BOUND = '500000'

/** UTF-8 BOM。財政部那七份沒有帶（實測），但表頭偵測不該假設這件事。 */
const BYTE_ORDER_MARK = '﻿'

/**
 * 這一份 CSV 用的是哪一代表頭。
 *
 * 讀第一列自己比對一次，而不是拿兩代分別餵給 `parseCsvTable` 試：後者在「表頭是第一代、
 * 但第 500 列的欄位數不對」時會先以列錯誤失敗、再以表頭錯誤失敗，最後報出來的是
 * 「兩代都對不上」——一句與真正成因無關的話。
 */
const selectHeader = (rawText: string): readonly string[] | null => {
  const withoutBom = rawText.startsWith(BYTE_ORDER_MARK) ? rawText.slice(BYTE_ORDER_MARK.length) : rawText
  const [headerLine = ''] = withoutBom.split(/\r?\n/, 1)
  const actual = headerLine.split(',').map((cell) => cell.trim())

  return (
    HEADER_UNIT_GENERATIONS.map(toHeader).find(
      (header) => actual.length === header.length && header.every((name, index) => name === actual[index]),
    ) ?? null
  )
}

/** 一列的十二個稅額。整批成功或整批失敗，理由同 `RegulatoryRecordsResult`。 */
type TaxAmountsResult = { readonly ok: true; readonly value: readonly string[] } | { readonly ok: false; readonly reason: string }

const readTaxAmounts = (
  row: Readonly<Record<string, string>>,
  header: readonly string[],
  position: string,
): TaxAmountsResult => {
  const amounts: string[] = []

  for (const count of WITHHOLDING_TAX_DEPENDENT_COUNTS) {
    // 欄位名由同一份清單推導（`+1` 是因為第一欄是薪資區間），因此不可能讀到表頭以外的名字。
    const field = header[count + 1] ?? ''
    const raw = readCsvField(row, field)
    const amount = raw === null ? null : normalizeAmount(raw)
    if (amount === null || !INTEGER_AMOUNT_PATTERN.test(amount)) {
      return { ok: false, reason: `${position}的「${field}」不是整數金額：${JSON.stringify(raw)}` }
    }
    // 完整性檢查：**扣繳稅額不會因為多一個扶養親屬而變高**。這一條不需要引進任何法規知識
    // ——十二個數字都在同一列裡，對不起來就是欄位換了位置或我們讀錯了欄，
    // 而換位置之後每一個值單獨看都完全合法（都是幾萬塊的整數）。實測七個年度、每一列都成立。
    const previous = amounts[amounts.length - 1]
    if (previous !== undefined && BigInt(amount) > BigInt(previous)) {
      return {
        ok: false,
        reason:
          `${position}的「${field}」是 ${amount}，比扶養人數少一人的 ${previous} 還高：` +
          '扣繳稅額不該隨扶養人數上升，欄位可能錯位',
      }
    }
    amounts.push(amount)
  }

  return { ok: true, value: amounts }
}

/**
 * 解析薪資所得扣繳稅額表。
 *
 * @param rawText 政府 CSV 資源的原始內容（未經任何前處理，與寫進 `raw_data` 的是同一串）。
 *
 * ## `record_key` 為什麼是 `salary-{級距下限}`
 *
 * 資料字典要求 `record_key` 在**同一版本內唯一**、且**跨版本穩定**。
 *
 * - **不能用列序**：政府哪一年把起扣的第一列從 81,001 改成 80,001（實測 111 年度就改了），
 *   後面每一列的序號整批位移，於是跨版本比對會說「每一級的稅額都變了」。
 * - **級距下限是這一列的內容識別**：「月薪 80,001 到 80,500 這一段」在每一個年度問的都是同一件事。
 *   級距寬度固定 500 元（實測七個年度皆然），因此下限與上限一對一，取下限就夠。
 * - **不用區間原文**：`80,001 ~ 80,500` 帶著千分位與空白，而那是排版，不是識別。
 *
 * 前綴 `salary-` 是刻意的：純數字的 key 看起來像一個可以拿去比大小的量，而它是一個識別碼
 * （同 `dataset_code=2` 的 `amount-`）。
 */
export const parseWithholdingTaxTable = (rawText: string): RegulatoryRecordsResult => {
  const header = selectHeader(rawText)
  if (header === null) {
    return {
      ok: false,
      reason:
        '薪資所得扣繳稅額表的 CSV 表頭不是已知的兩代之一（政府改了欄位名、欄位順序或欄位數）。期望：' +
        HEADER_UNIT_GENERATIONS.map((unit) => toHeader(unit).join(',')).join('；或 '),
    }
  }

  // 第一欄的值裡有逗號，因此政府用引號包住它——本資料集宣告 `rfc4180`（見 `regulatory-csv.ts` 檔頭）。
  const table = parseCsvTable(rawText, { header, quoting: 'rfc4180', label: '薪資所得扣繳稅額表' })
  if (!table.ok) return { ok: false, reason: table.reason }

  const { rows } = table
  const records: ParsedRegulatoryRecord[] = []
  const seenKeys = new Set<string>()
  /** 上一級的級距上限，供「首尾相接」檢查。第一級之前沒有上一級。 */
  let previousRangeTo: string | null = null
  /** 上一列的十二個稅額，供「稅額不隨薪資下降」檢查。 */
  let previousAmounts: readonly string[] | null = null

  for (const [index, row] of rows.entries()) {
    const position = `第 ${String(index + 1)} 列`

    const rangeText = readCsvField(row, FIELD.monthlySalaryRangeText)
    if (rangeText === null) return { ok: false, reason: `${position}缺少「${FIELD.monthlySalaryRangeText}」` }

    const matched = SALARY_RANGE_PATTERN.exec(rangeText)
    if (matched === null) {
      return {
        ok: false,
        reason: `${position}的「${FIELD.monthlySalaryRangeText}」區間句型無法辨識（期望「N ~ N」，兩端都要有）：${JSON.stringify(rangeText)}`,
      }
    }

    const from = normalizeAmount(matched[1] ?? '')
    const to = normalizeAmount(matched[2] ?? '')
    if (!INTEGER_AMOUNT_PATTERN.test(from) || !INTEGER_AMOUNT_PATTERN.test(to)) {
      return { ok: false, reason: `${position}的「${FIELD.monthlySalaryRangeText}」金額不是整數：${JSON.stringify(rangeText)}` }
    }
    if (BigInt(from) > BigInt(to)) {
      // 上下限顛倒代表兩欄對調了。兩個值單獨看都合法，而級距查詢會變成一個永遠命不中的區間。
      return { ok: false, reason: `${position}的「${FIELD.monthlySalaryRangeText}」下限大於上限：${JSON.stringify(rangeText)}` }
    }

    // 完整性檢查（一）：上一級的上限 ＋ 1 ＝ 這一級的下限。
    // 政府刪掉中間一列時，每一個值單獨看都合法，只有這一條會發現金額上的缺口。
    if (previousRangeTo !== null) {
      const expectedFrom = BigInt(previousRangeTo) + 1n
      if (BigInt(from) !== expectedFrom) {
        return {
          ok: false,
          reason:
            `${position}的「${FIELD.monthlySalaryRangeText}」下限是 ${from}，` +
            `但上一級的上限是 ${previousRangeTo}（期望 ${expectedFrom.toString()}）：` +
            '級距之間出現缺口或重疊，落在缺口裡的薪資查不到任何一級',
        }
      }
    }
    previousRangeTo = to

    const amounts = readTaxAmounts(row, header, position)
    if (!amounts.ok) return { ok: false, reason: amounts.reason }

    // 完整性檢查（二）：**同樣的扶養人數下，薪資高一級的稅額不會比較低。**
    // 與（一）互補：（一）看區間、這一條看內容，而列被重新排序時只有這一條會發現
    //（重排之後級距仍然各自合法，只是接不起來——除非重排的剛好是等寬的相鄰列）。
    if (previousAmounts !== null) {
      for (const count of WITHHOLDING_TAX_DEPENDENT_COUNTS) {
        const current = amounts.value[count] ?? ''
        const previous = previousAmounts[count] ?? ''
        if (BigInt(current) < BigInt(previous)) {
          return {
            ok: false,
            reason:
              `${position}在扶養 ${String(count)} 人時的稅額 ${current} 低於上一級的 ${previous}：` +
              '薪資較高的級距不該扣得比較少，列的順序或內容可能不對',
          }
        }
      }
    }
    previousAmounts = amounts.value

    const recordKey = `salary-${from}`
    if (seenKeys.has(recordKey)) {
      // 撞 key 代表同一個級距下限出現兩次。放行的話會在寫入時撞
      // `UNIQUE(dataset_version_id, record_key)`，而那時只會看到一句 SQL 唯一鍵違反。
      return { ok: false, reason: `${position}的 record_key 重複：${recordKey}` }
    }
    seenKeys.add(recordKey)

    const data: WithholdingTaxBracket = {
      monthlySalaryRangeText: rangeText,
      monthlySalaryFrom: from,
      monthlySalaryTo: to,
      taxByDependentCount: [...amounts.value],
    }

    records.push({
      recordKey,
      // 這張表沒有級數也沒有代碼欄位（政府那一份只有薪資區間與十二個稅額），
      // 因此 `code`／`name` 沒有對應物——硬塞一個列序進去會讓它看起來像一個穩定的代碼。
      code: null,
      name: null,
      rangeFrom: from,
      rangeTo: to,
      // `amount` 沒有對應物：這一列有**十二個**稅額，取其中一個放進來就是替 Payroll 決定
      // 「預設扶養幾人」，而那不是這一層能決定的事。十二個都在 `data.taxByDependentCount` 裡。
      amount: null,
      // 本資料集是稅額表不是稅率表：政府把每一格的金額都算好了，沒有費率欄位。
      rate: null,
      data,
      sortOrder: index + 1,
    })
  }

  // 完整性檢查（三）：尾端錨定。理由見 {@link HIGHEST_BRACKET_UPPER_BOUND}。
  if (previousRangeTo !== HIGHEST_BRACKET_UPPER_BOUND) {
    return {
      ok: false,
      reason:
        `最後一級的上限是 ${String(previousRangeTo)}，期望 ${HIGHEST_BRACKET_UPPER_BOUND}：` +
        '這張表被截短了，或政府改了它的涵蓋範圍（月薪高於最後一級的人會查不到任何一級）',
    }
  }

  return { ok: true, records }
}
