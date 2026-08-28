/**
 * `sync/domain/` 的純函式測試（§7.1：法規級距的計算邏輯必須有單元測試，且必須包含邊界值）。
 *
 * 這一批全部零 IO：民國日期轉換、中文區間字串拆解、resource discovery 的 metadata 解讀、
 * 心跳逾時判定，以及 `dataset_code=1` 的解析器。
 *
 * **它們測到的就是正式路徑上跑的那段程式碼**（§7.3）：同步流程沒有第二份實作，
 * `impl/regulatory-sync.run.service.ts` 直接呼叫這裡的每一支函式。
 *
 * 寫進資料庫的那一批在 `regulatory-sync.run.test.ts`。
 *
 * **真正打政府端點的那一條不在這裡，也不在 `bun run test` 裡**：它是一支獨立指令
 * `bun run check:live-sources`（`apps/api/scripts/check-live-sources.ts`）。
 * 兩者性質不同——這一批離線、可重現，那一支連外、不可重現，
 * 混在同一次執行裡會逼得連外那一半必須寬容，而寬容就等於沒用（理由寫在那支腳本的檔頭）。
 */
import { describe, expect, test } from 'bun:test'
import { parseRegulatoryRecordData } from '../../datasets/domain/regulatory-record-shape.ts'
import { isDecimalSum, parseAmountRange, percentToRate } from '../domain/regulatory-amount.ts'
import { parseCsvTable } from '../domain/regulatory-csv.ts'
import { selectDataGovResource, toDataGovMetadataUrl } from '../domain/regulatory-data-gov.ts'
import type { RegulatorySourceResource } from '../domain/regulatory-source-resource.ts'
import { parseHealthInsurancePremiumShares } from '../domain/regulatory-health-insurance-premium-share.ts'
import { parseHealthInsuranceSalaryGrades } from '../domain/regulatory-health-insurance-salary-grade.ts'
import { planMultiVersionSync } from '../domain/regulatory-multi-version-plan.ts'
import { parseLaborEmploymentInsurancePremiumShares } from '../domain/regulatory-labor-employment-insurance-premium.ts'
import {
  parseLaborInsuranceSalaryGrades,
  parseMonthlySalaryRange,
} from '../domain/regulatory-labor-insurance-salary.ts'
import { parseLaborPensionContributionWageGrades } from '../domain/regulatory-labor-pension-contribution-wage.ts'
import { parseOccupationalAccidentInsuranceRates } from '../domain/regulatory-occupational-accident-insurance-rate.ts'
import {
  parseRocCompactDate,
  parseRocEffectiveDateFromText,
  parseRocYearMonthFromText,
} from '../domain/regulatory-roc-date.ts'
import {
  isHeartbeatStale,
  type RegulatoryParseContext,
  type RegulatoryParseResult,
} from '../domain/regulatory-sync-model.ts'
import {
  isSyncableDatasetCode,
  REGULATORY_SYNC_SOURCES,
  SYNCABLE_DATASET_CODES,
  toVersionCode,
} from '../domain/regulatory-sync-source.ts'
import type { RegulatoryDatasetCode } from '../../datasets/regulatory-datasets.service.ts'

/** 政府那一份的一列。工廠函式讓每條測試只寫它要壞掉的那一欄。 */
const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  適用起日: '1150101',
  序號: '1',
  身分別: '一般勞工',
  投保薪資等級: '1',
  月薪資總額: '29500元以下',
  月投保薪資: '29500',
  ...overrides,
})

describe('parseRocCompactDate：民國 YYYMMDD → 西元', () => {
  test('實測值：1150101 = 2026-01-01', () => {
    // 這一個值就是 2026-08 實地查證時，勞保投保薪資分級表每一列的 `適用起日`。
    expect(parseRocCompactDate('1150101')).toEqual({ ok: true, value: '2026-01-01' })
  })

  test('邊界：民國元年、跨年的最後一天、民國 100 年以前的六碼寫法', () => {
    expect(parseRocCompactDate('0010101')).toEqual({ ok: true, value: '1912-01-01' })
    expect(parseRocCompactDate('1141231')).toEqual({ ok: true, value: '2025-12-31' })
    // 六碼是民國 100 年以前的寫法（民國 99 年）。
    expect(parseRocCompactDate('990101')).toEqual({ ok: true, value: '2010-01-01' })
    // 前後空白只是欄寬補齊，不是格式變了。
    expect(parseRocCompactDate('  1150101 ')).toEqual({ ok: true, value: '2026-01-01' })
  })

  test('邊界：閏年', () => {
    // 民國 113 = 西元 2024，是閏年。
    expect(parseRocCompactDate('1130229')).toEqual({ ok: true, value: '2024-02-29' })
    // 民國 114 = 西元 2025，不是閏年——這一條就是「一行 +1911」寫法漏掉的那個值。
    expect(parseRocCompactDate('1140229').ok).toBe(false)
    // 百年不閏：民國 189 = 西元 2100。
    expect(parseRocCompactDate('1890229').ok).toBe(false)
    // 四百年再閏：民國 89 = 西元 2000。
    expect(parseRocCompactDate('0890229')).toEqual({ ok: true, value: '2000-02-29' })
  })

  test('不合法的值一律失敗，而不是算出一個看起來合理的日期（計畫 §7.2）', () => {
    // 月份 0 與 13：`+1911` 的寫法會算出 `2026-00-01`／`2026-13-01`，兩者都不會拋錯。
    expect(parseRocCompactDate('1150001').ok).toBe(false)
    expect(parseRocCompactDate('1151301').ok).toBe(false)
    // 日 0 與超過當月天數。
    expect(parseRocCompactDate('1150100').ok).toBe(false)
    expect(parseRocCompactDate('1150431').ok).toBe(false)
    // 民國沒有第 0 年。
    expect(parseRocCompactDate('0000101').ok).toBe(false)
    // 八碼是西元寫法：當成民國會算出 2027 年——本檔要防的正是這種「完全合理」的錯值。
    expect(parseRocCompactDate('20260101').ok).toBe(false)
    expect(parseRocCompactDate('').ok).toBe(false)
    expect(parseRocCompactDate('115/01/01').ok).toBe(false)
  })

  test('失敗時帶得出原因（那個字串會進 sync_logs.error_message）', () => {
    const parsed = parseRocCompactDate('1140229')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('2025-02')
  })
})

describe('parseMonthlySalaryRange：中文區間字串', () => {
  test('三種句型', () => {
    expect(parseMonthlySalaryRange('29500元以下')).toEqual({ ok: true, value: { from: null, to: '29500' } })
    expect(parseMonthlySalaryRange('29501元至30300元')).toEqual({ ok: true, value: { from: '29501', to: '30300' } })
    expect(parseMonthlySalaryRange('43901元以上')).toEqual({ ok: true, value: { from: '43901', to: null } })
  })

  test('開放的那一端是 null，不是補一個「合理的」邊界值', () => {
    // 補 0 或一個很大的數之後，一支寫錯的級距查詢會回一個看起來正常的級距；
    // 留 null 則是查不到——而查不到會有人來看，算錯不會。
    const lowest = parseMonthlySalaryRange('29500元以下')
    expect(lowest.ok && lowest.value.from).toBeNull()
    const highest = parseMonthlySalaryRange('43901元以上')
    expect(highest.ok && highest.value.to).toBeNull()
  })

  test('值一律是字串，不是 number（§4.7、計畫 §6.1）', () => {
    const parsed = parseMonthlySalaryRange('29501元至30300元')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(typeof parsed.value.from).toBe('string')
    expect(typeof parsed.value.to).toBe('string')
  })

  test('千分位逗號可以接受：那不是猜，是同一個值的另一種寫法', () => {
    expect(parseMonthlySalaryRange('29,501元至30,300元')).toEqual({ ok: true, value: { from: '29501', to: '30300' } })
  })

  test('讀不懂的句型一律失敗，不挑一個看起來合理的解釋（§7.2 的精神）', () => {
    expect(parseMonthlySalaryRange('29500元以內').ok).toBe(false)
    expect(parseMonthlySalaryRange('二萬九千五百元以下').ok).toBe(false)
    expect(parseMonthlySalaryRange('29500~30300').ok).toBe(false)
    expect(parseMonthlySalaryRange('').ok).toBe(false)
  })

  test('上下限顛倒也失敗：兩個金額都合法，只有這一行會發現', () => {
    expect(parseMonthlySalaryRange('30300元至29501元').ok).toBe(false)
  })
})

/**
 * 「一般勞工」以外的三種身分別各一列。
 *
 * **每一份要成功解析的資料都必須帶上它們**：解析器要求四種投保身分別齊全，缺一種即整批失敗。
 * 只寫要驗的那幾列會在完整性檢查那一步失敗，看起來像規則寫錯，其實是測試資料不完整。
 */
const otherCategoryRows = [
  row({ 序號: '20', 身分別: '庇護性身心障礙者', 投保薪資等級: '1', 月薪資總額: '11100元以下', 月投保薪資: '11100' }),
  row({ 序號: '21', 身分別: '部分工時勞工', 投保薪資等級: '1', 月薪資總額: '11100元以下', 月投保薪資: '11100' }),
  row({ 序號: '22', 身分別: '職訓機構受訓者', 投保薪資等級: '1', 月薪資總額: '11100元以下', 月投保薪資: '11100' }),
]

describe('parseLaborInsuranceSalaryGrades：dataset_code=1 的解析器', () => {
  test('成功路徑：生效日、record_key、級距與金額', () => {
    const parsed = parseLaborInsuranceSalaryGrades(
      JSON.stringify([
        row(),
        row({ 序號: '2', 投保薪資等級: '2', 月薪資總額: '29501元至30300元', 月投保薪資: '30300' }),
        ...otherCategoryRows,
      ]),
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.effectiveFrom).toBe('2026-01-01')
    expect(parsed.records.map((record) => record.recordKey)).toEqual([
      'general-1',
      'general-2',
      'shelteredDisabled-1',
      'partTime-1',
      'vocationalTrainee-1',
    ])
    // `sort_order` 是政府的原始列序（`序號`），**不是** record_key 的來源：
    // 政府新增一種身分別會讓後面每一列的序號整批位移。
    expect(parsed.records.map((record) => record.sortOrder)).toEqual([1, 2, 20, 21, 22])
    expect(parsed.records[0]).toMatchObject({
      code: '1',
      name: '一般勞工',
      rangeFrom: null,
      rangeTo: '29500',
      amount: '29500',
      rate: null,
    })
    expect(parsed.records[0]?.data).toEqual({
      insuredCategoryCode: 'general',
      insuredCategoryName: '一般勞工',
      grade: '1',
      monthlySalaryRangeText: '29500元以下',
      monthlySalaryFrom: null,
      monthlySalaryTo: '29500',
      monthlyInsuredSalary: '29500',
    })
  })

  test('★ 缺「適用起日」一律失敗，不以任何值代替（計畫 §7.2）', () => {
    // 這是本模組最重要的一條規則：不得以同步當天、上一版生效日或任何推測值 fallback。
    // 「任何日期看起來都是合理的日期」，沒有一個斷言能說它不對——因此只能在這裡擋。
    const missing = parseLaborInsuranceSalaryGrades(JSON.stringify([row({ 適用起日: undefined })]))
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.reason).toContain('適用起日')

    // 空字串與缺欄位是同一件事（CSV 轉 JSON 時很常見）。
    expect(parseLaborInsuranceSalaryGrades(JSON.stringify([row({ 適用起日: '' })])).ok).toBe(false)
    // 有值但不合法（民國 114 年沒有 2/29）。
    expect(parseLaborInsuranceSalaryGrades(JSON.stringify([row({ 適用起日: '1140229' })])).ok).toBe(false)
  })

  test('★ 同一批出現兩個「適用起日」時失敗：生效日沒有唯一答案', () => {
    const mixed = parseLaborInsuranceSalaryGrades(
      JSON.stringify([row(), row({ 序號: '2', 投保薪資等級: '2', 適用起日: '1140101' })]),
    )
    expect(mixed.ok).toBe(false)
    if (mixed.ok) return
    expect(mixed.reason).toContain('2026-01-01')
    expect(mixed.reason).toContain('2025-01-01')
  })

  test('未知的身分別失敗：新增一類投保身分是法規變更，不能靜靜放行', () => {
    const unknown = parseLaborInsuranceSalaryGrades(JSON.stringify([row({ 身分別: '外籍看護工' })]))
    expect(unknown.ok).toBe(false)
    if (unknown.ok) return
    expect(unknown.reason).toContain('外籍看護工')
  })

  test('★ 少一種身分別也失敗，而且訊息要指出少了哪一種（與「多一種」對稱）', () => {
    // 政府**刪掉**一整類投保身分。這一批每一列都合法、生效日唯一、金額都是 decimal 字串
    // ——不擋的話它會解析成功、版本照樣寫進去，而「部分工時勞工」那一群人從此查不到任何級距，
    // 薪資結算產出一張沒有勞保扣款、金額完全合理的薪資單。
    const withoutPartTime = parseLaborInsuranceSalaryGrades(
      JSON.stringify([row(), ...otherCategoryRows.filter((entry) => entry['身分別'] !== '部分工時勞工')]),
    )

    expect(withoutPartTime.ok).toBe(false)
    if (withoutPartTime.ok) return
    // **指出少了哪一種**，不是只說「不完整」：這句話會原樣進 `sync_logs.error_message`，
    // 而看紀錄的人要能當場判斷這是政府廢止了那一類，還是我們只抓到半截資料。
    expect(withoutPartTime.reason).toContain('部分工時勞工')
    expect(withoutPartTime.reason).toContain('partTime')
    // 還在的那幾類也要印出來，否則看不出「少的是一類還是三類」。
    expect(withoutPartTime.reason).toContain('一般勞工')

    // 只有一般勞工時，三類全部列出來（少三種就報三種，不是報第一個就停）。
    const onlyGeneral = parseLaborInsuranceSalaryGrades(JSON.stringify([row()]))
    expect(onlyGeneral.ok).toBe(false)
    if (onlyGeneral.ok) return
    for (const name of ['庇護性身心障礙者', '部分工時勞工', '職訓機構受訓者']) {
      expect(onlyGeneral.reason).toContain(name)
    }
  })

  test('讀不懂的區間、非整數金額、壞掉的級數與序號都失敗', () => {
    expect(parseLaborInsuranceSalaryGrades(JSON.stringify([row({ 月薪資總額: '29500元以內' })])).ok).toBe(false)
    expect(parseLaborInsuranceSalaryGrades(JSON.stringify([row({ 月投保薪資: '2.95e4' })])).ok).toBe(false)
    expect(parseLaborInsuranceSalaryGrades(JSON.stringify([row({ 投保薪資等級: '一' })])).ok).toBe(false)
    expect(parseLaborInsuranceSalaryGrades(JSON.stringify([row({ 序號: 'A1' })])).ok).toBe(false)
  })

  test('record_key 重複時失敗，而不是留給資料庫的唯一鍵去撞', () => {
    const duplicated = parseLaborInsuranceSalaryGrades(JSON.stringify([row(), row({ 序號: '2' })]))
    expect(duplicated.ok).toBe(false)
    if (duplicated.ok) return
    expect(duplicated.reason).toContain('general-1')
  })

  test('不是 JSON、不是陣列、空陣列都失敗（空版本比同步失敗難查得多）', () => {
    expect(parseLaborInsuranceSalaryGrades('<html>維護中</html>').ok).toBe(false)
    expect(parseLaborInsuranceSalaryGrades(JSON.stringify({ data: [] })).ok).toBe(false)
    expect(parseLaborInsuranceSalaryGrades('[]').ok).toBe(false)
  })
})

/**
 * 每一筆 `data` 都要通得過該資料集的形狀定義（計畫 §6）。
 *
 * **這不是重複測試型別**：型別擋不到的那一半正好是最會出事的那一半——decimal 字串的 pattern
 * （`0.115` 是對的、`1.15e-1` 不是）、字面值聯集的實際值。解析器改成 `String(Number(x))`
 * 會通過編譯、通不過這一行。正式流程在寫入前跑的是同一支函式（`impl/` 的 run 切片）。
 */
const expectShapesValid = (datasetCode: RegulatoryDatasetCode, parsed: RegulatoryParseResult): void => {
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  for (const record of parsed.records) {
    const shape = parseRegulatoryRecordData(datasetCode, record.data)
    expect(shape.ok ? null : `${record.recordKey}：${shape.reason}`).toBeNull()
  }
}

describe('parseAmountRange：沒有「元」的區間句型（dataset_code=3 用的那一種）', () => {
  const options = { unit: '', label: '實際工資' } as const

  test('三種句型', () => {
    expect(parseAmountRange('1500以下', options)).toEqual({ ok: true, value: { from: null, to: '1500' } })
    expect(parseAmountRange('1501至3000', options)).toEqual({ ok: true, value: { from: '1501', to: '3000' } })
    expect(parseAmountRange('147901以上', options)).toEqual({ ok: true, value: { from: '147901', to: null } })
  })

  test('單位是必填參數，不是「有沒有都接受」', () => {
    // 帶「元」的句型在 unit='' 之下必須失敗，反之亦然。寬容的版本會讓政府把
    // `29500元以下` 改成 `29500以下` 這件事完全沒有症狀——而那正是最需要有人看一眼的時刻。
    expect(parseAmountRange('1500元以下', options).ok).toBe(false)
    expect(parseAmountRange('1500以下', { unit: '元', label: '月薪資總額' }).ok).toBe(false)
  })
})

describe('percentToRate：百分比字串 → 比率', () => {
  test('帶百分號（dataset_code=4）與不帶百分號（dataset_code=6）', () => {
    expect(percentToRate('11.5%', { suffix: '%', label: '「勞保普通費率」' })).toEqual({ ok: true, value: '0.115' })
    expect(percentToRate('1%', { suffix: '%', label: '「就保費率」' })).toEqual({ ok: true, value: '0.01' })
    expect(percentToRate('0.18', { suffix: '', label: '「行業別費率%」' })).toEqual({ ok: true, value: '0.0018' })
    expect(percentToRate('0.07', { suffix: '', label: '「上下班費率%」' })).toEqual({ ok: true, value: '0.0007' })
  })

  test('全程字串運算，不經過 float（§4.7）', () => {
    // `0.29 / 100` 在 IEEE 754 下是 0.0029000000000000002——那個值會通過 decimal 的 pattern、
    // 通過形狀驗證、寫進資料庫，然後在某一級的保費上差一塊錢。
    expect(percentToRate('0.29', { suffix: '', label: 'x' })).toEqual({ ok: true, value: '0.0029' })
    const parsed = percentToRate('11.5%', { suffix: '%', label: 'x' })
    expect(parsed.ok && typeof parsed.value).toBe('string')
  })

  test('百分號位置不對、不是數字都失敗', () => {
    expect(percentToRate('11.5', { suffix: '%', label: 'x' }).ok).toBe(false)
    expect(percentToRate('11.5%', { suffix: '', label: 'x' }).ok).toBe(false)
    expect(percentToRate('百分之十一點五%', { suffix: '%', label: 'x' }).ok).toBe(false)
    expect(percentToRate('1.15e1%', { suffix: '%', label: 'x' }).ok).toBe(false)
  })
})

describe('isDecimalSum：三個 decimal 字串的驗算（不同小數位數）', () => {
  test('政府那三個費率對得起來', () => {
    expect(isDecimalSum('0.0018', '0.0007', '0.0025')).toBe(true)
    expect(isDecimalSum('0.0018', '0.0007', '0.0026')).toBe(false)
    // 小數位數不同也要算得對（`0.25` 與 `0.250` 是同一個值）。
    expect(isDecimalSum('0.1', '0.15', '0.250')).toBe(true)
  })
})

describe('parseRocEffectiveDateFromText：從中文說明裡取生效日（dataset_code=4、6）', () => {
  test('實測的兩段資源說明', () => {
    expect(
      parseRocEffectiveDateFromText(
        '勞工保險普通事故及就業保險合計之保險費分擔金額表(自115年1月1日起適用)',
        '資源說明',
      ),
    ).toEqual({ ok: true, value: '2026-01-01' })
    expect(parseRocEffectiveDateFromText('勞工職業災害保險適用行業別及費率表(114年1月1日起適用)', '資源說明')).toEqual({
      ok: true,
      value: '2025-01-01',
    })
  })

  test('★ 西元寫法不會被當成民國（那是「完全合理的錯日期」）', () => {
    // 少了 `(?<!\d)` 的話 `2026年` 會 match 到 `026年`，算成民國 26 年（1937）。
    expect(parseRocEffectiveDateFromText('本表自2026年1月1日起適用', '資源說明').ok).toBe(false)
  })

  test('★ 讀不到、讀不懂、有兩個日期都失敗（計畫 §7.2）', () => {
    expect(parseRocEffectiveDateFromText('勞工職業災害保險適用行業別及費率表', '資源說明').ok).toBe(false)
    // 措辭改了（「起實施」不是「起適用」）→ 失敗，不猜。
    expect(parseRocEffectiveDateFromText('自115年1月1日起實施', '資源說明').ok).toBe(false)
    // 沒有「日」就沒有唯一的日期。
    expect(parseRocEffectiveDateFromText('自115年1月起適用', '資源說明').ok).toBe(false)
    // 日期本身不合法（民國 114 年沒有 2/29）。
    expect(parseRocEffectiveDateFromText('自114年2月29日起適用', '資源說明').ok).toBe(false)

    const ambiguous = parseRocEffectiveDateFromText('115年1月1日起適用，114年1月1日起適用者請見歷史版本', '資源說明')
    expect(ambiguous.ok).toBe(false)
    if (ambiguous.ok) return
    expect(ambiguous.reason).toContain('2026-01-01')
    expect(ambiguous.reason).toContain('2025-01-01')
  })

  test('同一個日期寫兩次不是歧義', () => {
    expect(parseRocEffectiveDateFromText('115年1月1日起適用（115年1月1日起適用）', '資源說明')).toEqual({
      ok: true,
      value: '2026-01-01',
    })
  })
})

// ---------------------------------------------------------------------------
// dataset_code = 3　勞工退休金月提繳工資分級表
// ---------------------------------------------------------------------------

/** 政府那一份的一列（`6274`）。 */
const pensionRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  等級: '1',
  '實際工資/執行業務所得': '1500以下',
  '月提繳工資金額/月提繳執行業務所得金額': '1500',
  生效日: '1150101',
  備註: '',
  ...overrides,
})

/**
 * 一張**完整**的三級表：第一級沒有下限、最後一級沒有上限、中間首尾相接。
 *
 * 三條完整性檢查都是「整張表」的性質，因此每一份要成功解析的測試資料都必須是完整的一張表
 * ——只寫要驗的那一列會在完整性檢查那一步失敗，看起來像規則寫錯，其實是測試資料不完整。
 */
const pensionRows = [
  pensionRow(),
  pensionRow({ 等級: '2', '實際工資/執行業務所得': '1501至3000', '月提繳工資金額/月提繳執行業務所得金額': '3000' }),
  pensionRow({ 等級: '3', '實際工資/執行業務所得': '3001以上', '月提繳工資金額/月提繳執行業務所得金額': '4500' }),
]

describe('parseLaborPensionContributionWageGrades：dataset_code=3 的解析器', () => {
  test('成功路徑：生效日、record_key、級距與金額', () => {
    const parsed = parseLaborPensionContributionWageGrades(JSON.stringify(pensionRows))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.effectiveFrom).toBe('2026-01-01')
    expect(parsed.records.map((record) => record.recordKey)).toEqual(['grade-1', 'grade-2', 'grade-3'])
    expect(parsed.records.map((record) => record.sortOrder)).toEqual([1, 2, 3])
    expect(parsed.records[1]).toMatchObject({
      code: '2',
      // 這個資料集沒有身分別那樣的顯示名稱，硬塞一個固定字串只會讓每一筆長得一樣。
      name: null,
      rangeFrom: '1501',
      rangeTo: '3000',
      amount: '3000',
      rate: null,
    })
    expect(parsed.records[0]?.data).toEqual({
      grade: '1',
      actualWageRangeText: '1500以下',
      // 最低一級沒有下限：留 null，不補 0（補了之後一支寫錯的級距查詢會回一個看起來正常的級距）。
      actualWageFrom: null,
      actualWageTo: '1500',
      monthlyContributionWage: '1500',
      // 實測 62 列的「備註」全是空字串；空字串收斂成 null。
      remark: null,
    })
    // 最高一級：區間是「3001以上」而金額是 4500，兩者不是同一個數，因此各佔一欄。
    expect(parsed.records[2]?.data).toMatchObject({ actualWageTo: null, monthlyContributionWage: '4500' })
    expectShapesValid(3, parsed)
  })

  test('中文區間欄位：三種句型都拆得開，而且值是字串不是 number（§4.7）', () => {
    const parsed = parseLaborPensionContributionWageGrades(JSON.stringify(pensionRows))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const record of parsed.records) {
      expect(typeof record.amount).toBe('string')
      // `2.95e4` 這種值通得過編譯、通不過形狀定義的 decimal pattern。
      expect(record.amount).toMatch(/^\d+$/)
    }
    expect(parsed.records.map((record) => [record.rangeFrom, record.rangeTo])).toEqual([
      [null, '1500'],
      ['1501', '3000'],
      ['3001', null],
    ])
  })

  test('★ 缺「生效日」一律失敗，不以任何值代替（計畫 §7.2）', () => {
    const missing = parseLaborPensionContributionWageGrades(JSON.stringify([pensionRow({ 生效日: undefined })]))
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.reason).toContain('生效日')

    // 空字串與缺欄位是同一件事；有值但不合法（民國 114 年沒有 2/29）也一樣。
    expect(parseLaborPensionContributionWageGrades(JSON.stringify([pensionRow({ 生效日: '' })])).ok).toBe(false)
    expect(parseLaborPensionContributionWageGrades(JSON.stringify([pensionRow({ 生效日: '1140229' })])).ok).toBe(false)
  })

  test('★ 同一批出現兩個「生效日」時失敗：生效日沒有唯一答案', () => {
    const mixed = parseLaborPensionContributionWageGrades(
      JSON.stringify([pensionRows[0], { ...pensionRows[1], 生效日: '1140101' }, pensionRows[2]]),
    )
    expect(mixed.ok).toBe(false)
    if (mixed.ok) return
    expect(mixed.reason).toContain('2026-01-01')
    expect(mixed.reason).toContain('2025-01-01')
  })

  test('★ 完整性（一）：級數跳號時失敗——少一級會讓那一段工資悄悄查不到', () => {
    const gap = parseLaborPensionContributionWageGrades(
      JSON.stringify([
        pensionRows[0],
        // 政府刪掉第 2 級，第 3 級照舊叫「3」。
        pensionRow({ 等級: '3', '實際工資/執行業務所得': '3001以上', '月提繳工資金額/月提繳執行業務所得金額': '4500' }),
      ]),
    )
    expect(gap.ok).toBe(false)
    if (gap.ok) return
    expect(gap.reason).toContain('等級')
  })

  test('★ 完整性（二）：級距之間有缺口時失敗——級數連號也擋不住的那一種', () => {
    // 政府刪掉中間一級**並且**重新編號：級數仍然是 1、2、3，只有金額露出缺口。
    const hole = parseLaborPensionContributionWageGrades(
      JSON.stringify([
        pensionRows[0],
        pensionRow({
          等級: '2',
          '實際工資/執行業務所得': '4501至6000',
          '月提繳工資金額/月提繳執行業務所得金額': '6000',
        }),
        pensionRow({
          等級: '3',
          '實際工資/執行業務所得': '6001以上',
          '月提繳工資金額/月提繳執行業務所得金額': '7500',
        }),
      ]),
    )
    expect(hole.ok).toBe(false)
    if (hole.ok) return
    expect(hole.reason).toContain('缺口')
  })

  test('★ 完整性（三）：最後一級不是「N以上」時失敗——這是「只抓到半截」的攔截點', () => {
    const truncated = parseLaborPensionContributionWageGrades(JSON.stringify(pensionRows.slice(0, 2)))
    expect(truncated.ok).toBe(false)
    if (truncated.ok) return
    expect(truncated.reason).toContain('最後一級')

    // 反方向：第一級如果不是「N以下」，代表低薪那一段被截掉了。
    const noLowest = parseLaborPensionContributionWageGrades(
      JSON.stringify([
        { ...pensionRows[1], 等級: '1' },
        { ...pensionRows[2], 等級: '2' },
      ]),
    )
    expect(noLowest.ok).toBe(false)
    if (noLowest.ok) return
    expect(noLowest.reason).toContain('第一級')
  })

  test('讀不懂的區間、非整數金額、壞掉的級數都失敗', () => {
    const withBadRange = [{ ...pensionRows[1], '實際工資/執行業務所得': '1501~3000' }]
    expect(parseLaborPensionContributionWageGrades(JSON.stringify(withBadRange)).ok).toBe(false)
    expect(
      parseLaborPensionContributionWageGrades(
        JSON.stringify([pensionRow({ '月提繳工資金額/月提繳執行業務所得金額': '1.5e3' })]),
      ).ok,
    ).toBe(false)
    expect(parseLaborPensionContributionWageGrades(JSON.stringify([pensionRow({ 等級: '一' })])).ok).toBe(false)
  })

  test('不是 JSON、不是陣列、空陣列都失敗（空版本比同步失敗難查得多）', () => {
    expect(parseLaborPensionContributionWageGrades('<html>維護中</html>').ok).toBe(false)
    expect(parseLaborPensionContributionWageGrades(JSON.stringify({ data: [] })).ok).toBe(false)
    expect(parseLaborPensionContributionWageGrades('[]').ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// dataset_code = 4　勞就保保險費分擔金額表
// ---------------------------------------------------------------------------

/** 2026-08 實測的資源說明（生效日唯一的來源）。 */
const PREMIUM_DESCRIPTION = '勞工保險普通事故及就業保險合計之保險費分擔金額表(自115年1月1日起適用)'

const premiumContext = (resourceDescription: string | null = PREMIUM_DESCRIPTION): RegulatoryParseContext => ({
  resourceDescription,
})

/** 政府那一份的一列（`6259`）。 */
const premiumRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  序號: '1',
  勞保普通費率: '11.5%',
  就保費率: '1%',
  投保薪資: '11100',
  勞工應負擔保費金額: '277',
  單位應負擔保費金額: '972',
  ...overrides,
})

const premiumRows = [
  premiumRow(),
  premiumRow({ 序號: '2', 投保薪資: '12540', 勞工應負擔保費金額: '313', 單位應負擔保費金額: '1097' }),
  premiumRow({ 序號: '3', 投保薪資: '13500', 勞工應負擔保費金額: '338', 單位應負擔保費金額: '1182' }),
]

describe('parseLaborEmploymentInsurancePremiumShares：dataset_code=4 的解析器', () => {
  test('成功路徑：生效日來自資源說明、record_key 用投保薪資', () => {
    const parsed = parseLaborEmploymentInsurancePremiumShares(JSON.stringify(premiumRows), premiumContext())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // ⚠️ 這個日期是**分擔金額表**的適用日，不是勞保費率 11.5% 的生效日（那個是 114/1/1）。
    // 計畫 §3.1 把這件事記成一個坑；本資料集做成金額表而不是費率表，就是為了繞開它。
    expect(parsed.effectiveFrom).toBe('2026-01-01')
    expect(parsed.records.map((record) => record.recordKey)).toEqual(['salary-11100', 'salary-12540', 'salary-13500'])
    expect(parsed.records.map((record) => record.sortOrder)).toEqual([1, 2, 3])
    expect(parsed.records[0]).toMatchObject({
      // 這張表沒有業務代碼欄與顯示名稱欄；`序號` 是列序，它的位置是 sort_order。
      code: null,
      name: null,
      // 不是級距表：每一列對應一個確切的投保薪資，填假區間會讓級距查詢寫得出來而且看起來成立。
      rangeFrom: null,
      rangeTo: null,
      amount: '11100',
      // 兩個費率各佔 data 的一欄；`rate` 只有一欄，填勞保費率會讓就保那 1% 在這一層消失。
      rate: null,
    })
    expect(parsed.records[0]?.data).toEqual({
      insuredSalary: '11100',
      laborInsuranceRate: '0.115',
      employmentInsuranceRate: '0.01',
      employeeShareAmount: '277',
      employerShareAmount: '972',
    })
    expectShapesValid(4, parsed)
  })

  test('百分比欄位轉成比率，而且全部是字串不是 number（§4.7）', () => {
    const parsed = parseLaborEmploymentInsurancePremiumShares(JSON.stringify(premiumRows), premiumContext())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const record of parsed.records) {
      const data = record.data as Record<string, unknown>
      // 比率（0.115）而不是百分比數字（11.5）：兩者都是合法的 decimal 字串、都通得過形狀驗證，
      // 而算出來的金額差 100 倍。
      expect(data['laborInsuranceRate']).toBe('0.115')
      expect(typeof data['employeeShareAmount']).toBe('string')
      expect(typeof record.amount).toBe('string')
    }
  })

  test('★ 資源說明讀不到或讀不懂時失敗，不以任何值代替（計畫 §7.2）', () => {
    // 政府沒給說明。
    const noDescription = parseLaborEmploymentInsurancePremiumShares(JSON.stringify(premiumRows), premiumContext(null))
    expect(noDescription.ok).toBe(false)
    if (noDescription.ok) return
    expect(noDescription.reason).toContain('資源說明')

    // 給了說明但裡面沒有日期（政府改了措辭）。
    const noDate = parseLaborEmploymentInsurancePremiumShares(
      JSON.stringify(premiumRows),
      premiumContext('勞工保險普通事故及就業保險合計之保險費分擔金額表'),
    )
    expect(noDate.ok).toBe(false)

    // 資源內容裡**沒有任何日期欄位**，因此沒有第二條路可以退回去——這一條是刻意的，
    // 退回去的那條路一定是某種推測值。
    expect(JSON.stringify(premiumRows)).not.toContain('生效日')
  })

  test('★ 完整性（一）：整批只能有一組費率', () => {
    const mixedRates = parseLaborEmploymentInsurancePremiumShares(
      JSON.stringify([premiumRows[0], { ...premiumRows[1], 勞保普通費率: '10%' }, premiumRows[2]]),
      premiumContext(),
    )
    expect(mixedRates.ok).toBe(false)
    if (mixedRates.ok) return
    expect(mixedRates.reason).toContain('一組費率')
  })

  test('★ 完整性（二）（三）：序號跳號、投保薪資沒有遞增都失敗', () => {
    const gap = parseLaborEmploymentInsurancePremiumShares(
      JSON.stringify([premiumRows[0], premiumRows[2]]),
      premiumContext(),
    )
    expect(gap.ok).toBe(false)
    if (gap.ok) return
    expect(gap.reason).toContain('序號')

    // 投保薪資變小：欄位對調或順序被打亂，而每一個值單獨看都完全合法。
    const notIncreasing = parseLaborEmploymentInsurancePremiumShares(
      JSON.stringify([premiumRows[0], { ...premiumRows[1], 投保薪資: '11100' }, premiumRows[2]]),
      premiumContext(),
    )
    expect(notIncreasing.ok).toBe(false)
    if (notIncreasing.ok) return
    expect(notIncreasing.reason).toContain('遞增')
  })

  test('費率少了百分號、金額不是整數都失敗', () => {
    expect(
      parseLaborEmploymentInsurancePremiumShares(JSON.stringify([premiumRow({ 就保費率: '1' })]), premiumContext()).ok,
    ).toBe(false)
    expect(
      parseLaborEmploymentInsurancePremiumShares(
        JSON.stringify([premiumRow({ 勞工應負擔保費金額: '277.5' })]),
        premiumContext(),
      ).ok,
    ).toBe(false)
  })

  test('不是 JSON、不是陣列、空陣列都失敗', () => {
    expect(parseLaborEmploymentInsurancePremiumShares('<html>維護中</html>', premiumContext()).ok).toBe(false)
    expect(parseLaborEmploymentInsurancePremiumShares(JSON.stringify({ data: [] }), premiumContext()).ok).toBe(false)
    expect(parseLaborEmploymentInsurancePremiumShares('[]', premiumContext()).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// dataset_code = 6　職業災害保險行業別費率
// ---------------------------------------------------------------------------

/** 2026-08 實測的資源說明（生效日唯一的來源）。 */
const ACCIDENT_DESCRIPTION = '勞工職業災害保險適用行業別及費率表(114年1月1日起適用)'

const accidentContext = (resourceDescription: string | null = ACCIDENT_DESCRIPTION): RegulatoryParseContext => ({
  resourceDescription,
})

/**
 * 政府那一份的 19 種 `大分類` 原文（2026-08 實測的完整清單）。
 *
 * **測試自己列一份是刻意的**：解析器那一份是「我們期望有哪幾種」，這一份是「政府實際給了哪幾種」。
 * 兩份都從同一個常數推導的話，有人改壞解析器的清單時這批測試會跟著改壞而完全不紅。
 */
const MAJOR_CATEGORIES = [
  '農、林、漁、牧業',
  '礦業及土石採取業',
  '製造業',
  '電力及燃氣供應業',
  '用水供應及污染整治業',
  '營建工程業',
  '批發及零售業',
  '運輸及倉儲業',
  '住宿及餐飲業',
  '出版影音及資通訊業',
  '金融及保險業',
  '不動產業',
  '專業、科學及技術服務業',
  '支援服務業',
  '公共行政及國防；強制性社會安全',
  '教育業',
  '醫療保健及社會工作服務業',
  '藝術、娛樂及休閒服務業',
  '其他服務業',
] as const

/** 政府那一份的一列（`6262`）。 */
const accidentRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  序號: '1',
  大分類: MAJOR_CATEGORIES[0],
  費率編號: '1',
  行業類別: '農、林、牧業',
  '行業別費率%': '0.18',
  '上下班費率%': '0.07',
  '災保費率%': '0.25',
  ...overrides,
})

/** 19 種大分類各一列。**每一份要成功解析的資料都必須齊全**：缺一種即整批失敗。 */
const accidentRows = MAJOR_CATEGORIES.map((name, index) =>
  accidentRow({
    序號: String(index + 1),
    大分類: name,
    費率編號: String(index + 1),
    行業類別: `${name}－細項`,
  }),
)

describe('parseOccupationalAccidentInsuranceRates：dataset_code=6 的解析器', () => {
  test('成功路徑：生效日來自資源說明、record_key 用費率編號、rate 是合計費率', () => {
    const parsed = parseOccupationalAccidentInsuranceRates(JSON.stringify(accidentRows), accidentContext())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.effectiveFrom).toBe('2025-01-01')
    expect(parsed.records).toHaveLength(19)
    expect(parsed.records[0]?.recordKey).toBe('industry-1')
    expect(parsed.records[0]).toMatchObject({
      code: '1',
      name: '農、林、漁、牧業－細項',
      rangeFrom: null,
      rangeTo: null,
      // 本資料集不含金額：職災保費 = 投保薪資 × 費率，投保薪資來自另一個資料集。
      amount: null,
      // **合計**費率，不是行業別費率——填後者的話每一家公司都會少算上下班那 0.07%。
      rate: '0.0025',
      sortOrder: 1,
    })
    expect(parsed.records[0]?.data).toEqual({
      majorCategoryCode: 'agricultureForestryFishingAnimalHusbandry',
      majorCategoryName: '農、林、漁、牧業',
      rateCode: '1',
      industryName: '農、林、漁、牧業－細項',
      industryRate: '0.0018',
      commutingRate: '0.0007',
      occupationalAccidentRate: '0.0025',
    })
    expectShapesValid(6, parsed)
  })

  test('19 個大分類原文都對得上我們的代碼（總對總，兩個方向都封閉）', () => {
    const parsed = parseOccupationalAccidentInsuranceRates(JSON.stringify(accidentRows), accidentContext())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const codes = parsed.records.map((record) => (record.data as { majorCategoryCode: string }).majorCategoryCode)
    expect(new Set(codes).size).toBe(19)
  })

  test('費率一律是字串比率，不是 number 也不是百分比數字（§4.7）', () => {
    const parsed = parseOccupationalAccidentInsuranceRates(JSON.stringify(accidentRows), accidentContext())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const record of parsed.records) {
      expect(typeof record.rate).toBe('string')
      // 0.25%（政府欄位的值是 `0.25`）→ 0.0025。留成 `0.25` 的話保費會差 100 倍。
      expect(record.rate).toBe('0.0025')
    }
  })

  test('★ 資源說明讀不到或讀不懂時失敗（計畫 §7.2）', () => {
    const noDescription = parseOccupationalAccidentInsuranceRates(JSON.stringify(accidentRows), accidentContext(null))
    expect(noDescription.ok).toBe(false)
    if (noDescription.ok) return
    expect(noDescription.reason).toContain('資源說明')

    expect(
      parseOccupationalAccidentInsuranceRates(
        JSON.stringify(accidentRows),
        accidentContext('勞工職業災害保險適用行業別及費率表'),
      ).ok,
    ).toBe(false)
  })

  test('未知的大分類失敗：行業標準分類改版是法規變更，不能靜靜放行', () => {
    const unknown = parseOccupationalAccidentInsuranceRates(
      JSON.stringify([...accidentRows, accidentRow({ 序號: '20', 費率編號: '20', 大分類: '太空產業' })]),
      accidentContext(),
    )
    expect(unknown.ok).toBe(false)
    if (unknown.ok) return
    expect(unknown.reason).toContain('太空產業')
  })

  test('★ 少一種大分類也失敗，而且訊息要指出少了哪一種（與「多一種」對稱）', () => {
    // 政府刪掉一整類。這一批每一列都合法、費率都對得起來、生效日也讀得到
    // ——不擋的話它會解析成功、版本照樣寫進去，而屬於「營建工程業」的公司從此查不到費率，
    // 職災保費算成 0，薪資單與申報金額都是完全合理的數字。
    const withoutConstruction = parseOccupationalAccidentInsuranceRates(
      JSON.stringify(
        accidentRows
          .filter((row) => row['大分類'] !== '營建工程業')
          .map((row, index) => ({ ...row, 序號: String(index + 1) })),
      ),
      accidentContext(),
    )
    expect(withoutConstruction.ok).toBe(false)
    if (withoutConstruction.ok) return
    expect(withoutConstruction.reason).toContain('營建工程業')
    expect(withoutConstruction.reason).toContain('construction')
  })

  test('★ 三個費率對不起來時失敗：欄位換位置之後每一個值單獨看都合法', () => {
    const wrongSum = parseOccupationalAccidentInsuranceRates(
      JSON.stringify(accidentRows.map((row, index) => (index === 0 ? { ...row, '災保費率%': '0.26' } : row))),
      accidentContext(),
    )
    expect(wrongSum.ok).toBe(false)
    if (wrongSum.ok) return
    expect(wrongSum.reason).toContain('對不起來')
  })

  test('record_key 重複時失敗，而不是留給資料庫的唯一鍵去撞', () => {
    const duplicated = parseOccupationalAccidentInsuranceRates(
      JSON.stringify([...accidentRows, accidentRow({ 序號: '20', 費率編號: '1', 大分類: '製造業' })]),
      accidentContext(),
    )
    expect(duplicated.ok).toBe(false)
    if (duplicated.ok) return
    expect(duplicated.reason).toContain('industry-1')
  })

  test('不是 JSON、不是陣列、空陣列都失敗', () => {
    expect(parseOccupationalAccidentInsuranceRates('<html>維護中</html>', accidentContext()).ok).toBe(false)
    expect(parseOccupationalAccidentInsuranceRates(JSON.stringify({ data: [] }), accidentContext()).ok).toBe(false)
    expect(parseOccupationalAccidentInsuranceRates('[]', accidentContext()).ok).toBe(false)
  })
})

describe('selectDataGovResource：resource discovery（計畫 §7.0）', () => {
  /** 形狀取自 2026-08 實測的 `GET https://data.gov.tw/api/v2/rest/dataset/6258`。 */
  const metadata = JSON.stringify({
    success: true,
    result: {
      datasetId: 6258,
      title: '勞工保險投保薪資分級表',
      modifiedDate: '2026-01-02 09:58:56',
      distribution: [
        {
          resourceFormat: 'CSV',
          resourceDescription: '勞工保險投保薪資分級表(115年1月1日起適用)',
          resourceDownloadUrl: 'https://apiservice.mol.gov.tw/OdService/download/A17000000J-020014-Uy8',
        },
        {
          resourceFormat: 'JSON',
          resourceDescription: '勞工保險投保薪資分級表(115年1月1日起適用)',
          resourceDownloadUrl: 'https://apiservice.mol.gov.tw/OdService/download/A17000000J-020014-rpF',
        },
      ],
    },
  })

  test('metadata 網址只由 datasetId 組出來（那是唯一可以硬編的政府識別碼）', () => {
    expect(toDataGovMetadataUrl(6258)).toBe('https://data.gov.tw/api/v2/rest/dataset/6258')
  })

  test('挑到指定格式那一筆，而且網址是當次探索到的（帶隨機尾碼）', () => {
    const picked = selectDataGovResource(metadata, 'JSON')
    expect(picked.ok).toBe(true)
    if (!picked.ok) return
    expect(picked.value.downloadUrl).toBe('https://apiservice.mol.gov.tw/OdService/download/A17000000J-020014-rpF')
    expect(picked.value.sourceModifiedAt).toBe('2026-01-02 09:58:56')
  })

  test('挑不到指定格式時失敗，不回退到別的格式', () => {
    // 回退的話，解析器會拿到一串 CSV 然後在 `JSON.parse` 失敗，
    // 而錯誤訊息會指向解析器，不會指向「探索階段挑錯了」。
    const picked = selectDataGovResource(metadata, 'XML')
    expect(picked.ok).toBe(false)
    if (picked.ok) return
    expect(picked.reason).toContain('CSV')
    expect(picked.reason).toContain('JSON')
  })

  test('非 https 的資源網址失敗', () => {
    const insecure = JSON.stringify({
      result: {
        modifiedDate: '2026-01-02 09:58:56',
        distribution: [{ resourceFormat: 'JSON', resourceDownloadUrl: 'http://apiservice.mol.gov.tw/x' }],
      },
    })
    expect(selectDataGovResource(insecure, 'JSON').ok).toBe(false)
  })

  test('modifiedDate 壞掉時是 null，不是整批失敗：它不是 effective_from', () => {
    const odd = JSON.stringify({
      result: {
        modifiedDate: '2026/01/02',
        distribution: [{ resourceFormat: 'JSON', resourceDownloadUrl: 'https://example.gov.tw/a' }],
      },
    })
    const picked = selectDataGovResource(odd, 'JSON')
    expect(picked.ok).toBe(true)
    if (!picked.ok) return
    expect(picked.value.sourceModifiedAt).toBeNull()
  })

  test('metadata 本身壞掉時失敗', () => {
    expect(selectDataGovResource('<html>', 'JSON').ok).toBe(false)
    expect(selectDataGovResource(JSON.stringify({ result: {} }), 'JSON').ok).toBe(false)
  })
})

describe('心跳逾時判定與版本代碼', () => {
  test('isHeartbeatStale：門檻當下不算逾時，早一秒才算（計畫 §3.4）', () => {
    // 「超過 3 分鐘」是嚴格大於：剛好卡在門檻上的那一次心跳，程序還活著。
    expect(isHeartbeatStale('2026-08-28 12:00:00', '2026-08-28 12:00:00')).toBe(false)
    expect(isHeartbeatStale('2026-08-28 11:59:59', '2026-08-28 12:00:00')).toBe(true)
    expect(isHeartbeatStale('2026-08-28 12:00:01', '2026-08-28 12:00:00')).toBe(false)
    // 跨日與跨年：固定寬度格式的字典序就是時間序，這一條擋的是有人改成 `MM/DD` 之類的格式。
    expect(isHeartbeatStale('2025-12-31 23:59:59', '2026-01-01 00:00:00')).toBe(true)
  })

  test('toVersionCode：由生效日推導 YYYY-MM（與 migration 0015 的 2021-01 同形）', () => {
    expect(toVersionCode('2026-01-01')).toBe('2026-01')
    expect(toVersionCode('2025-12-31')).toBe('2025-12')
  })

  test('isSyncableDatasetCode：1–6、8、9 都同步得了，人工維護的 10 與永久空號 7 不是', () => {
    for (const code of [1, 2, 3, 4, 5, 6, 8, 9]) expect(isSyncableDatasetCode(code)).toBe(true)
    // `7` 永久空號、`10` 沒有任何來源（計畫 §3.1.1），兩者都不會有解析器。
    expect(isSyncableDatasetCode(7)).toBe(false)
    expect(isSyncableDatasetCode(10)).toBe(false)
  })

  test('SYNCABLE_DATASET_CODES 與 REGULATORY_SYNC_SOURCES 的 key 一字不差', () => {
    // 兩者互相釘死是編譯期的事（見 `regulatory-sync-source.ts` 檔頭），這一條驗的是
    // **執行期真的一致**——排程器現在直接掃這個陣列，而 `runSync` 是拿代碼去查那個物件的。
    // 少了它，一個「型別上對得起來、執行期少一個 key」的重構會讓某個資料集安靜地永遠不被同步。
    const codes: readonly number[] = SYNCABLE_DATASET_CODES
    expect([...codes]).toEqual(Object.keys(REGULATORY_SYNC_SOURCES).map(Number))
  })
})

// ---------------------------------------------------------------------------
// dataset_code = 2、5：健保署那兩份（CSV ＋ 多版本）
// ---------------------------------------------------------------------------

/** `dataset_code=2` 的表頭，逐字取自實測（全形括號是政府原文的一部分）。 */
const HEALTH_GRADE_HEADER = '組別級距,投保等級,月投保金額（元）,實際薪資月額（元）'

/**
 * 組一份 `dataset_code=2` 的 CSV。**帶 BOM、CRLF 換行、尾端一個換行**——三者都是實測的形態，
 * 而三者都各自弄壞過一次解析（BOM 讓第一個欄位名對不上、CRLF 讓最後一欄多一個 `\r`、
 * 尾端換行多出一列空的）。用真實形態當預設，那三件事就每一條測試都在驗。
 */
const healthGradeCsv = (...rows: readonly string[]): string => `﻿${[HEALTH_GRADE_HEADER, ...rows].join('\r\n')}\r\n`

/** 三級的完整分級表：頭一級沒有下限、末一級沒有上限、中間首尾相接。 */
const HEALTH_GRADE_ROWS = [
  '第一組級距1200元,1,29500,29500以下',
  '第二組級距1500元,2,30300,29501-30300',
  '第二組級距1500元,3,31800,30301以上',
] as const

/** `dataset_code=5` 的表頭。**負擔比率就寫在裡面**，因此逐字比對同時是「比率有沒有變」的檢查。 */
const HEALTH_SHARE_HEADER =
  '投保金額等級,月投保金額,本人負擔金額（負擔比率30%）,本人+1眷口負擔金額,本人+2眷口負擔金額,本人+3眷口負擔金額,投保單位負擔金額（負擔比率60%）,政府補助金額（補助比率10%）'

const healthShareCsv = (...rows: readonly string[]): string => `﻿${[HEALTH_SHARE_HEADER, ...rows].join('\r\n')}\r\n`

/** 兩級，值逐字取自政府 115年1月 那一份的前兩列。 */
const HEALTH_SHARE_ROWS = ['1,29500,458,916,1374,1832,1428,238', '2,30300,470,940,1410,1880,1466,244'] as const

describe('parseCsvTable：政府 CSV 的讀取（dataset_code=2、5 共用）', () => {
  const options = { header: ['甲', '乙'], quoting: 'reject', label: '測試表' } as const

  test('BOM、CRLF、尾端換行都不影響結果', () => {
    const parsed = parseCsvTable('﻿甲,乙\r\n1,2\r\n', options)
    expect(parsed).toEqual({ ok: true, rows: [{ 甲: '1', 乙: '2' }] })
  })

  test('★ 表頭逐字比對：改名、改順序、多一欄少一欄都失敗', () => {
    // 「找得到就好」的比對會讓政府把 `本人負擔金額（負擔比率30%）` 改成 40% 這件事完全沒有症狀。
    expect(parseCsvTable('甲,丙\n1,2\n', options).ok).toBe(false)
    expect(parseCsvTable('乙,甲\n1,2\n', options).ok).toBe(false)
    expect(parseCsvTable('甲,乙,丙\n1,2,3\n', options).ok).toBe(false)
    expect(parseCsvTable('甲\n1\n', options).ok).toBe(false)
  })

  test('欄位數對不上一律失敗，不補空值也不忽略多的那一欄', () => {
    // 補空值會讓「政府少給一欄」變成「那一欄是空的」，而後者的錯誤訊息會指向欄位內容。
    expect(parseCsvTable('甲,乙\n1\n', options).ok).toBe(false)
    expect(parseCsvTable('甲,乙\n1,2,3\n', options).ok).toBe(false)
  })

  test('只有表頭、空內容都失敗；宣告 reject 時出現引號也失敗', () => {
    expect(parseCsvTable('甲,乙\n', options).ok).toBe(false)
    expect(parseCsvTable('', options).ok).toBe(false)
    // `2`、`5` 宣告 `reject`：那兩份實測從未出現引號，冒出引號代表某一欄的值裡有了逗號。
    expect(parseCsvTable('甲,乙\n"1,x",2\n', options).ok).toBe(false)
  })

  test('★ 宣告 rfc4180 時讀得懂引號欄位（`dataset_code=9` 每一列都有）', () => {
    const quoted = { header: ['甲', '乙'], quoting: 'rfc4180', label: '測試表' } as const
    // 加引號正是因為值裡有逗號——把它切成兩欄會讓後面每一欄整批位移。
    expect(parseCsvTable('甲,乙\n"1,x",2\n', quoted)).toEqual({ ok: true, rows: [{ 甲: '1,x', 乙: '2' }] })
    // `""` 是一個引號字元本身。
    expect(parseCsvTable('甲,乙\n"a""b",2\n', quoted)).toEqual({ ok: true, rows: [{ 甲: 'a"b', 乙: '2' }] })
    // 沒有結尾引號、引號在欄位中間、引號後面不是逗號——三種都失敗，不猜。
    expect(parseCsvTable('甲,乙\n"1,x,2\n', quoted).ok).toBe(false)
    expect(parseCsvTable('甲,乙\n1"x,2\n', quoted).ok).toBe(false)
    expect(parseCsvTable('甲,乙\n"1"x,2\n', quoted).ok).toBe(false)
  })
})

describe('parseRocYearMonthFromText：健保署資源說明的「N年M月」', () => {
  test('實測的兩段資源說明', () => {
    expect(parseRocYearMonthFromText('115年1月全民健康保險投保金額分級表', '資源說明')).toEqual({
      ok: true,
      value: '2026-01-01',
    })
    expect(parseRocYearMonthFromText('111年7月有一定雇主受僱者健保費負擔金額表', '資源說明')).toEqual({
      ok: true,
      value: '2022-07-01',
    })
  })

  test('★ 只有年份時失敗，而且訊息要講明是「只有年份」（計畫 §7.2）', () => {
    // `20251` 的 16 個資源裡有 9 個長這樣。挑一個「1 月 1 日」正是禁止的推測值——
    // 同一年可能有兩次調整（實測 `20246` 有 102年1月 與 102年7月）。
    const parsed = parseRocYearMonthFromText('100年全民健康保險投保金額分級表', '資源說明')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('只有年份')
    // 「政府沒寫」與「讀不懂」要分得出來：前者重跑一百次也一樣。
    expect(parseRocYearMonthFromText('全民健康保險投保金額分級表', '資源說明').ok).toBe(false)
  })

  test('★ 西元寫法不會被當成民國，兩個不同年月也失敗', () => {
    // `2026年1月` 少了 `(?<!\d)` 會 match 到 `026年`，算成民國 26 年（1937）。
    expect(parseRocYearMonthFromText('2026年1月分級表', '資源說明').ok).toBe(false)
    expect(parseRocYearMonthFromText('115年1月與114年1月分級表', '資源說明').ok).toBe(false)
    // 同一個年月寫兩次不是歧義。
    expect(parseRocYearMonthFromText('115年1月分級表（115年1月起）', '資源說明')).toEqual({
      ok: true,
      value: '2026-01-01',
    })
    // 月份不合法時走日曆檢查那條失敗分支。
    expect(parseRocYearMonthFromText('115年13月分級表', '資源說明').ok).toBe(false)
  })

  test('來源設定上的 deriveEffectiveFrom 就是這一支（`2` 與 `5` 共用）', () => {
    // 驗的是**接線**：解析器與同步流程都靠它，而它若被接成別的函式，
    // 「生效日從哪裡來」這個問題就會有兩個答案。
    for (const code of [2, 5] as const) {
      const source = REGULATORY_SYNC_SOURCES[code]
      expect(source.deriveEffectiveFrom('115年1月分級表')).toEqual({
        ok: true,
        effectiveFrom: '2026-01-01',
        // 健保署那兩份沒有明示失效日：一版沿用到下一版為止（計畫 §3.2 (d)）。
        effectiveTo: null,
      })
      // 政府沒給說明時是 `null`，而 `null` 走失敗分支，不是回一個預設日期。
      expect(source.deriveEffectiveFrom(null).ok).toBe(false)
    }
  })

  test('★ 只有年份的資源是「不是候選」，不是失敗（計畫 §7.1.2）', () => {
    // 這一條就是「告警疲勞比缺那幾版資料危險」那個決定的落點：`20251` 有九個資源長這樣，
    // 記成失敗的話 `dataset_code=2` 在穩定狀態下永遠是 status=3、每晚一則 error。
    const source = REGULATORY_SYNC_SOURCES[2]
    const yearOnly = source.deriveEffectiveFrom('100年全民健康保險投保金額分級表')
    expect(yearOnly.ok).toBe(false)
    if (yearOnly.ok) return
    expect(yearOnly.excluded).toBe(true)

    // 而「政府沒給說明」與「說明讀不懂」仍然是失敗——我們不知道它是哪一天，
    // 那與「我們決定不同步它」是兩件事。
    const noDescription = source.deriveEffectiveFrom(null)
    expect(noDescription.ok || noDescription.excluded).toBe(false)
    const unreadable = source.deriveEffectiveFrom('全民健康保險投保金額分級表')
    expect(unreadable.ok || unreadable.excluded).toBe(false)
  })
})

describe('parseHealthInsuranceSalaryGrades：dataset_code=2 的解析器', () => {
  test('成功路徑：record_key 用月投保金額、級距與金額都拆得開', () => {
    const parsed = parseHealthInsuranceSalaryGrades(healthGradeCsv(...HEALTH_GRADE_ROWS))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.records).toHaveLength(3)
    // `record_key` 是月投保金額，不是級數：基本工資一調，低薪的幾級被刪掉，級數整批位移。
    expect(parsed.records.map((record) => record.recordKey)).toEqual(['amount-29500', 'amount-30300', 'amount-31800'])

    const lowest = parsed.records[0]
    expect(lowest?.code).toBe('1')
    // 最低一級沒有下限——不補 0（補了之後一支寫錯的級距查詢會回一個看起來正常的級距）。
    expect(lowest?.rangeFrom).toBeNull()
    expect(lowest?.rangeTo).toBe('29500')
    expect(lowest?.amount).toBe('29500')
    expect(lowest?.rate).toBeNull()
    expect(lowest?.name).toBeNull()
    expect(lowest?.data).toEqual({
      groupRangeText: '第一組級距1200元',
      grade: '1',
      monthlyInsuredAmount: '29500',
      actualSalaryRangeText: '29500以下',
      actualSalaryFrom: null,
      actualSalaryTo: '29500',
    })

    // 最高一級沒有上限，而且它的月投保金額不等於任何一個級距端點。
    expect(parsed.records[2]?.rangeTo).toBeNull()
    expect(parsed.records[2]?.amount).toBe('31800')
  })

  test('金額一律是字串不是 number（§4.7、計畫 §6.1），而且通得過形狀驗證', () => {
    const parsed = parseHealthInsuranceSalaryGrades(healthGradeCsv(...HEALTH_GRADE_ROWS))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    for (const record of parsed.records) {
      expect(typeof record.amount).toBe('string')
      // 寫入前的形狀驗證（計畫 §6）：`2.95e4` 通得過編譯，通不過這一行。
      const shape = parseRegulatoryRecordData(2, record.data)
      expect(shape.ok).toBe(true)
      if (!shape.ok) return
      expect(typeof shape.value.monthlyInsuredAmount).toBe('string')
    }
  })

  test('★ 完整性（一）：級距之間有缺口時失敗——落在缺口裡的薪資查不到任何一級', () => {
    // 實測 `100年` 那一份真的有這種缺口（18301–18780 沒有任何一級涵蓋）。
    const withGap = healthGradeCsv(
      '第一組級距1200元,1,29500,29500以下',
      '第二組級距1500元,2,30300,29800-30300',
      '第二組級距1500元,3,31800,30301以上',
    )
    expect(parseHealthInsuranceSalaryGrades(withGap).ok).toBe(false)
  })

  test('★ 完整性（二）：最後一級不是「N以上」時失敗——這是「只抓到半截」的攔截點', () => {
    const truncated = healthGradeCsv('第一組級距1200元,1,29500,29500以下', '第二組級距1500元,2,30300,29501-30300')
    expect(parseHealthInsuranceSalaryGrades(truncated).ok).toBe(false)
    // 第一級不是「N以下」同理（那代表前面幾級被切掉了）。
    const headless = healthGradeCsv('第二組級距1500元,1,30300,29501-30300', '第二組級距1500元,2,31800,30301以上')
    expect(parseHealthInsuranceSalaryGrades(headless).ok).toBe(false)
  })

  test('★ 完整性（三）：月投保金額不等於級距上限時失敗——欄位錯位之後每個值單獨看都合法', () => {
    const mismatched = healthGradeCsv(
      '第一組級距1200元,1,29500,29500以下',
      '第二組級距1500元,2,30301,29501-30300',
      '第二組級距1500元,3,31800,30301以上',
    )
    expect(parseHealthInsuranceSalaryGrades(mismatched).ok).toBe(false)
  })

  test('★ 完整性（四）：級數頭尾錨定——中間少一列時最後一列的級數會大於列數', () => {
    const missingMiddle = healthGradeCsv('第一組級距1200元,1,29500,29500以下', '第二組級距1500元,3,30300,29501以上')
    expect(parseHealthInsuranceSalaryGrades(missingMiddle).ok).toBe(false)
  })

  test('表頭改了、金額不是整數、區間句型讀不懂都失敗', () => {
    expect(parseHealthInsuranceSalaryGrades('組別級距,投保等級,月投保金額,實際薪資月額\n甲,1,1,1以下\n').ok).toBe(false)
    expect(parseHealthInsuranceSalaryGrades(healthGradeCsv('第一組級距1200元,1,29500.5,29500以下')).ok).toBe(false)
    // 勞動部那批用「至」，健保署用半形連字號；把「至」讀通會讓格式變更完全沒有症狀。
    expect(
      parseHealthInsuranceSalaryGrades(
        healthGradeCsv('第一組級距1200元,1,29500,29500以下', '第二組級距1500元,2,30300,29501至30300'),
      ).ok,
    ).toBe(false)
  })
})

describe('parseHealthInsurancePremiumShares：dataset_code=5 的解析器', () => {
  test('成功路徑：record_key 與 dataset_code=2 用同一種寫法（兩張表是同一組級距的兩面）', () => {
    const parsed = parseHealthInsurancePremiumShares(healthShareCsv(...HEALTH_SHARE_ROWS))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.records.map((record) => record.recordKey)).toEqual(['amount-29500', 'amount-30300'])
    const first = parsed.records[0]
    expect(first?.code).toBe('1')
    expect(first?.amount).toBe('29500')
    // 這不是級距表：每一列對應一個確切的月投保金額，填一個假區間會讓級距查詢看起來成立。
    expect(first?.rangeFrom).toBeNull()
    expect(first?.rangeTo).toBeNull()
    // 負擔比率寫在表頭裡，抄一份到 `rate` 會產生第二份真相。
    expect(first?.rate).toBeNull()
    expect(first?.data).toEqual({
      grade: '1',
      monthlyInsuredAmount: '29500',
      insuredShareAmount: '458',
      insuredWithOneDependentAmount: '916',
      insuredWithTwoDependentsAmount: '1374',
      insuredWithThreeDependentsAmount: '1832',
      employerShareAmount: '1428',
      governmentSubsidyAmount: '238',
    })
  })

  test('金額一律是字串不是 number（§4.7），而且通得過形狀驗證', () => {
    const parsed = parseHealthInsurancePremiumShares(healthShareCsv(...HEALTH_SHARE_ROWS))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    for (const record of parsed.records) {
      const shape = parseRegulatoryRecordData(5, record.data)
      expect(shape.ok).toBe(true)
      if (!shape.ok) return
      for (const value of Object.values(shape.value)) expect(typeof value).toBe('string')
    }
  })

  test('★ 完整性（一）：表頭裡的負擔比率改了就失敗——那是法規變更，資料列上看不出來', () => {
    const changedRate = healthShareCsv(...HEALTH_SHARE_ROWS).replace('負擔比率30%', '負擔比率40%')
    expect(parseHealthInsurancePremiumShares(changedRate).ok).toBe(false)
  })

  test('★ 完整性（二）：眷口金額不是本人金額的 2／3／4 倍時失敗', () => {
    const broken = healthShareCsv('1,29500,458,917,1374,1832,1428,238')
    const parsed = parseHealthInsurancePremiumShares(broken)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('本人+1眷口負擔金額')
  })

  test('★ 完整性（三）：月投保金額沒有嚴格遞增時失敗', () => {
    const notIncreasing = healthShareCsv('1,30300,470,940,1410,1880,1466,244', '2,29500,458,916,1374,1832,1428,238')
    expect(parseHealthInsurancePremiumShares(notIncreasing).ok).toBe(false)
  })

  test('★ 完整性（四）：級數頭尾錨定，但**中間打錯一格不算**（政府 107年1月 真的打錯過）', () => {
    // 第 2 列的等級寫成 `8`：頭尾仍然是 1 與 2，因此放行——等級不是識別鍵（record_key 用月投保金額），
    // 而讓一個永遠修不好的歷史筆誤每天晚上把同步打紅，只會讓這道檢查被放寬掉。
    const governmentTypo = healthShareCsv(
      '1,29500,458,916,1374,1832,1428,238',
      '8,30300,470,940,1410,1880,1466,244',
      '3,31800,493,986,1479,1972,1539,256',
    )
    const typo = parseHealthInsurancePremiumShares(governmentTypo)
    expect(typo.ok).toBe(true)
    if (!typo.ok) return
    // 打錯的那一格仍然照原樣保留在 `code` 與 `data.grade` 裡——我們不替政府改資料。
    expect(typo.records[1]?.code).toBe('8')

    // 但「中間少了一列」照樣紅：最後一列的等級大於列數。
    const missingMiddle = healthShareCsv('1,29500,458,916,1374,1832,1428,238', '3,30300,470,940,1410,1880,1466,244')
    expect(parseHealthInsurancePremiumShares(missingMiddle).ok).toBe(false)
  })

  test('表頭改了、金額不是整數、只有表頭都失敗', () => {
    expect(parseHealthInsurancePremiumShares('投保金額等級,月投保金額\n1,29500\n').ok).toBe(false)
    expect(parseHealthInsurancePremiumShares(healthShareCsv('1,29500,458.5,917,1375.5,1834,1428,238')).ok).toBe(false)
    expect(parseHealthInsurancePremiumShares(healthShareCsv()).ok).toBe(false)
  })
})

describe('planMultiVersionSync：一個資料集 → N 個版本的計畫', () => {
  const resource = (description: string | null, id: string): RegulatorySourceResource => ({
    downloadUrl: `https://info.nhi.test.invalid/api/iode0000s01/Dataset?rId=${id}`,
    resourceDescription: description,
    sourceModifiedAt: '2026-08-12 11:05:17',
  })

  const derive = REGULATORY_SYNC_SOURCES[2].deriveEffectiveFrom

  test('★ 幂等：已經有的版本代碼一律 skip，其餘才 create', () => {
    const plan = planMultiVersionSync([resource('114年1月分級表', 'a'), resource('115年1月分級表', 'b')], derive, [
      '2025-01',
    ])
    expect(plan.map((entry) => entry.action)).toEqual(['skip', 'create'])
    expect(plan.map((entry) => ('versionCode' in entry ? entry.versionCode : null))).toEqual(['2025-01', '2026-01'])
  })

  test('★ 讀不懂的資源是 fail，不是 skip（計畫 §7.2）', () => {
    // skip 的話，政府哪天把最新那一份的說明改成別的寫法，同步會回報「無異動」而我們永遠拿不到新版本。
    const plan = planMultiVersionSync([resource(null, 'a'), resource('115年1月分級表', 'b')], derive, [])
    expect(plan.map((entry) => entry.action)).toEqual(['create', 'fail'])
    const failed = plan.find((entry) => entry.action === 'fail')
    expect(failed?.action === 'fail' && failed.reason).toContain('沒有給資源說明')
  })

  test('★ 只有年度標示的資源是 exclude，不是 fail（計畫 §7.1.2）', () => {
    // 這一條與上一條是本檔最重要的一組對照：兩者都不會產生版本，但**只有一種是紅的**。
    // 記成 fail 的話，`20251` 那九個年度標示會讓 `dataset_code=2` 每晚一則 error，
    // 三個月後沒有人會看那個告警，而那時政府真的改了格式也一樣被忽略。
    const plan = planMultiVersionSync([resource('100年分級表', 'a'), resource('115年1月分級表', 'b')], derive, [])
    expect(plan.map((entry) => entry.action)).toEqual(['create', 'exclude'])
    const skippedOut = plan.find((entry) => entry.action === 'exclude')
    expect(skippedOut?.action === 'exclude' && skippedOut.reason).toContain('只有年份')
  })

  test('依生效日由舊到新排序，排除與失敗的排在最後（回補時 id 的順序才與生效日一致）', () => {
    const plan = planMultiVersionSync(
      [
        resource('115年1月分級表', 'c'),
        resource('100年分級表', 'x'),
        resource(null, 'y'),
        resource('110年1月分級表', 'a'),
      ],
      derive,
      [],
    )
    expect(plan.map((entry) => ('effectiveFrom' in entry ? entry.effectiveFrom : entry.action))).toEqual([
      '2021-01-01',
      '2026-01-01',
      'exclude',
      'fail',
    ])
  })

  test('兩個資源推導出同一個版本代碼時，第二個 fail（不是取其中一個）', () => {
    // 放行的話會在寫第二份時撞 `UNIQUE(dataset_code, version_code)`，
    // 而那時的錯誤訊息是一句 SQL 唯一鍵違反，看不出是哪兩個資源撞在一起。
    const plan = planMultiVersionSync([resource('115年1月分級表', 'a'), resource('115年1月分級表', 'b')], derive, [])
    expect(plan.map((entry) => entry.action)).toEqual(['create', 'fail'])
  })

  test('全部都已經存在時，計畫裡一個 create 都沒有（＝那一次同步不下載任何資源）', () => {
    const plan = planMultiVersionSync([resource('115年1月分級表', 'a')], derive, ['2026-01'])
    expect(plan.every((entry) => entry.action === 'skip')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// `dataset_code=8` 最低工資（勞動部公告頁）
//
// 這一批與前六個資料集有一個結構上的差別：**來源是 HTML**，因此「頁面改版」是一種新的失敗模式。
// 每一條爬 HTML 的測試都在驗同一件事——**改版之後我們抓不到東西（失敗），不是抓到錯的東西**。
// ---------------------------------------------------------------------------

/** 政府那一頁的兩則公告，逐字取自 2026-08 的實測內容。 */
const WAGE_114 = '民國113年9月19日發布，自114年1月1日起實施，訂定每月最低工資為28,590元，每小時最低工資為190元。'
const WAGE_115 = '民國114年10月21日發布，自115年1月1日起實施，訂定每月最低工資為29,500元，每小時最低工資為196元。'

/**
 * 一頁公告頁。內容區塊的結構與實測相同：導覽列在區塊外，區塊內混著頁面自己的資訊條列
 * （`更新日期`、`發布單位`）與一個指向歷年基本工資的連結。
 */
const wagePage = (...items: readonly string[]): string =>
  [
    '<html><body>',
    // 導覽列裡也有「最低工資」四個字（實測整頁 25 處）——它在內容區塊外，因此不該被看見。
    '<nav><ul><li><a href="/x">最低工資</a></li></ul></nav>',
    '<section class="cp">',
    '<ul class="publish_info_top"><li>更新日期:2025-12-04</li></ul>',
    '<ul style="list-style-type: disc;">',
    '<li><a href="https://www.mol.gov.tw/x"><strong>歷年基本工資調整情形</strong></a></li>',
    ...items.map((item) => `<li>${item}</li>`),
    '</ul>',
    '<ul class="publish_info_down"><li>發布單位:勞動條件及就業平等司</li></ul>',
    '</section>',
    '</body></html>',
  ].join('\n')

describe('dataset_code=8：最低工資（勞動部公告頁）', () => {
  const source = REGULATORY_SYNC_SOURCES[8]

  test('資源探索：內容區塊裡的每一則條列都是一個資源，導覽列的不算', () => {
    const listed = source.listResources(wagePage(WAGE_114, WAGE_115))
    expect(listed.ok).toBe(true)
    if (!listed.ok) return

    // 內容區塊裡共 5 個條列：更新日期、歷年連結、兩則公告、發布單位。導覽列那一個不在其中。
    expect(listed.values.map((resource) => resource.resourceDescription)).toEqual([
      '更新日期:2025-12-04',
      '歷年基本工資調整情形',
      WAGE_114,
      WAGE_115,
      '發布單位:勞動條件及就業平等司',
    ])
    // 每一則公告的「資源網址」都是公告頁本身：它們在同一頁上，幂等只能靠 version_code。
    expect(new Set(listed.values.map((resource) => resource.downloadUrl)).size).toBe(1)
  })

  test('★ 頁面結構改變 → 抓不到 → 失敗（不是抓到一個看起來合理的值）', () => {
    // 內容區塊的標記換了：這正是改版最典型的樣子。
    expect(source.listResources('<html><body><section class="content">…</section></body></html>').ok).toBe(false)
    // 區塊在、但裡面一個條列都沒有（改成表格或段落之類的）。
    expect(source.listResources(`<html><section class="cp"><p>${WAGE_115}</p></section></html>`).ok).toBe(false)
    // 整頁換掉。
    expect(source.listResources('{"result":{}}').ok).toBe(false)
  })

  test('候選判準：不含「最低工資」的條列是 exclude，句型變了才是 fail（計畫 §7.1.2）', () => {
    // 頁面自己的資訊條列不是公告 → 排除，不算失敗（否則這個資料集每晚一則 error）。
    const chrome = source.deriveEffectiveFrom('更新日期:2025-12-04')
    expect(chrome.ok).toBe(false)
    if (chrome.ok) return
    expect(chrome.excluded).toBe(true)

    // 但**含「最低工資」卻讀不懂**必須是失敗：那代表政府改了句型，而漏掉一次調整
    // 會讓 Payroll 一整年用錯的工資下限。
    const reworded = source.deriveEffectiveFrom('自115年1月1日起，每月最低工資為29,500元。')
    expect(reworded.ok).toBe(false)
    if (reworded.ok) return
    expect(reworded.excluded).toBe(false)
  })

  test('生效日是「起實施」那一天，不是發布日；沒有明示失效日', () => {
    expect(source.deriveEffectiveFrom(WAGE_115)).toEqual({
      ok: true,
      effectiveFrom: '2026-01-01',
      // 最低工資沿用到下一次調整為止，政府沒有明示失效日（計畫 §3.2 (d)）。
      effectiveTo: null,
    })
    expect(source.deriveEffectiveFrom(WAGE_114)).toEqual({
      ok: true,
      effectiveFrom: '2025-01-01',
      effectiveTo: null,
    })
  })

  test('★ 一個版本兩筆：月薪與時薪，金額是字串不是 number', () => {
    const parsed = source.parse(wagePage(WAGE_114, WAGE_115), { resourceDescription: WAGE_115 })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.records.map((record) => record.recordKey)).toEqual(['monthly-minimum-wage', 'hourly-minimum-wage'])
    const [monthly, hourly] = parsed.records
    expect(monthly?.amount).toBe('29500')
    expect(hourly?.amount).toBe('196')
    // §4.7、計畫 §6.1：金額一律 decimal 字串，禁止 `Number(...)`。
    expect(typeof monthly?.amount).toBe('string')
    expect(typeof hourly?.amount).toBe('string')
    // 不是級距，因此沒有上下限——不補 0（補了之後一支寫錯的級距查詢會命中它）。
    expect(monthly?.rangeFrom).toBeNull()
    expect(monthly?.rangeTo).toBeNull()
    expect(monthly?.rate).toBeNull()
    expect(monthly?.data).toEqual({
      item: 'monthly',
      amount: '29500',
      announcedOn: '2025-10-21',
      announcementText: WAGE_115,
    })

    // 寫入前的形狀驗證（計畫 §6）：型別擋不到的那一半在這裡。
    for (const record of parsed.records) expect(parseRegulatoryRecordData(8, record.data).ok).toBe(true)
  })

  test('★ 完整性檢查會紅：月薪與時薪對調、公告不在那一頁上', () => {
    // 兩個金額對調之後**每一個值單獨看都完全合法**，只有「月薪必須大於時薪」這一條會發現。
    const swapped = '民國114年10月21日發布，自115年1月1日起實施，訂定每月最低工資為196元，每小時最低工資為29,500元。'
    expect(source.parse(wagePage(swapped), { resourceDescription: swapped }).ok).toBe(false)

    // 探索階段讀到的那一則不在下載回來的頁面上＝頁面在同步途中被改過。寧可失敗重來，
    // 也不要拿另一則公告的金額配上這一版的生效日。
    expect(source.parse(wagePage(WAGE_114), { resourceDescription: WAGE_115 }).ok).toBe(false)

    // 沒有指定要解析哪一則。
    expect(source.parse(wagePage(WAGE_115), { resourceDescription: null }).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// `dataset_code=9` 薪資所得扣繳稅額表（財政部臺北國稅局下載專區）
// ---------------------------------------------------------------------------

/** 十二個扶養人數欄位的表頭（民國 112 年度起帶 `(元)`，107–111 不帶）。 */
const taxHeader = (unit: string): string =>
  ['每月薪資所得', ...Array.from({ length: 12 }, (_, count) => `配偶及受扶養親屬計${String(count)}人${unit}`)].join(',')

/** 一列：薪資區間 ＋ 十二個稅額（依扶養人數遞減，與政府那一份同構）。 */
const taxRow = (range: string, base: number): string =>
  [`"${range}"`, ...Array.from({ length: 12 }, (_, count) => String(base - count * 100))].join(',')

/** 三列，尾端錨在 50 萬（政府那七個年度都以 `499,501 ~ 500,000` 結束）。 */
const TAX_ROWS = [
  taxRow('498,501 ~ 499,000', 100300),
  taxRow('499,001 ~ 499,500', 100500),
  taxRow('499,501 ~ 500,000', 100700),
] as const

const taxCsv = (unit: string, ...rows: readonly string[]): string => `${[taxHeader(unit), ...rows].join('\r\n')}\r\n`

/** 下載專區列表頁：目標那一項，加上一項**連結文字也是民國年**的鄰居（實測真的有）。 */
const taxPage = (
  ...anchors: readonly { readonly id: string; readonly title: string | null; readonly text: string }[]
): string =>
  [
    '<html><body><ul>',
    '<li>財政部臺北國稅局扣免繳申報收件統計表_CSV [<a href="/download/other" title="…統計表_114年度.csv">114</a>]</li>',
    `<li>財政部臺北國稅局薪資所得扣繳稅額表_CSV ${anchors
      .map(
        (anchor) =>
          `[<a href="/download/${anchor.id}"${anchor.title === null ? '' : ` title="${anchor.title}"`}>${anchor.text}</a>]`,
      )
      .join('、')}</li>`,
    '</ul></body></html>',
  ].join('\n')

const TAX_ANCHORS = [
  { id: 'y107', title: '財政部臺北國稅局107年度薪資所得扣繳稅額表 [CSV]', text: '107' },
  // 實測：民國 108 年度那一個的檔名裡**沒有年度**。
  { id: 'y108', title: '薪資所得扣繳稅額表[CSV]', text: '108' },
  { id: 'y115', title: '財政部臺北國稅局薪資所得扣繳稅額表_115年度.csv', text: '115' },
] as const

describe('dataset_code=9：薪資所得扣繳稅額表（財政部下載專區）', () => {
  const source = REGULATORY_SYNC_SOURCES[9]

  test('資源探索：只抓目標那一項底下的 /download 連結，資源名稱取 title（檔名）', () => {
    const listed = source.listResources(taxPage(...TAX_ANCHORS))
    expect(listed.ok).toBe(true)
    if (!listed.ok) return

    // 鄰居那一項的連結文字也是 `114`，但它不在目標 `<li>` 裡——用連結文字定位就會抓到它。
    expect(listed.values).toHaveLength(3)
    expect(listed.values.map((resource) => resource.resourceDescription)).toEqual(
      TAX_ANCHORS.map((anchor) => anchor.title),
    )
    expect(listed.values[0]?.downloadUrl).toBe('https://www.ntbt.gov.tw/download/y107')
  })

  test('★ 頁面結構改變 → 抓不到 → 失敗', () => {
    // 那一項的標籤改了（例如政府把「_CSV」拿掉）→ 找不到 → 失敗，而不是抓到鄰居那一項的年度。
    const relabelled =
      '<html><ul><li>財政部臺北國稅局薪資所得扣繳稅額表 [<a href="/download/a">115</a>]</li></ul></html>'
    expect(source.listResources(relabelled).ok).toBe(false)
    // 那一項在、但連結換成別的形式。
    const otherLink =
      '<html><ul><li>財政部臺北國稅局薪資所得扣繳稅額表_CSV <a href="/file?id=1">115</a></li></ul></html>'
    expect(source.listResources(otherLink).ok).toBe(false)
    expect(source.listResources('<html><body>維護中</body></html>').ok).toBe(false)
  })

  test('★ 候選判準：檔名沒有「N年度」的是 exclude（民國 108 年度那一份），不是 fail', () => {
    const excluded = source.deriveEffectiveFrom('薪資所得扣繳稅額表[CSV]')
    expect(excluded.ok).toBe(false)
    if (excluded.ok) return
    expect(excluded.excluded).toBe(true)

    // 連 title 都沒有的連結同理。
    const noTitle = source.deriveEffectiveFrom(null)
    expect(noTitle.ok || noTitle.excluded).toBe(true)
  })

  test('★ 年度 → 生效日與**明示的失效日**（少了訖日，補算 110 年度會挑到 109 年度那一張表）', () => {
    expect(source.deriveEffectiveFrom('財政部臺北國稅局薪資所得扣繳稅額表_115年度.csv')).toEqual({
      ok: true,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    })
    expect(source.deriveEffectiveFrom('財政部臺北國稅局107年度薪資所得扣繳稅額表 [CSV]')).toEqual({
      ok: true,
      effectiveFrom: '2018-01-01',
      effectiveTo: '2018-12-31',
    })
    // 西元寫法不會被當成民國：少了 `(?<!\d)` 會 match 到 `026年度`（民國 26 年＝1937）。
    expect(source.deriveEffectiveFrom('薪資所得扣繳稅額表_2026年度.csv').ok).toBe(false)
    // 兩個年度就沒有唯一答案，一律失敗（是候選、推導不出來 → 紅）。
    const ambiguous = source.deriveEffectiveFrom('114年度與115年度薪資所得扣繳稅額表.csv')
    expect(ambiguous.ok || ambiguous.excluded).toBe(false)
  })

  test('★ 成功解析：一列一筆、十二個稅額在 data 裡，全部是字串不是 number', () => {
    const parsed = source.parse(taxCsv('(元)', ...TAX_ROWS))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.records).toHaveLength(3)
    // `record_key` 是級距下限，不是列序：政府 111 年度把起扣的第一列從 81,001 改成 80,001，
    // 用列序的話跨版本比對會說「每一級的稅額都變了」。
    expect(parsed.records.map((record) => record.recordKey)).toEqual([
      'salary-498501',
      'salary-499001',
      'salary-499501',
    ])

    const last = parsed.records[2]
    expect(last?.rangeFrom).toBe('499501')
    expect(last?.rangeTo).toBe('500000')
    // 這一列有十二個稅額，沒有「這一筆的金額」可言——取其中一個就是替 Payroll 決定預設扶養人數。
    expect(last?.amount).toBeNull()
    expect(last?.rate).toBeNull()
    expect(last?.code).toBeNull()
    expect(last?.data).toEqual({
      monthlySalaryRangeText: '499,501 ~ 500,000',
      monthlySalaryFrom: '499501',
      monthlySalaryTo: '500000',
      taxByDependentCount: [
        '100700',
        '100600',
        '100500',
        '100400',
        '100300',
        '100200',
        '100100',
        '100000',
        '99900',
        '99800',
        '99700',
        '99600',
      ],
    })
    for (const record of parsed.records) expect(parseRegulatoryRecordData(9, record.data).ok).toBe(true)
  })

  test('107–111 那一代的表頭（沒有「(元)」）一樣讀得懂，第三種寫法失敗', () => {
    expect(source.parse(taxCsv('', ...TAX_ROWS)).ok).toBe(true)
    // 第三種寫法一律失敗：兩代都是已凍結的歷史檔案，接受它們不是放寬 pattern。
    expect(source.parse(taxCsv('（元）', ...TAX_ROWS)).ok).toBe(false)
    // 少一欄（政府把扶養人數上限從 11 改成 10）——形狀那邊的十二格與表頭同一份來源。
    const shortHeader = taxCsv('(元)', ...TAX_ROWS).replace(',配偶及受扶養親屬計11人(元)', '')
    expect(source.parse(shortHeader).ok).toBe(false)
  })

  test('★ 完整性檢查會紅：級距缺口、尾端被截短、扶養欄位錯位、薪資與稅額不同向', () => {
    // 級距之間有缺口：落在缺口裡的薪資查不到任何一級。
    const gap = taxCsv('(元)', taxRow('498,501 ~ 499,000', 100300), taxRow('499,101 ~ 500,000', 100700))
    expect(source.parse(gap).ok).toBe(false)

    // 尾巴少一截：被截短的表最後一列仍然是一個完全正常的封閉級距，只有尾端錨定會發現。
    const truncated = taxCsv('(元)', TAX_ROWS[0], TAX_ROWS[1])
    expect(source.parse(truncated).ok).toBe(false)

    // 扶養欄位錯位：稅額不該隨扶養人數上升，而每一個值單獨看都是合法金額。
    const ascendingRow = [
      '"499,501 ~ 500,000"',
      ...Array.from({ length: 12 }, (_, count) => String(90000 + count * 100)),
    ].join(',')
    expect(source.parse(taxCsv('(元)', ascendingRow)).ok).toBe(false)

    // 薪資較高的級距扣得比較少：列的順序或內容不對。
    const descending = taxCsv('(元)', taxRow('499,001 ~ 499,500', 100700), taxRow('499,501 ~ 500,000', 100300))
    expect(source.parse(descending).ok).toBe(false)

    // 區間句型變了（政府改用開放的一端）——這張表沒有開放的一端。
    const openEnded = taxCsv('(元)', taxRow('499,501 ~ 500,000', 100700).replace('499,501 ~ 500,000', '499,501以上'))
    expect(source.parse(openEnded).ok).toBe(false)
  })
})
