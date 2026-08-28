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
import { selectDataGovResource, toDataGovMetadataUrl } from '../domain/regulatory-data-gov.ts'
import { parseLaborEmploymentInsurancePremiumShares } from '../domain/regulatory-labor-employment-insurance-premium.ts'
import { parseLaborInsuranceSalaryGrades, parseMonthlySalaryRange } from '../domain/regulatory-labor-insurance-salary.ts'
import { parseLaborPensionContributionWageGrades } from '../domain/regulatory-labor-pension-contribution-wage.ts'
import { parseOccupationalAccidentInsuranceRates } from '../domain/regulatory-occupational-accident-insurance-rate.ts'
import { parseRocCompactDate, parseRocEffectiveDateFromText } from '../domain/regulatory-roc-date.ts'
import {
  isHeartbeatStale,
  type RegulatoryParseContext,
  type RegulatoryParseResult,
} from '../domain/regulatory-sync-model.ts'
import { isSyncableDatasetCode, toVersionCode } from '../domain/regulatory-sync-source.ts'
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
      parseRocEffectiveDateFromText('勞工保險普通事故及就業保險合計之保險費分擔金額表(自115年1月1日起適用)', '資源說明'),
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
      JSON.stringify([{ ...pensionRows[1], 等級: '1' }, { ...pensionRows[2], 等級: '2' }]),
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

  test('isSyncableDatasetCode：目前是 1、3、4、6，人工維護的 10 與永久空號 7 都不是', () => {
    for (const code of [1, 3, 4, 6]) expect(isSyncableDatasetCode(code)).toBe(true)
    // `2`、`5`、`8`、`9` 的形狀仍是 `Type.Never()`，沒有解析器。
    for (const code of [2, 5, 8, 9]) expect(isSyncableDatasetCode(code)).toBe(false)
    expect(isSyncableDatasetCode(7)).toBe(false)
    expect(isSyncableDatasetCode(10)).toBe(false)
  })
})
