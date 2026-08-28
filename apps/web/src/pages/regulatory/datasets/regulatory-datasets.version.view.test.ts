import { describe, expect, test } from 'bun:test'
import { toVersionDisplayRows, type VersionRow } from './regulatory-datasets.version.view.ts'

const buildRow = (overrides: Partial<VersionRow> = {}): VersionRow => ({
  id: 7,
  datasetCode: 1,
  versionCode: '2026-01',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  recordCount: 97,
  syncedAt: '2026-08-26 03:00:12',
  createdAt: '2026-08-26 03:00:12',
  ...overrides,
})

describe('版本清單的列怎麼組', () => {
  test('日期一律西元，不轉民國（計畫 §5.1）', () => {
    const [row] = toVersionDisplayRows([buildRow()], null)
    expect(row?.effectiveFrom).toBe('2026-01-01')
  })

  test('同步時間裁到分鐘、不帶秒，也不經過 Date（§9.2）', () => {
    const [row] = toVersionDisplayRows([buildRow()], null)
    expect(row?.syncedAt).toBe('2026-08-26 03:00:12'.slice(0, 16))
  })

  test('仍然有效的版本沒有失效日，顯示「沒有值」而不是一個假的結束日', () => {
    const [row] = toVersionDisplayRows([buildRow({ effectiveTo: null })], null)
    expect(row?.effectiveTo).toBe('—')
  })

  test('已經被下一版接手的版本顯示失效日', () => {
    const [row] = toVersionDisplayRows([buildRow({ effectiveTo: '2025-12-31' })], null)
    expect(row?.effectiveTo).toBe('2025-12-31')
  })

  test('筆數加千分位，中間不經過數值轉型', () => {
    const [row] = toVersionDisplayRows([buildRow({ recordCount: 840 })], null)
    expect(row?.recordCount).toBe('840')
    const [big] = toVersionDisplayRows([buildRow({ recordCount: '12345' })], null)
    expect(big?.recordCount).toBe('12,345')
  })

  test('沒有筆數時顯示「沒有值」', () => {
    const [row] = toVersionDisplayRows([buildRow({ recordCount: null })], null)
    expect(row?.recordCount).toBe('—')
  })

  test('id 一律收成字串，表格的 row-key 才不會因為型別而對不上', () => {
    const [numeric] = toVersionDisplayRows([buildRow({ id: 12 })], null)
    const [text] = toVersionDisplayRows([buildRow({ id: '12' })], null)
    expect(numeric?.id).toBe('12')
    expect(text?.id).toBe('12')
  })
})

describe('「本基準日適用」的標記', () => {
  const rows = [buildRow({ versionCode: '2026-01' }), buildRow({ versionCode: '2025-01' })]

  test('只有適用的那一版被標起來', () => {
    const display = toVersionDisplayRows(rows, '2025-01')
    expect(display.map((row) => row.isEffective)).toEqual([false, true])
  })

  test('改基準日之後標記會跳到另一列——那正是這一欄存在的理由', () => {
    expect(toVersionDisplayRows(rows, '2026-01').map((row) => row.isEffective)).toEqual([true, false])
  })

  test('這一天沒有任何一版適用時，一列都不標', () => {
    expect(toVersionDisplayRows(rows, null).every((row) => !row.isEffective)).toBe(true)
  })
})
