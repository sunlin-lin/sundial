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
import { selectDataGovResource, toDataGovMetadataUrl } from '../domain/regulatory-data-gov.ts'
import { parseLaborInsuranceSalaryGrades, parseMonthlySalaryRange } from '../domain/regulatory-labor-insurance-salary.ts'
import { parseRocCompactDate } from '../domain/regulatory-roc-date.ts'
import { isHeartbeatStale } from '../domain/regulatory-sync-model.ts'
import { isSyncableDatasetCode, toVersionCode } from '../domain/regulatory-sync-source.ts'

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

  test('isSyncableDatasetCode：目前只有 1，人工維護的 10 與永久空號 7 都不是', () => {
    expect(isSyncableDatasetCode(1)).toBe(true)
    expect(isSyncableDatasetCode(2)).toBe(false)
    expect(isSyncableDatasetCode(7)).toBe(false)
    expect(isSyncableDatasetCode(10)).toBe(false)
  })
})
