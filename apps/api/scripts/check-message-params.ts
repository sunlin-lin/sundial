/**
 * 插值一致性掃描：語系檔句子裡的 `{{...}}` ↔ `MESSAGE_PARAM_SPECS` 的宣告，雙向比對。
 *
 * **為什麼需要一支腳本，而不是再想辦法用型別擋。** 型別只管得到「呼叫端有沒有把宣告的變數填齊」
 * （`DomainError` 的 `params` 是必填，見 `service-result.ts`），管不到**句子**：
 * 語系檔是一堆字串，`'仍有 {{assignedUserCount}} 位…'` 與 `'仍有 位…'` 在型別上是同一種東西。
 * 於是這兩種改動編譯器一個字都看不到，而症狀都不會有人回報：
 *
 * - **句子少了 `{{}}`（或變數名拼錯）**：呼叫端仍被要求算出那個數字、仍然傳進來，
 *   然後被安靜丟掉。使用者看到「仍有 位公司成員使用此角色」——一句讀起來只是有點怪的話。
 * - **句子多了一個沒人宣告的 `{{}}`**：`translate()` 找不到值，於是原樣輸出。
 *   使用者看到「仍有 {{assignedUserCount}} 位…」——它看起來像個 bug，但畫面照樣渲染、
 *   log 照樣乾淨，沒有任何一層會告警。
 *
 * 兩邊都由**同一份宣告**推導（型別是 `MESSAGE_PARAM_SPECS` 算出來的，見 `messages.ts`），
 * 因此這支腳本比對的就是型別本身在講的那件事，不是另一份「給腳本看的清單」。
 *
 * 執行：`bun run check:i18n`（已串進 `bun run ci`）。
 */
import { flattenMessageTree } from '../src/shared/i18n/message-tree.ts'
import { DEFAULT_LOCALE, MESSAGE_CATALOGS, MESSAGE_PARAM_SPECS } from '../src/shared/i18n/messages.ts'

/**
 * i18next 的插值語法。
 *
 * `[^{}\s]+` 刻意不收空白與大括號：`{{ a b }}` 或 `{{{x}}` 這種寫壞的樣板**抓不到**，
 * 於是它會落進「宣告了變數，句子卻沒用到」那一邊被擋下——**寫壞等於沒寫**，正是我們要的判定。
 */
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g

/** 一則不一致。`locale` 讓錯誤訊息指得出是哪一個語系翻壞了，而不只是「某處對不上」。 */
type Inconsistency = {
  readonly locale: string
  readonly key: string
  readonly detail: string
}

/** 宣告面：key → 該則訊息宣告會收哪些變數。 */
const declaredParams = new Map<string, ReadonlySet<string>>(
  Object.entries(MESSAGE_PARAM_SPECS).map(([key, spec]) => [key, new Set(Object.keys(spec))]),
)

/** 句子面：把一則訊息裡出現過的變數名抓出來（重複出現只算一個）。 */
const placeholdersIn = (sentence: string): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const match of sentence.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]
    if (name !== undefined) names.add(name)
  }
  return names
}

const inconsistencies: Inconsistency[] = []
let scannedMessages = 0
let scannedPlaceholders = 0

for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
  for (const [key, sentence] of Object.entries(flattenMessageTree(catalog))) {
    scannedMessages += 1

    const used = placeholdersIn(sentence)
    scannedPlaceholders += used.size

    // 沒宣告過的 key 視為「宣告收 0 個變數」——它本來就一個變數都收不了（`translate()` 的
    // 第三個引數在那些 key 上是 `never`），所以句子裡出現任何 `{{}}` 都是壞的。
    const declared = declaredParams.get(key) ?? new Set<string>()

    for (const name of used) {
      if (declared.has(name)) continue
      inconsistencies.push({
        locale,
        key,
        detail: `句子用了 {{${name}}}，但 MESSAGE_PARAM_SPECS 沒有宣告它——執行期會把 {{${name}}} 原樣印給使用者`,
      })
    }

    for (const name of declared) {
      if (used.has(name)) continue
      inconsistencies.push({
        locale,
        key,
        detail: `MESSAGE_PARAM_SPECS 宣告了 ${name}，但句子裡沒有 {{${name}}}——呼叫端算出來的值會被安靜丟掉`,
      })
    }
  }
}

// 宣告了一個預設語系根本沒有的 key。`satisfies` 已經擋過一次（key 被釘在 `MessageKey` 上），
// 這裡再擋一次是因為那個 `satisfies` 一旦被誰放寬，就不會再有任何東西發現。
const defaultCatalog = flattenMessageTree(MESSAGE_CATALOGS[DEFAULT_LOCALE])
for (const key of declaredParams.keys()) {
  if (defaultCatalog[key] !== undefined) continue
  inconsistencies.push({
    locale: DEFAULT_LOCALE,
    key,
    detail: 'MESSAGE_PARAM_SPECS 宣告了這個 key，但預設語系裡沒有這一則訊息',
  })
}

/**
 * 掃描器的自我檢查。
 *
 * **一支掃不到東西的掃描器會永遠通過**，而「永遠通過」與「everything is fine」在 CI 上
 * 長得一模一樣——語系檔搬家、匯出改名、樹的層數變了，任何一件都會讓上面的迴圈跑 0 圈，
 * 而我們從此以為插值有人在看。三個下限各盯一段：目錄讀到了嗎、宣告讀到了嗎、
 * 樣板語法還認得出來嗎（`PLACEHOLDER_PATTERN` 改壞的話只有這一項抓得到）。
 *
 * 三個下限都是「至少一個」而不是某個確切數字：寫死數字的話，每加一則訊息都要回來改這裡，
 * 而那種檢查最後一定會被人改成它當下看到的值。
 */
const selfCheckFailures: string[] = []
if (scannedMessages === 0) selfCheckFailures.push('掃到 0 則訊息：語系目錄沒讀到，這次掃描等於沒跑')
if (declaredParams.size === 0) selfCheckFailures.push('讀到 0 筆插值宣告：MESSAGE_PARAM_SPECS 沒讀到，比對等於沒跑')
if (scannedPlaceholders === 0) {
  selfCheckFailures.push('整份語系檔抓不到任何 {{...}}：不是插值全被刪光，就是樣板語法的比對式壞了')
}

if (selfCheckFailures.length > 0) {
  process.stderr.write(
    [
      '插值掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
      ...selfCheckFailures.map((line) => `  ✗ ${line}`),
      '',
    ].join('\n'),
  )
  process.exit(1)
}

if (inconsistencies.length > 0) {
  process.stderr.write(
    [
      `插值宣告與語系檔不一致（${inconsistencies.length} 筆）：`,
      ...inconsistencies.map(({ locale, key, detail }) => `  ✗ [${locale}] ${key}\n      ${detail}`),
      '',
    ].join('\n'),
  )
  process.exit(1)
}

process.stdout.write(
  `插值檢查通過：${scannedMessages} 則訊息、${scannedPlaceholders} 個 {{插值}}、${declaredParams.size} 筆宣告，雙向一致。\n`,
)
