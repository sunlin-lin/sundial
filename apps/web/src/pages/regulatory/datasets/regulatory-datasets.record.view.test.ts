import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { columnsFor } from './regulatory-datasets.columns.view.ts'
import { toRecordDisplayRows, type RecordRow } from './regulatory-datasets.record.view.ts'

/** 翻譯替身：原樣回傳 key，讓斷言直接看得出組出來的是哪一則訊息。 */
const echoTranslate: TranslateMessage = (key) => key

const buildRecord = (recordKey: string, grade: string): RecordRow => ({
  id: 1,
  recordKey,
  code: grade,
  name: '一般勞工',
  rangeFrom: '29501',
  rangeTo: '30300',
  amount: '30300',
  rate: null,
  sortOrder: 2,
  data: {
    insuredCategoryCode: 'general',
    insuredCategoryName: '一般勞工',
    grade,
    monthlySalaryRangeText: '29501元至30300元',
    monthlySalaryFrom: '29501',
    monthlySalaryTo: '30300',
    monthlyInsuredSalary: '30300',
  },
})

describe('一筆 record → 表格的一列', () => {
  const columns = columnsFor(1, echoTranslate)

  test('每一欄都變成一個已經算好的字串，模板不再做任何換算', () => {
    const [row] = toRecordDisplayRows(columns, [buildRecord('general-2', '2')])
    expect(row?.['monthlyInsuredSalary']).toBe('30,300')
    expect(row?.['insuredCategoryName']).toBe('一般勞工')
  })

  test('row-key 用後端的 record_key，不用陣列索引', () => {
    const rows = toRecordDisplayRows(columns, [buildRecord('general-1', '1'), buildRecord('general-2', '2')])
    expect(rows.map((row) => row.rowKey)).toEqual(['general-1', 'general-2'])
  })

  test('只組欄位定義列出來的欄——`data` 裡沒被定義的欄位不會偷偷跑到表格上', () => {
    const [row] = toRecordDisplayRows(columns, [buildRecord('general-2', '2')])
    const keys = Object.keys(row ?? {}).filter((key) => key !== 'rowKey')
    expect(keys.sort()).toEqual(columns.map((column) => column.key).sort())
  })

  test('沒有 record 時組出空清單，不是一列空白', () => {
    expect(toRecordDisplayRows(columns, [])).toEqual([])
  })

  test('沒有欄位定義時每一列只剩 row-key——這種情況代表欄位定義漏了一個資料集', () => {
    const [row] = toRecordDisplayRows([], [buildRecord('general-2', '2')])
    expect(Object.keys(row ?? {})).toEqual(['rowKey'])
  })
})
