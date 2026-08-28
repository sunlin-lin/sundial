import { describe, expect, test } from 'bun:test'
import { DEFAULT_DATASET_CODE, SYNC_LIST_PER_PAGE, toSyncListQuery } from './regulatory-sync.payload.ts'

describe('同步歷程的查詢組裝', () => {
  test('帶上資料集、頁碼與每頁筆數', () => {
    expect(toSyncListQuery(3, 2)).toEqual({
      datasetCode: 3,
      currentPage: 2,
      perPage: SYNC_LIST_PER_PAGE,
      sort: { field: 'startedAt', order: 'desc' },
    })
  })

  test('排序一定明寫，不靠後端補預設——省略的話每一包回應都會比不過回聲而被丟棄', () => {
    expect(toSyncListQuery(1, 1).sort).toEqual({ field: 'startedAt', order: 'desc' })
  })

  test('排序是開始時間由新到舊：這一頁要回答的是「最近一次同步的結果如何」', () => {
    expect(toSyncListQuery(1, 1).sort.field).toBe('startedAt')
    expect(toSyncListQuery(1, 1).sort.order).toBe('desc')
  })

  test('每頁筆數與後端預設相同', () => {
    expect(SYNC_LIST_PER_PAGE).toBe(20)
  })

  test('查詢裡沒有任何公司欄位（計畫 §2.1，日後也不得加）', () => {
    expect(Object.keys(toSyncListQuery(1, 1)).sort()).toEqual([
      'currentPage',
      'datasetCode',
      'perPage',
      'sort',
    ])
  })

  test('預設選的資料集是合法代碼之一，一進頁面就查得出東西', () => {
    expect(toSyncListQuery(DEFAULT_DATASET_CODE, 1).datasetCode).toBe(DEFAULT_DATASET_CODE)
  })
})
