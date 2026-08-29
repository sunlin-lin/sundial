import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import {
  datasetNameOf,
  effectiveVersionCodeOf,
  toOverviewDisplayRows,
  type OverviewRow,
} from './regulatory-datasets.view.ts'

/** 翻譯替身：原樣回傳 key，讓斷言直接看得出組出來的是哪一則訊息。 */
const echoTranslate: TranslateMessage = (key) => key

const buildRow = (overrides: Partial<OverviewRow> = {}): OverviewRow => ({
  datasetCode: 1,
  name: '勞工保險投保薪資分級表',
  maintenance: 'sync',
  effectiveVersion: { versionCode: '2026-01', effectiveFrom: '2026-01-01', recordCount: 97 },
  lastSync: { kind: 'synced', startedAt: '2026-08-26 03:00:00', finishedAt: '2026-08-26 03:00:12', statusCode: 2 },
  ...overrides,
})

describe('資料集名稱', () => {
  test('一律用後端回的名稱，前端不在語系檔另備一份', () => {
    const [row] = toOverviewDisplayRows([buildRow({ name: '職業災害保險行業別費率' })], echoTranslate)
    expect(row?.name).toBe('職業災害保險行業別費率')
  })
})

describe('維護方式', () => {
  test('自動同步與人工維護是兩種文字，計畫 §2 要求看得出「這一項是人工維護的」', () => {
    const [auto] = toOverviewDisplayRows([buildRow({ maintenance: 'sync' })], echoTranslate)
    const [manual] = toOverviewDisplayRows([buildRow({ maintenance: 'manual' })], echoTranslate)
    expect(auto?.maintenance).toBe('regulatory-datasets.maintenance.sync')
    expect(manual?.maintenance).toBe('regulatory-datasets.maintenance.manual')
    expect(auto?.maintenance).not.toBe(manual?.maintenance)
  })
})

describe('適用版本', () => {
  test('有適用版本時顯示版本代碼、生效日與筆數（千分位）', () => {
    const [row] = toOverviewDisplayRows(
      [
        buildRow({
          effectiveVersion: { versionCode: '2026-01', effectiveFrom: '2026-01-01', recordCount: 1234 },
        }),
      ],
      echoTranslate,
    )
    expect(row?.versionCode).toBe('2026-01')
    expect(row?.effectiveFrom).toBe('2026-01-01')
    expect(row?.recordCount).toBe('1,234')
  })

  test('這一天沒有任何一版適用時是一句話，不是空白——那是結果，不是缺資料', () => {
    const [row] = toOverviewDisplayRows([buildRow({ effectiveVersion: null })], echoTranslate)
    expect(row?.versionCode).toBe('regulatory-datasets.no-effective-version')
    expect(row?.effectiveFrom).toBe('—')
    expect(row?.recordCount).toBe('—')
  })
})

describe('最後同步（計畫 §4.1：「不適用」不能用空白表達）', () => {
  test('人工維護的資料集顯示「不適用」，不是空白', () => {
    const [row] = toOverviewDisplayRows(
      [buildRow({ maintenance: 'manual', lastSync: { kind: 'not-applicable' } })],
      echoTranslate,
    )
    expect(row?.lastSync).toBe('regulatory-datasets.last-sync.not-applicable')
    expect(row?.lastSync).not.toBe('—')
  })

  test('從未同步過的資料集顯示「從未同步」', () => {
    const [row] = toOverviewDisplayRows([buildRow({ lastSync: { kind: 'never-synced' } })], echoTranslate)
    expect(row?.lastSync).toBe('regulatory-datasets.last-sync.never-synced')
  })

  test('「不適用」與「從未同步」不得顯示成同一個東西——語意不同', () => {
    const [notApplicable] = toOverviewDisplayRows([buildRow({ lastSync: { kind: 'not-applicable' } })], echoTranslate)
    const [neverSynced] = toOverviewDisplayRows([buildRow({ lastSync: { kind: 'never-synced' } })], echoTranslate)
    expect(notApplicable?.lastSync).not.toBe(neverSynced?.lastSync)
  })

  test('這兩種都沒有狀態標籤：它們不是第五、第六種同步結果', () => {
    const [notApplicable] = toOverviewDisplayRows([buildRow({ lastSync: { kind: 'not-applicable' } })], echoTranslate)
    const [neverSynced] = toOverviewDisplayRows([buildRow({ lastSync: { kind: 'never-synced' } })], echoTranslate)
    expect(notApplicable?.lastSyncStatusLabel).toBe('')
    expect(neverSynced?.lastSyncStatusLabel).toBe('')
  })

  test('同步過的資料集顯示結束時間（裁到分鐘）與狀態', () => {
    const [row] = toOverviewDisplayRows(
      [
        buildRow({
          lastSync: {
            kind: 'synced',
            startedAt: '2026-08-26 03:00:00',
            finishedAt: '2026-08-26 03:05:41',
            statusCode: 3,
          },
        }),
      ],
      echoTranslate,
    )
    expect(row?.lastSync).toBe('2026-08-26 03:05')
    expect(row?.lastSyncStatusLabel).toBe('regulatory.sync-status.failed')
    expect(row?.lastSyncTone).toBe('danger')
  })

  test('還在跑的同步沒有結束時間，退回開始時間——那一欄不能是空的', () => {
    const [row] = toOverviewDisplayRows(
      [
        buildRow({
          lastSync: { kind: 'synced', startedAt: '2026-08-26 03:00:00', finishedAt: null, statusCode: 1 },
        }),
      ],
      echoTranslate,
    )
    expect(row?.lastSync).toBe('2026-08-26 03:00')
    expect(row?.lastSyncStatusLabel).toBe('regulatory.sync-status.running')
  })
})

describe('九列固定回傳，前端不再判斷「查無資料」', () => {
  test('每一列都會組出來，即使它沒有適用版本也沒有同步紀錄', () => {
    const rows = toOverviewDisplayRows(
      [
        buildRow({ datasetCode: 8, effectiveVersion: null, lastSync: { kind: 'never-synced' } }),
        buildRow({ datasetCode: 10, effectiveVersion: null, lastSync: { kind: 'not-applicable' } }),
      ],
      echoTranslate,
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.datasetCode)).toEqual([8, 10])
  })
})

describe('查表', () => {
  const rows = [buildRow({ datasetCode: 1 }), buildRow({ datasetCode: 8, name: '最低工資', effectiveVersion: null })]

  test('適用版本代碼：沒有適用版本時是 null，而不是空字串', () => {
    expect(effectiveVersionCodeOf(rows, 1)).toBe('2026-01')
    expect(effectiveVersionCodeOf(rows, 8)).toBeNull()
    expect(effectiveVersionCodeOf(rows, 9)).toBeNull()
  })

  test('資料集名稱：找不到時回代碼本身，一格寫著數字看起來就是壞的', () => {
    expect(datasetNameOf(rows, 8)).toBe('最低工資')
    expect(datasetNameOf(rows, 9)).toBe('9')
  })
})
