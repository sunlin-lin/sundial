/**
 * `dataset_code = 6` 勞工職業災害保險行業別費率的解析器（零 IO 純函式，§0.1）。
 *
 * 來源：data.gov.tw `6262` 的 JSON 資源（計畫 §7.0 已實地查證，本次同步前又確認過一次）。
 * 實測回傳是一個陣列，55 列、19 種大分類，每一列長這樣：
 *
 * ```json
 * {"序號":"1","大分類":"農、林、漁、牧業","費率編號":"1","行業類別":"農、林、牧業",
 *  "行業別費率%":"0.18","上下班費率%":"0.07","災保費率%":"0.25"}
 * ```
 *
 * ## 生效日在**資源說明**裡：`…行業別及費率表(114年1月1日起適用)`
 *
 * 資源內容裡一個日期欄位都沒有（JSON／CSV 兩種格式都確認過），因此本解析器要用
 * {@link RegulatoryParseContext}，讀不到或讀不懂就整批失敗（計畫 §7.2）。
 *
 * 這一份**每三年才調整一次**，也就是說絕大多數時候同步會在 checksum 那一步就結束（`status=4`）。
 * 正因為如此，生效日這條路平常不會被走到——它會在三年後政府換一份資料的那一天第一次被檢驗，
 * 而那時沒有人記得這裡曾經對措辭做過什麼假設。措辭的假設寫在 `parseRocEffectiveDateFromText`。
 *
 * ## 完整性檢查：19 種大分類必須齊全，處置與 `dataset_code=1` 的身分別逐字同構
 *
 * 政府新增一種大分類 → 未知大分類 → 失敗；政府刪掉一種 → 完整性檢查 → 失敗。
 * 兩個方向都是法規變更（行業標準分類改版），處置必須一致——只擋一邊的話，「少一類」會是一次
 * 完全成功的同步，而屬於那一類的公司從此查不到費率：職災保費算成 0，
 * 薪資單上是一個沒有職災保險費、金額完全合理的結果。
 *
 * 落點在 {@link MAJOR_CATEGORY_NAMES}（總對總地綁在形狀定義上）與函式尾端的完整性檢查。
 *
 * ## 三個費率會互相驗算：行業別 ＋ 上下班 ＝ 災保
 *
 * 政府自己給了三個數字，實測 55 列全部對得起來。這個檢查**不引進任何法規知識**——
 * 三個數字都在同一列裡。它擋的是欄位換位置：換位置之後每一個值單獨看都完全合法
 *（都是 0.0x 的小數），沒有任何 pattern 或型別會發現，而 Payroll 會拿 0.07 當某個行業的費率用。
 */
import type { RegulatoryRecordData } from '../../datasets/regulatory-datasets.service.ts'
import { isDecimalSum, percentToRate } from './regulatory-amount.ts'
import { parseRocEffectiveDateFromText } from './regulatory-roc-date.ts'
import type { ParsedRegulatoryRecord, RegulatoryParseContext, RegulatoryParseResult } from './regulatory-sync-model.ts'

/** `dataset_code=6` 的 `data` 形狀（唯一來源在 `datasets/domain/regulatory-record-shape.ts`）。 */
type OccupationalAccidentInsuranceRate = RegulatoryRecordData<6>

type MajorCategoryCode = OccupationalAccidentInsuranceRate['majorCategoryCode']

/**
 * 我們的代碼 → 政府原文的 `大分類`。
 *
 * **這份對照是封閉的，而且兩個方向都封閉**（理由與 `regulatory-labor-insurance-salary.ts`
 * 的 `INSURED_CATEGORY_NAMES` 逐字相同）：出現沒列在這裡的大分類 → 整批失敗；
 * 這裡列著、來源卻一筆都沒有 → 整批失敗，見 {@link parseOccupationalAccidentInsuranceRates} 尾端。
 *
 * **key 是我們的代碼而不是政府原文，這是刻意的**：
 * `satisfies Record<MajorCategoryCode, string>` 讓這份對照與形狀定義上那個字面值聯集
 * **總對總**地綁在一起——形狀多一個字面值時這裡缺 key、少一個時這裡多 key，兩個方向都當場編譯不過。
 * 而「期望有哪幾種」正是完整性檢查唯一需要的那份清單，它因此不必、也不得再抄一份。
 *
 * 十九個值來自 2026-08 實測的完整清單（55 列，19 種大分類），順序與中華民國行業標準分類一致。
 * 原文裡的頓號與分號是政府的字，**一個字都不能改**——比對是逐字的。
 */
const MAJOR_CATEGORY_NAMES = {
  agricultureForestryFishingAnimalHusbandry: '農、林、漁、牧業',
  miningAndQuarrying: '礦業及土石採取業',
  manufacturing: '製造業',
  electricityAndGasSupply: '電力及燃氣供應業',
  waterSupplyAndRemediation: '用水供應及污染整治業',
  construction: '營建工程業',
  wholesaleAndRetailTrade: '批發及零售業',
  transportationAndStorage: '運輸及倉儲業',
  accommodationAndFoodServices: '住宿及餐飲業',
  publishingAudioVisualAndIct: '出版影音及資通訊業',
  financeAndInsurance: '金融及保險業',
  realEstate: '不動產業',
  professionalScientificAndTechnicalServices: '專業、科學及技術服務業',
  supportServices: '支援服務業',
  publicAdministrationAndDefence: '公共行政及國防；強制性社會安全',
  education: '教育業',
  humanHealthAndSocialWork: '醫療保健及社會工作服務業',
  artsEntertainmentAndRecreation: '藝術、娛樂及休閒服務業',
  otherServices: '其他服務業',
} as const satisfies Record<MajorCategoryCode, string>

/**
 * 全部大分類代碼。**這一份就是完整性檢查的期望清單**，由上面那個總對總的對照表推導。
 *
 * `Object.keys(...) as ...` 的形式比照 `datasets/domain/regulatory-dataset-code.ts`：
 * `Object.keys` 在型別上只回得出 `string[]`，而這個斷言的正確性由上一段的 `satisfies` 保證。
 */
const MAJOR_CATEGORY_CODES = Object.keys(MAJOR_CATEGORY_NAMES) as readonly MajorCategoryCode[]

/**
 * 政府原文的 `大分類` → 我們的代碼；不在對照表裡時是 `undefined`（＝未知大分類，整批失敗）。
 *
 * 逐項比對而不是建一份反向 map：對照表固定 19 項、來源不到一百列，成本可以忽略，
 * 而反向 map 需要一次 `Object.fromEntries` ＋ 型別斷言，多出來的那一步沒有換到任何東西。
 */
const toMajorCategoryCode = (categoryName: string): MajorCategoryCode | undefined =>
  MAJOR_CATEGORY_CODES.find((code) => MAJOR_CATEGORY_NAMES[code] === categoryName)

/**
 * 政府那一份的七個欄位名。**逐字寫出來**（含欄位名尾巴那個 `%`，它是單位的一部分）：
 * 欄位改名要在這裡當場失敗，不要靜靜地讀到 `undefined`。
 */
const FIELD = {
  sequence: '序號',
  majorCategory: '大分類',
  rateCode: '費率編號',
  industry: '行業類別',
  industryRate: '行業別費率%',
  commutingRate: '上下班費率%',
  totalRate: '災保費率%',
} as const

/** 序號與費率編號：正整數字串。 */
const CODE_PATTERN = /^\d+$/

/** 從政府那一列取一個字串欄位。**缺欄位與空字串都算缺**——後者在 CSV 轉 JSON 時很常見。 */
const readField = (row: Record<string, unknown>, field: string): string | null => {
  const value = row[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 讀一個費率欄位。**單位是空字串**：值本身不帶百分號（`0.18`），百分號在欄位名上（`行業別費率%`）。
 *
 * 三個費率欄位的處置完全一樣，寫三次只會分岔（其中一份哪天被放寬，另外兩份不會跟著鬆）。
 */
const readRate = (
  row: Record<string, unknown>,
  field: string,
  position: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } => {
  const raw = readField(row, field)
  if (raw === null) return { ok: false, reason: `${position}缺少「${field}」` }
  const rate = percentToRate(raw, { suffix: '', label: `「${field}」` })
  if (!rate.ok) return { ok: false, reason: `${position}的${rate.reason}` }
  return { ok: true, value: rate.value }
}

/**
 * 解析勞工職業災害保險行業別費率表。
 *
 * @param rawText 政府 JSON 資源的原始內容（未經任何前處理，與寫進 `raw_data` 的是同一串）。
 * @param context 本次 resource discovery 的產物。**生效日唯一的來源**，見檔頭。
 *
 * ## `record_key` 為什麼是 `industry-{費率編號}`
 *
 * - **不能用 `序號`**：它是列序。實測這一版的 `序號` 與 `費率編號` 剛好一模一樣（1–55），
 *   而那正是最危險的情況——兩者只要有一次分岔，用錯的那一個不會有任何症狀。
 *   `序號` 的正確位置是 `sort_order`。
 * - **不能用 `行業類別` 或 `大分類`**：那是政府的顯示字串（`石油及天然氣礦業、砂、石採取及其他礦業`），
 *   改一個頓號就會讓整批 key 變成新的，跨版本比對整個失效。
 * - **`費率編號` 是這張表的業務代碼**，而且它正是公司設定會存下來的那一個
 *  （計畫 §3.1「行業別代碼政府會改」，`company_regulatory_settings` 存的是代碼）。
 *   它在同一版本內唯一，跨版本則有政府自己的延續性。
 *
 * ⚠️ **代碼的意義會隨行業標準分類改版而變**，這也正是計畫把這一格做成資料集而不是程式常數的理由：
 * 舊版本留在資料庫裡，代碼在**它自己那一版**裡的意義不會被改寫。
 *
 * 前綴 `industry-` 是刻意的：純數字的 key 看起來像一個可以拿去比大小的量，而它是一個代碼。
 */
export const parseOccupationalAccidentInsuranceRates = (
  rawText: string,
  context: RegulatoryParseContext,
): RegulatoryParseResult => {
  // 生效日先算：讀不到資源說明時，後面 55 列全部解析完也沒有意義（計畫 §7.2）。
  // **「政府這次沒寫」與「寫了但讀不懂」分成兩句話**：前者重跑沒有用，後者要有人去看措辭改成什麼。
  if (context.resourceDescription === null) {
    return {
      ok: false,
      reason:
        'metadata 沒有給資源說明，而本資料集的生效日只寫在資源說明裡（資源內容沒有任何日期欄位），' +
        '無法推導版本生效日',
    }
  }
  const effective = parseRocEffectiveDateFromText(context.resourceDescription, '資源說明')
  if (!effective.ok) return { ok: false, reason: effective.reason }
  const effectiveFrom = effective.value

  let payload: unknown
  try {
    payload = JSON.parse(rawText)
  } catch (error) {
    // 政府端點在維護期間會回一頁 HTML，而 `JSON.parse` 的原訊息對事後追查沒有幫助。
    return {
      ok: false,
      reason: `來源不是合法的 JSON（${error instanceof Error ? error.message : String(error)}）；開頭：${JSON.stringify(rawText.slice(0, 80))}`,
    }
  }

  if (!Array.isArray(payload)) {
    return { ok: false, reason: '來源 JSON 不是陣列，格式已與 2026-08 實測的形態不同' }
  }
  if (payload.length === 0) {
    // 空陣列會「成功」地產生一個沒有任何費率的版本，而 Payroll 查得到版本、查不到費率。
    return { ok: false, reason: '來源 JSON 是空陣列，沒有任何費率可以寫入' }
  }

  const records: ParsedRegulatoryRecord[] = []
  const seenKeys = new Set<string>()
  /** 這一批實際出現過的大分類。收完之後要與 {@link MAJOR_CATEGORY_CODES} 比對，見迴圈之後。 */
  const seenCategories = new Set<MajorCategoryCode>()

  for (const [index, entry] of payload.entries()) {
    const position = `第 ${String(index + 1)} 列`
    if (!isPlainObject(entry)) {
      return { ok: false, reason: `${position}不是物件` }
    }

    const categoryName = readField(entry, FIELD.majorCategory)
    if (categoryName === null) {
      return { ok: false, reason: `${position}缺少「${FIELD.majorCategory}」` }
    }
    const majorCategoryCode = toMajorCategoryCode(categoryName)
    if (majorCategoryCode === undefined) {
      return {
        ok: false,
        reason: `${position}的「${FIELD.majorCategory}」是未知的行業大分類：${JSON.stringify(categoryName)}（行業標準分類改版屬法規變更，需先擴充形狀定義）`,
      }
    }

    const rateCode = readField(entry, FIELD.rateCode)
    if (rateCode === null || !CODE_PATTERN.test(rateCode)) {
      return { ok: false, reason: `${position}的「${FIELD.rateCode}」不是正整數：${JSON.stringify(rateCode)}` }
    }

    const industryName = readField(entry, FIELD.industry)
    if (industryName === null) {
      return { ok: false, reason: `${position}缺少「${FIELD.industry}」` }
    }

    const industryRate = readRate(entry, FIELD.industryRate, position)
    if (!industryRate.ok) return industryRate
    const commutingRate = readRate(entry, FIELD.commutingRate, position)
    if (!commutingRate.ok) return commutingRate
    const totalRate = readRate(entry, FIELD.totalRate, position)
    if (!totalRate.ok) return totalRate

    // 三個費率互相驗算。對不起來就是欄位換了位置或政府改了組成方式，兩者都要有人去看一眼
    // ——而換位置之後每一個值單獨看都完全合法（見檔頭）。
    if (!isDecimalSum(industryRate.value, commutingRate.value, totalRate.value)) {
      return {
        ok: false,
        reason:
          `${position}的三個費率對不起來：「${FIELD.industryRate}」${industryRate.value} ＋ ` +
          `「${FIELD.commutingRate}」${commutingRate.value} ≠ 「${FIELD.totalRate}」${totalRate.value}`,
      }
    }

    const rawSequence = readField(entry, FIELD.sequence)
    if (rawSequence === null || !CODE_PATTERN.test(rawSequence)) {
      return { ok: false, reason: `${position}的「${FIELD.sequence}」不是正整數：${JSON.stringify(rawSequence)}` }
    }

    const recordKey = `industry-${rateCode}`
    if (seenKeys.has(recordKey)) {
      // 撞 key 代表同一個費率編號出現了兩次。放行的話會在寫入時撞
      // `UNIQUE(dataset_version_id, record_key)`，而那時的錯誤訊息是一句 SQL 唯一鍵違反，
      // 看不出是哪一列、也看不出成因。
      return { ok: false, reason: `${position}的 record_key 重複：${recordKey}` }
    }
    seenKeys.add(recordKey)
    seenCategories.add(majorCategoryCode)

    const data: OccupationalAccidentInsuranceRate = {
      majorCategoryCode,
      majorCategoryName: categoryName,
      rateCode,
      industryName,
      industryRate: industryRate.value,
      commutingRate: commutingRate.value,
      occupationalAccidentRate: totalRate.value,
    }

    records.push({
      recordKey,
      // `code` 是業務代碼（費率編號），`name` 是顯示名稱（行業類別原文）——與資料字典對這兩欄的定義一致。
      code: rateCode,
      name: industryName,
      // 這張表不是級距表：每一列是一個行業，不是一段金額區間。
      rangeFrom: null,
      rangeTo: null,
      // 本資料集不含金額：職災保費 = 投保薪資 × 費率，投保薪資來自另一個資料集。
      amount: null,
      // **合計費率**，不是行業別費率：`rate` 這一欄問的是「這一列實際適用的費率是多少」，
      // 而答案只有合計那一個（行業別與上下班兩個組成部分在 `data` 裡）。
      // 填行業別費率的話，每一家公司的職災保費都會少算上下班那 0.07%。
      rate: totalRate.value,
      data,
      sortOrder: Number(rawSequence),
    })
  }

  // 19 種大分類必須全部出現，缺一種即整批失敗。
  //
  // **這一條與上面「未知大分類即失敗」是同一件事的另一個方向**，兩邊的處置必須一致：
  // 政府**新增**一類已經會讓同步失敗，那麼政府**刪掉**一類就不能反而完全成功。
  //
  // 少了一類的後果比「同步失敗」嚴重得多：解析成功、版本照樣寫進去、每一筆費率都對，
  // 只是屬於那一類的公司**查不到費率**。而查不到不會拋錯——職災保費算成 0，
  // 薪資單與雇主的申報金額都是一個完全合理的數字。
  //
  // 這一條同時也是「只抓到半截資料」的攔截點：被截斷的回應必然會少掉排在後面的那幾類，
  // 因此不需要另外再訂一個「至少幾筆」的下限——那種下限每次行業分類改版都會過期。
  const missingCategories = MAJOR_CATEGORY_CODES.filter((code) => !seenCategories.has(code))
  if (missingCategories.length > 0) {
    // 訊息要寫出**少了哪一種**（原文 ＋ 代碼）而不是只說「不完整」：這一句會原樣進
    // `regulatory_sync_logs.error_message`，而事後看紀錄的人要能當場判斷這是行業分類改版
    //（法規變更，要有人去確認並擴充形狀定義），還是我們只抓到半截資料（重跑即可）。
    const describe = (code: MajorCategoryCode): string => `${MAJOR_CATEGORY_NAMES[code]}（${code}）`
    return {
      ok: false,
      reason:
        `來源缺少行業大分類：${missingCategories.map(describe).join('、')}` +
        `；本批只有 ${String(seenCategories.size)} 種`,
    }
  }

  return { ok: true, effectiveFrom, records }
}
