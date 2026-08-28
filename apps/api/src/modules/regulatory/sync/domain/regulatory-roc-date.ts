/**
 * 民國日期 → 西元日曆日（零 IO 純函式，§0.1）。
 *
 * 政府資料裡的日期幾乎都是民國年，而且是**沒有分隔符號的一串數字**：
 * `1150101` = 民國 115 年 1 月 1 日 = 西元 2026-01-01。勞保投保薪資分級表（`dataset_code=1`）的
 * `適用起日` 就是這個形態，而那一欄是整個版本的 `effective_from` 唯一的來源（計畫 §7.0）。
 *
 * ## 為什麼要一支獨立的純函式，而不是在解析器裡寫一行 `Number(...)`
 *
 * 這是計畫 §7.2 那條規則落到程式碼上的位置：**推導不出生效日一律失敗，不得猜。**
 * 一行 `+1911` 的寫法在遇到 `1150001`（月份 0）、`1140229`（民國 114 年不是閏年）這種值時
 * 不會拋錯，只會算出一個 `2026-00-01`／`2025-02-29`——**任何日期看起來都是合理的日期**，
 * 沒有一個斷言能說它不對，而它會被寫進 `effective_from`，悄悄改變「這個資料集現在該算哪一版」。
 *
 * 因此本檔的回傳值是一個**可辨識聯集**：不處理失敗分支就取不到日期字串，編譯不過。
 *
 * ## 一律回字串，全程不經過 `Date`
 *
 * `Date` 一定帶時區，換算一旦進到流程裡就有漏換算與換錯方向的可能，而錯的形式是「日期差一天」
 * ——對法規版本而言那就是「跨年那一天用錯版本」（§6，同 `db/schema` 對 `effective_from` 的處置）。
 * 這裡從頭到尾只做整數運算與字串組裝，閏年規則自己算（見 {@link daysInMonth}）。
 */

/** 民國元年（1912）對應的西元年減一。民國 N 年 = 西元 N + 1911。 */
const ROC_EPOCH_OFFSET = 1911

const MONTHS_PER_YEAR = 12

/**
 * 各月天數（1 月起）。2 月由 {@link daysInMonth} 依閏年規則覆寫。
 *
 * 寫成常數表而不是 `new Date(year, month, 0).getDate()`：後者要建一個 `Date`，
 * 而本檔存在的理由之一就是全程不碰 `Date`（見檔頭）。
 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/**
 * 西元年的閏年規則：四年一閏、百年不閏、四百年再閏。
 *
 * **必須是完整的三條規則**，不能只寫 `year % 4 === 0`：1900 與 2100 都不是閏年，
 * 而少了後兩條在 2100-02-29 那一天才會發作——那時沒有人記得這裡曾經簡化過。
 */
const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0)

/**
 * 轉換結果。
 *
 * **失敗分支帶 `reason` 而不是回 `null`**：這個字串最後會進 `regulatory_sync_logs.error_message`，
 * 而那是事後要回答「為什麼那三天沒同步」時唯一的線索（計畫 §3.4）。回 `null` 的話，
 * 記錄裡只剩一句「解析失敗」，看的人分不出是格式變了、還是某一列的日期壞了。
 */
export type RocDateResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string }

/** `YYYMMDD`（民國年三位）或 `YYMMDD`（民國 100 年以前的兩位年）。 */
const ROC_COMPACT_PATTERN = /^(\d{2,3})(\d{2})(\d{2})$/

const pad2 = (value: number): string => String(value).padStart(2, '0')

/**
 * 民國 `YYYMMDD` → 西元 `YYYY-MM-DD`。
 *
 * @param value 政府資料裡的原字串，例如 `1150101`。前後空白會先去掉——政府的 CSV／JSON
 *   偶爾帶著補齊欄寬的空白，而那不是「格式變了」，只是空白。
 *
 * 接受 6 碼與 7 碼兩種長度：民國 100 年以前是 `YYMMDD`（`991231` = 1910-12-31）。
 * **不接受其他長度**，尤其不接受 8 碼——`20260101` 是西元寫法，把它當民國會算出 2027 年，
 * 那正是本檔要防的「看起來完全合理的錯日期」。
 *
 * 民國元年是第 1 年，沒有第 0 年，因此 `year >= 1`（`0000101` 一律失敗）。
 */
export const parseRocCompactDate = (value: string): RocDateResult => {
  const trimmed = value.trim()
  const matched = ROC_COMPACT_PATTERN.exec(trimmed)
  if (matched === null) {
    return { ok: false, reason: `民國日期格式無法辨識（期望 YYMMDD 或 YYYMMDD）：${JSON.stringify(value)}` }
  }

  // 三段都由 `\d{2,3}`／`\d{2}` 比對而來，`Number` 不可能得到 NaN；解構的 undefined 分支
  // 是 `noUncheckedIndexedAccess` 要求的形式，實際上走不到。
  const rocYear = Number(matched[1] ?? '')
  const month = Number(matched[2] ?? '')
  const day = Number(matched[3] ?? '')

  if (rocYear < 1) {
    return { ok: false, reason: `民國年不得為 0（民國元年是第 1 年）：${JSON.stringify(value)}` }
  }
  if (month < 1 || month > MONTHS_PER_YEAR) {
    return { ok: false, reason: `民國日期的月份不合法：${JSON.stringify(value)}` }
  }

  const year = rocYear + ROC_EPOCH_OFFSET
  const lastDay = daysInMonth(year, month)
  if (day < 1 || day > lastDay) {
    // 這一條擋的是 `1140229`：民國 114 年（西元 2025）不是閏年，2 月只有 28 天。
    // 少了它會得到一個 `2025-02-29`，寫進 DB 的 `date` 欄位會被 MariaDB 悄悄轉成 `0000-00-00`
    // 或直接報一個看不出成因的錯，兩種都比在這裡明講「哪一個值壞了」差。
    return {
      ok: false,
      reason: `民國日期的日不合法（${year}-${pad2(month)} 只有 ${lastDay} 天）：${JSON.stringify(value)}`,
    }
  }

  return { ok: true, value: `${String(year)}-${pad2(month)}-${pad2(day)}` }
}

/**
 * 中文句子裡的「N年N月N日起適用」。
 *
 * `(?<!\d)` 擋的是**西元寫法**：`2026年1月1日起適用` 少了它會match到 `026年`，
 * 算成民國 26 年（1937）——又是一個「完全合理的錯日期」。加上它之後整句比對不到，
 * 於是走失敗分支，而那正是格式變更時該發生的事。
 *
 * 年份 `\d{2,3}`（民國 100 年以前是兩位）、月日 `\d{1,2}`（政府寫 `1月1日` 不補零）。
 */
const ROC_EFFECTIVE_TEXT_PATTERN = /(?<!\d)(\d{2,3})年(\d{1,2})月(\d{1,2})日起適用/g

/**
 * 從一段中文文字裡取出生效日（`115年1月1日起適用` → `2026-01-01`）。
 *
 * @param text 政府 metadata 的資源說明，例如
 *   `勞工職業災害保險適用行業別及費率表(114年1月1日起適用)`。
 * @param label 這段文字是什麼（`資源說明`），只用來組錯誤訊息——那句話會原樣進
 *   `regulatory_sync_logs.error_message`，而看紀錄的人要能分辨是「政府沒寫」還是「我們讀不懂」。
 *
 * ## 為什麼這支函式存在：`4` 與 `6` 的生效日不在資料裡
 *
 * `dataset_code=1`、`3` 的每一列都帶著生效日（`適用起日`／`生效日`，民國 YYYMMDD），
 * 但 `4`（勞就保分擔金額表）與 `6`（職災費率表）的資源內容裡**一個日期欄位都沒有**
 * ——2026-08 的實測確認過三種格式（JSON／CSV／XML）都只有數字欄位。
 * 它們的適用日只寫在 metadata 的資源說明裡，計畫 §3.1 的表格也是這樣記的。
 *
 * ## 只認「起適用」這一種句型，不做同義詞擴充
 *
 * 不接受「起實施」「施行」「適用於」等等，也不接受省略「日」的寫法（`115年1月起適用`）。
 * 政府改了措辭 → 比對不到 → 整批失敗（§7.2）。這看起來很脆，但脆的方向是對的：
 * 放寬成「找到年月就算數」的版本，會在政府把說明改成
 * 「本表自115年1月1日起適用，114年1月1日起之費率請參閱歷史版本」時挑到**兩個日期中的一個**，
 * 而挑錯的那一半不會有任何症狀。
 *
 * ## 同一段文字出現兩個**不同**日期時失敗
 *
 * 理由與 `dataset_code=1` 的「整批 `適用起日` 必須一致」逐字相同：這一版從哪天生效沒有唯一答案時，
 * 挑其中一個正是計畫 §7.2 禁止的「推測值」。同一個日期寫兩次（標題與內文各一次）則放行，
 * 那不是歧義。
 */
export const parseRocEffectiveDateFromText = (text: string, label: string): RocDateResult => {
  const dates = new Set<string>()
  let firstFailure: string | null = null

  for (const matched of text.matchAll(ROC_EFFECTIVE_TEXT_PATTERN)) {
    // 三段都由 `\d{1,3}` 比對而來，因此一定是數字字串；補零後交給
    // `parseRocCompactDate` 做日曆檢查（閏年、月份、日數），這裡不重寫一份。
    const compact = `${matched[1] ?? ''}${pad2(Number(matched[2] ?? ''))}${pad2(Number(matched[3] ?? ''))}`
    const parsed = parseRocCompactDate(compact)
    if (!parsed.ok) {
      firstFailure ??= parsed.reason
      continue
    }
    dates.add(parsed.value)
  }

  if (dates.size === 0) {
    return {
      ok: false,
      reason:
        firstFailure === null
          ? `${label}裡找不到「N年N月N日起適用」的生效日：${JSON.stringify(text)}`
          : `${label}裡的生效日不是合法日期（${firstFailure}）：${JSON.stringify(text)}`,
    }
  }

  if (dates.size > 1) {
    return {
      ok: false,
      reason: `${label}裡出現兩個以上的生效日（${[...dates].join('、')}），無法推導唯一的版本生效日：${JSON.stringify(text)}`,
    }
  }

  // `size === 1` 已由上面兩個分支確定，但 `values().next().value` 在型別上仍可能是 undefined；
  // 用 `as` 收掉它等於把這個不變式從編譯器手上拿走（§2.2），因此改成解構後再判一次。
  const [only] = [...dates]
  if (only === undefined) return { ok: false, reason: `${label}的生效日推導失敗：${JSON.stringify(text)}` }
  return { ok: true, value: only }
}

/**
 * 中文文字裡的「N年度」（財政部下載專區的檔名形態：`…薪資所得扣繳稅額表_115年度.csv`）。
 *
 * **必須是「年度」兩個字，不是「年」**，理由見 {@link parseRocFiscalYear}。`(?<!\d)` 的理由同上。
 */
const ROC_FISCAL_YEAR_PATTERN = /(?<!\d)(\d{2,3})年度/g

/** 一個會計年度的起訖日。 */
export type RocFiscalYearResult =
  { readonly ok: true; readonly from: string; readonly to: string } | { readonly ok: false; readonly reason: string }

/**
 * 從一段文字裡取出「民國 N 年度」，讀成那一年的**起日與訖日**
 * （`財政部臺北國稅局薪資所得扣繳稅額表_115年度.csv` → `2026-01-01` ～ `2026-12-31`）。
 *
 * @param text 資源自己的名字（財政部下載專區的連結檔名）。
 * @param label 這段文字是什麼（`資源名稱`），只用來組錯誤訊息。
 *
 * ## 為什麼「年度」推導得出唯一版本，而 `dataset_code=2` 的「年」推導不出來
 *
 * 兩者看起來只差一個字，但它們是不同的東西，而這個差別正是計畫 §7.2 那條線在這裡的落點：
 *
 * - **健保分級表的「100年」是一個標示**，那一年可能有兩次調整（實測 `20246` 有 102年1月 與
 *   102年7月），因此「100年那一份是哪一天生效」沒有唯一答案，挑一個就是推測值。
 * - **扣繳稅額表的「115年度」是這張表自己的適用範圍**：所得稅是按年度課徵，
 *   一個年度一張表，而年度的邊界就是 1 月 1 日到 12 月 31 日。把它讀成那一整年
 *   **沒有補進任何來源裡沒有的資訊**，只是把政府自己講的「年度」寫成日曆日。
 *
 * ## 訖日一起回傳，因為那是這張表**明示**的失效日（計畫 §3.2 (d)）
 *
 * §3.2 (d) 禁止的是拿「下一版開始日的前一天」去填 `effective_to`。這裡不是那件事：
 * 「115年度」這四個字本身就宣告了它管到 2026-12-31 為止。
 *
 * **而且這一欄在這個資料集上是必要的，不是加分項**：財政部那一頁缺 108 與 110 兩個年度（實測），
 * 少了訖日，補算民國 110 年度的薪資會挑到**109 年度**那一張表——`effective_from <= asOfDate`
 * 而它是最新的一版，於是回一個完全合理、不會報錯的錯誤稅額。有了訖日就會查不到版本，
 * 而查不到會有人來看，算錯不會。
 *
 * 同一段文字出現兩個**不同**年度時失敗，理由與 {@link parseRocEffectiveDateFromText} 逐字相同。
 */
export const parseRocFiscalYear = (text: string, label: string): RocFiscalYearResult => {
  const years = new Set<number>()
  let firstFailure: string | null = null

  for (const matched of text.matchAll(ROC_FISCAL_YEAR_PATTERN)) {
    // 補上「0101」之後交給 `parseRocCompactDate` 做民國元年檢查，這裡不重寫一份。
    const parsed = parseRocCompactDate(`${matched[1] ?? ''}0101`)
    if (!parsed.ok) {
      firstFailure ??= parsed.reason
      continue
    }
    years.add(Number(matched[1] ?? '') + ROC_EPOCH_OFFSET)
  }

  if (years.size === 0) {
    return {
      ok: false,
      reason:
        firstFailure === null
          ? `${label}裡找不到「N年度」：${JSON.stringify(text)}`
          : `${label}裡的年度不是合法民國年（${firstFailure}）：${JSON.stringify(text)}`,
    }
  }
  if (years.size > 1) {
    return {
      ok: false,
      reason: `${label}裡出現兩個以上的年度（${[...years].join('、')}），無法推導唯一的版本：${JSON.stringify(text)}`,
    }
  }

  const [only] = [...years]
  if (only === undefined) return { ok: false, reason: `${label}的年度推導失敗：${JSON.stringify(text)}` }
  return { ok: true, from: `${String(only)}-01-01`, to: `${String(only)}-12-31` }
}

/** 中文句子裡的「N年N月」（健保署那兩份資源說明的形態）。`(?<!\d)` 的理由同上。 */
const ROC_YEAR_MONTH_PATTERN = /(?<!\d)(\d{2,3})年(\d{1,2})月/g

/** 只有年份、沒有月份的形態（`100年全民健康保險投保金額分級表`）。用來組失敗原因，也用來判定候選（見下）。 */
const ROC_YEAR_ONLY_PATTERN = /(?<!\d)(\d{2,3})年/

/**
 * 這段文字**只有年份、沒有月份**嗎（`100年全民健康保險投保金額分級表`）？
 *
 * ## 這一支存在的理由：候選判準必須機械可判定，而且與「推導不出來」是兩件事（計畫 §7.1.2）
 *
 * `dataset_code=2` 的 16 個資源裡有 9 個是政府的年度標示。照 §7.2 的字面處理，它們每晚都失敗，
 * 於是那個資料集在穩定狀態下**永遠是 `status=3`、排程每晚一則 error**——
 * 而一個永遠紅的告警三個月後就沒有人會看，那時真正的失敗（政府改了格式）跟著被忽略。
 *
 * 因此那九個的處置是**排除**（不是候選），不是失敗。判準就是這一支：
 * 有年份、但 {@link parseRocYearMonthFromText} 的「N年M月」比對不到 → 不是候選。
 *
 * **它與 `parseRocYearMonthFromText` 共用同兩個 pattern，不另寫一份**：
 * 兩份的話，其中一份哪天為了讓某個新寫法通過而放寬，另一份不會跟著鬆，
 * 於是同一個資源會同時「推導得出生效日」又「不是候選」——一個沒有人想得出來的狀態。
 *
 * ⚠️ 這一支**不**回答「該不該失敗」，只回答「是不是候選」。呼叫端要自己把兩件事接起來，
 * 見 `regulatory-sync-source.ts` 的 `deriveNhiEffectiveFrom`。
 */
export const isRocYearWithoutMonth = (text: string): boolean =>
  !new RegExp(ROC_YEAR_MONTH_PATTERN.source).test(text) && ROC_YEAR_ONLY_PATTERN.test(text)

/**
 * 從一段中文文字裡取出「年月」並讀成該月的第一天（`115年1月全民健康保險投保金額分級表` → `2026-01-01`）。
 *
 * @param text 政府 metadata 的資源說明。
 * @param label 這段文字是什麼（`資源說明`），只用來組錯誤訊息——那句話會原樣進
 *   `regulatory_sync_logs.error_message`。
 *
 * ## 為什麼健保署那兩份要另一支函式：措辭不同，而且沒有「日」
 *
 * 勞動部那批寫的是「(114年1月1日起適用)」，健保署寫的是「115年1月全民健康保險投保金額分級表」
 * ——**沒有「起適用」、也沒有「日」**（2026-08 實測，`20251` 16 個資源、`20246` 19 個資源皆然）。
 * 拿 {@link parseRocEffectiveDateFromText} 去讀一個字都比對不到，因此不是把那一支放寬，
 * 而是另外一支只認這一種形態的函式——放寬那一支會讓「起適用」變成可有可無，
 * 而那是勞動部那四個資料集唯一的生效日來源。
 *
 * ## 「N年M月」讀成該月 1 日**不是猜**，「只有 N 年」則真的推不出來
 *
 * 這兩件事的差別是本函式存在的理由，也是計畫 §7.2 那條線在這個資料集上的落點：
 *
 * - **月粒度是這份資料真正的粒度**：同一年可以有兩份（實測 `20246` 有「111年1月」與「111年7月」、
 *   `20251` 亦然），而健保投保金額分級表的版本邊界本來就是月初。把「115年1月」讀成 2026-01-01
 *   沒有補進任何來源裡沒有的資訊，只是把月粒度的標示寫成日曆日。
 * - **只有年份的那一種真的少了資訊**：`20251` 的「100年」到「109年」九份就是這樣（實測），
 *   而同一年有兩次調整時（`20246` 的 102年1月／102年7月）年度標示分不出是哪一次。
 *   挑一個「1 月 1 日」正是 §7.2 禁止的推測值——它會產出一個完全合理、沒有任何斷言擋得住的錯日期。
 *   因此這一種**一律失敗**，而且失敗訊息要講明是「只有年份」，不是「讀不懂」：
 *   前者重跑一百次也一樣，後者代表政府改了措辭、要有人去看。
 *
 * 同一段文字出現兩個**不同**年月時失敗，理由與 {@link parseRocEffectiveDateFromText} 逐字相同。
 */
export const parseRocYearMonthFromText = (text: string, label: string): RocDateResult => {
  const dates = new Set<string>()
  let firstFailure: string | null = null

  for (const matched of text.matchAll(ROC_YEAR_MONTH_PATTERN)) {
    // 補上「01」之後交給 `parseRocCompactDate` 做日曆檢查（月份範圍、民國元年），這裡不重寫一份。
    const compact = `${matched[1] ?? ''}${pad2(Number(matched[2] ?? ''))}01`
    const parsed = parseRocCompactDate(compact)
    if (!parsed.ok) {
      firstFailure ??= parsed.reason
      continue
    }
    dates.add(parsed.value)
  }

  if (dates.size === 0) {
    if (firstFailure !== null) {
      return { ok: false, reason: `${label}裡的年月不是合法日期（${firstFailure}）：${JSON.stringify(text)}` }
    }
    // 「有年份、沒有月份」與「整段都沒有民國年」分成兩句話：前者是這個資料集已知的歷史形態
    //（政府的年度標示），後者比較可能是措辭改了。兩者的處置都是失敗，但看紀錄的人要分得出來。
    return {
      ok: false,
      reason: ROC_YEAR_ONLY_PATTERN.test(text)
        ? `${label}只有年份、沒有月份，推導不出唯一的版本生效日（同一年可能有兩次調整，例如 111年1月 與 111年7月）：${JSON.stringify(text)}`
        : `${label}裡找不到「N年N月」的生效年月：${JSON.stringify(text)}`,
    }
  }

  if (dates.size > 1) {
    return {
      ok: false,
      reason: `${label}裡出現兩個以上的生效年月（${[...dates].join('、')}），無法推導唯一的版本生效日：${JSON.stringify(text)}`,
    }
  }

  const [only] = [...dates]
  if (only === undefined) return { ok: false, reason: `${label}的生效日推導失敗：${JSON.stringify(text)}` }
  return { ok: true, value: only }
}
