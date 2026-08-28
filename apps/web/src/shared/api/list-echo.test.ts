import { describe, expect, test } from 'bun:test'
import { isListEcho, type ListSort } from './list-echo.ts'

const SORT: ListSort = { field: 'startedAt', order: 'desc' }

describe('列表回應的回聲比對（舊回應必須被丟棄）', () => {
  test('條件與排序都相同時採用', () => {
    expect(isListEcho({ search: { datasetCode: 1 }, sort: SORT }, { datasetCode: 1, sort: SORT })).toBe(
      true,
    )
  })

  test('條件不同的回應一律丟棄——那是上一次點選送出的請求晚回來了', () => {
    expect(isListEcho({ search: { datasetCode: 5 }, sort: SORT }, { datasetCode: 1, sort: SORT })).toBe(
      false,
    )
  })

  test('排序欄位不同的回應一律丟棄', () => {
    expect(
      isListEcho(
        { search: { datasetCode: 1 }, sort: { field: 'createdAt', order: 'desc' } },
        { datasetCode: 1, sort: SORT },
      ),
    ).toBe(false)
  })

  test('排序方向不同的回應一律丟棄', () => {
    expect(
      isListEcho(
        { search: { datasetCode: 1 }, sort: { field: 'startedAt', order: 'asc' } },
        { datasetCode: 1, sort: SORT },
      ),
    ).toBe(false)
  })

  test('多個篩選欄位時每一個都要相符，只對一半不算回聲', () => {
    const page = { search: { datasetCode: 1, keyword: 'a' }, sort: SORT }
    expect(isListEcho(page, { datasetCode: 1, keyword: 'a', sort: SORT })).toBe(true)
    expect(isListEcho(page, { datasetCode: 1, keyword: 'b', sort: SORT })).toBe(false)
  })

  test('分頁欄位不參與比對——同一組條件翻頁時回應必須被採用', () => {
    // 送出的查詢**一定比回聲多幾個欄位**（分頁），所以這裡先落成一個變數：
    // 直接寫成物件字面值會被 TypeScript 的多餘屬性檢查擋下，而實際呼叫端傳的一律是變數。
    const query = { datasetCode: 1, currentPage: 3, perPage: 20, sort: SORT }
    expect(isListEcho({ search: { datasetCode: 1 }, sort: SORT }, query)).toBe(true)
  })

  test('回聲的值是 null 時同樣逐字相等才算相符', () => {
    const page: { search: { keyword: string | null }; sort: ListSort } = {
      search: { keyword: null },
      sort: SORT,
    }
    expect(isListEcho(page, { keyword: null, sort: SORT })).toBe(true)
    expect(isListEcho(page, { keyword: '', sort: SORT })).toBe(false)
  })
})
