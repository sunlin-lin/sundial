import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import type { DatasetCode } from './regulatory-datasets.payload.ts'
import { columnsFor } from './regulatory-datasets.columns.view.ts'
import type { RecordData } from './regulatory-datasets.record.view.ts'

/** 翻譯替身：原樣回傳 key，讓斷言直接看得出組出來的是哪一則訊息。 */
const echoTranslate: TranslateMessage = (key) => key

const EMPTY = '—'

/**
 * 九個資料集各一筆**真實形狀**的 `data`（值取自後端 `regulatory-record-shape.ts` 檔頭裡
 * 逐字抄下來的政府原始資料）。
 *
 * 這一份是本檔最重要的東西：`RecordDataKey` 擋得住「這個鍵不存在於任何資料集」，
 * **擋不住「這個鍵屬於另一個資料集」**——把 `dataset_code=2` 的 `groupRangeText` 寫進 `1` 的
 * 欄位定義裡完全編譯得過，症狀是那一欄整片 `—`，而 `—` 在這個系統裡是合法狀態，沒有人會查。
 * 下面「每一欄都讀得出值」那組測試就是為了讓那件事變成一個會紅的檢查。
 */
const SAMPLES = {
  1: {
    insuredCategoryCode: 'general',
    insuredCategoryName: '一般勞工',
    grade: '2',
    monthlySalaryRangeText: '29501元至30300元',
    monthlySalaryFrom: '29501',
    monthlySalaryTo: '30300',
    monthlyInsuredSalary: '30300',
  },
  2: {
    groupRangeText: '第一組級距1200元',
    grade: '2',
    monthlyInsuredAmount: '30300',
    actualSalaryRangeText: '29501-30300',
    actualSalaryFrom: '29501',
    actualSalaryTo: '30300',
  },
  3: {
    grade: '2',
    actualWageRangeText: '1501至3000',
    actualWageFrom: '1501',
    actualWageTo: '3000',
    monthlyContributionWage: '3000',
    remark: '適用於部分工時',
  },
  4: {
    insuredSalary: '11100',
    laborInsuranceRate: '0.115',
    employmentInsuranceRate: '0.01',
    employeeShareAmount: '277',
    employerShareAmount: '972',
  },
  5: {
    grade: '1',
    monthlyInsuredAmount: '29500',
    insuredShareAmount: '458',
    insuredWithOneDependentAmount: '916',
    insuredWithTwoDependentsAmount: '1374',
    insuredWithThreeDependentsAmount: '1832',
    employerShareAmount: '1428',
    governmentSubsidyAmount: '238',
  },
  6: {
    majorCategoryCode: 'manufacturing',
    majorCategoryName: '製造業',
    rateCode: '3',
    industryName: '食品及飼品製造業',
    industryRate: '0.0018',
    commutingRate: '0.0007',
    occupationalAccidentRate: '0.0025',
  },
  8: {
    item: 'monthly',
    amount: '29500',
    announcedOn: '2025-10-21',
    announcementText: '民國114年10月21日發布，自115年1月1日起實施，訂定每月最低工資為29,500元。',
  },
  9: {
    monthlySalaryRangeText: '499,501 ~ 500,000',
    monthlySalaryFrom: '499501',
    monthlySalaryTo: '500000',
    taxByDependentCount: [
      '100700',
      '97340',
      '93970',
      '91430',
      '88900',
      '86380',
      '83850',
      '81330',
      '78800',
      '76280',
      '73750',
      '71230',
    ],
  },
  10: { item: 'rate', rate: '0.0211' },
} as const satisfies Record<DatasetCode, RecordData>

const ALL_CODES: readonly DatasetCode[] = [1, 2, 3, 4, 5, 6, 8, 9, 10]

/** 某個資料集的每一欄讀出來的值。 */
const readAll = (code: DatasetCode): readonly string[] =>
  columnsFor(code, echoTranslate).map((column) => column.read(SAMPLES[code]))

describe('欄位定義本身', () => {
  test('九個資料集各有欄位定義，一個都不能少（7 是永久空號）', () => {
    for (const code of ALL_CODES) {
      expect(columnsFor(code, echoTranslate).length).toBeGreaterThan(0)
    }
  })

  test('同一個資料集內的欄位鍵不重複——重複的話後一欄會蓋掉前一欄的值', () => {
    for (const code of ALL_CODES) {
      const keys = columnsFor(code, echoTranslate).map((column) => column.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  test('每一欄都有語系 key，畫面上不會出現沒有標題的欄位', () => {
    for (const code of ALL_CODES) {
      for (const column of columnsFor(code, echoTranslate)) {
        expect(column.labelKey.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('每一欄都讀得出值（擋「鍵屬於另一個資料集」）', () => {
  // 樣本刻意選了兩端都有界線的那一級，因此這一組不該出現任何 `—`。
  // 唯一的例外是 `dataset_code=10`：它三筆 record 各自只有其中一個數值欄有值，
  // 那是資料本身的形狀，不是欄位定義寫錯，所以單獨測（見下）。
  for (const code of ALL_CODES.filter((value) => value !== 10)) {
    test(`資料集 ${String(code)} 的每一欄都不是「沒有值」`, () => {
      expect(readAll(code)).not.toContain(EMPTY)
    })
  }
})

describe('格式化', () => {
  test('金額欄有千分位，而且沒有經過數值轉型', () => {
    const columns = columnsFor(9, echoTranslate)
    const cell = columns.find((column) => column.key === 'taxByDependentCount.0')
    expect(cell?.read(SAMPLES[9])).toBe('100,700')
  })

  test('費率欄以百分比呈現，小數位原樣保留（政府用幾位小數是公告的一部分）', () => {
    const columns = columnsFor(4, echoTranslate)
    expect(columns.find((column) => column.key === 'laborInsuranceRate')?.read(SAMPLES[4])).toBe('11.5%')
    expect(
      columnsFor(6, echoTranslate)
        .find((column) => column.key === 'industryRate')
        ?.read(SAMPLES[6]),
    ).toBe('0.18%')
  })

  test('日期欄是西元，不轉民國（計畫 §5.1）', () => {
    const columns = columnsFor(8, echoTranslate)
    expect(columns.find((column) => column.key === 'announcedOn')?.read(SAMPLES[8])).toBe('2025-10-21')
  })

  test('公告原文照印，裡面的民國年不轉西元（計畫 §5.1 的例外）', () => {
    const columns = columnsFor(8, echoTranslate)
    expect(columns.find((column) => column.key === 'announcementText')?.read(SAMPLES[8])).toContain(
      '民國114年10月21日',
    )
  })

  test('金額欄靠右、文字欄靠左——一整欄數字靠左時要逐位比對才看得出大小', () => {
    const columns = columnsFor(1, echoTranslate)
    expect(columns.find((column) => column.key === 'monthlyInsuredSalary')?.align).toBe('right')
    expect(columns.find((column) => column.key === 'insuredCategoryName')?.align).toBe('left')
  })
})

describe('固定代碼欄', () => {
  test('最低工資的項目翻成文字，不是 `monthly`', () => {
    const columns = columnsFor(8, echoTranslate)
    expect(columns.find((column) => column.key === 'item')?.read(SAMPLES[8])).toBe(
      'regulatory-datasets.minimum-wage.monthly',
    )
  })

  test('補充保險費的三個項目各有自己的文字', () => {
    const item = columnsFor(10, echoTranslate).find((column) => column.key === 'item')
    expect(item?.read({ item: 'rate', rate: '0.0211' })).toBe('regulatory-datasets.supplementary.rate')
    expect(item?.read({ item: 'chargeLowerBound', amount: '20000' })).toBe(
      'regulatory-datasets.supplementary.charge-lower-bound',
    )
    expect(item?.read({ item: 'singlePaymentUpperLimit', amount: '10000000' })).toBe(
      'regulatory-datasets.supplementary.single-payment-upper-limit',
    )
  })
})

describe('補充保險費：一筆只有一個數值欄有值', () => {
  const columns = columnsFor(10, echoTranslate)
  const rateColumn = columns.find((column) => column.key === 'rate')
  const amountColumn = columns.find((column) => column.key === 'amount')

  test('費率那一筆有費率、沒有金額', () => {
    expect(rateColumn?.read({ item: 'rate', rate: '0.0211' })).toBe('2.11%')
    expect(amountColumn?.read({ item: 'rate', rate: '0.0211' })).toBe(EMPTY)
  })

  test('門檻那兩筆有金額、沒有費率', () => {
    expect(amountColumn?.read({ item: 'chargeLowerBound', amount: '20000' })).toBe('20,000')
    expect(rateColumn?.read({ item: 'chargeLowerBound', amount: '20000' })).toBe(EMPTY)
  })
})

describe('級距的開放端（`null` 是「這一邊沒有界線」，不是缺資料）', () => {
  test('最低一級沒有下限時顯示「沒有值」，不補一個 0', () => {
    const columns = columnsFor(1, echoTranslate)
    const lowest: RecordData = {
      insuredCategoryCode: 'general',
      insuredCategoryName: '一般勞工',
      grade: '1',
      monthlySalaryRangeText: '29500元以下',
      monthlySalaryFrom: null,
      monthlySalaryTo: '29500',
      monthlyInsuredSalary: '29500',
    }
    expect(columns.find((column) => column.key === 'monthlySalaryFrom')?.read(lowest)).toBe(EMPTY)
    expect(columns.find((column) => column.key === 'monthlySalaryTo')?.read(lowest)).toBe('29,500')
  })
})

describe('扣繳稅額表的 12 個扶養人數欄', () => {
  test('薪資級距一欄 ＋ 12 個稅額欄', () => {
    expect(columnsFor(9, echoTranslate)).toHaveLength(13)
  })

  test('第 N 欄讀的就是陣列的第 N 格——索引即人數', () => {
    const columns = columnsFor(9, echoTranslate)
    expect(columns.find((column) => column.key === 'taxByDependentCount.0')?.read(SAMPLES[9])).toBe('100,700')
    expect(columns.find((column) => column.key === 'taxByDependentCount.11')?.read(SAMPLES[9])).toBe('71,230')
  })

  test('稅額 0 是真的 0，不是「沒有值」——起扣點以下的列每一格都是 0', () => {
    const columns = columnsFor(9, echoTranslate)
    const zeroRow: RecordData = {
      monthlySalaryRangeText: '80,001 ~ 80,500',
      monthlySalaryFrom: '80001',
      monthlySalaryTo: '80500',
      taxByDependentCount: ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
    }
    expect(columns.find((column) => column.key === 'taxByDependentCount.0')?.read(zeroRow)).toBe('0')
  })
})
