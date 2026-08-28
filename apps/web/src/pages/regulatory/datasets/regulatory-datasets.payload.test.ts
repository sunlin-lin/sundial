import { describe, expect, test } from 'bun:test'
import {
  VERSION_LIST_PER_PAGE,
  toOverviewQuery,
  toResolveQuery,
  toVersionListQuery,
} from './regulatory-datasets.payload.ts'

describe('總覽的查詢組裝', () => {
  test('只有基準日一個欄位——後端必填且不預設今天（計畫 §4.2）', () => {
    expect(toOverviewQuery('2024-06-01')).toEqual({ asOfDate: '2024-06-01' })
  })

  test('查詢裡沒有任何公司欄位（計畫 §2.1，日後也不得加）', () => {
    expect(Object.keys(toOverviewQuery('2026-01-01'))).toEqual(['asOfDate'])
  })
})

describe('版本清單的查詢組裝', () => {
  test('帶上資料集、頁碼與每頁筆數', () => {
    expect(toVersionListQuery(2, 3)).toEqual({
      datasetCode: 2,
      currentPage: 3,
      perPage: VERSION_LIST_PER_PAGE,
      sort: { field: 'effectiveFrom', order: 'desc' },
    })
  })

  test('排序一定明寫，不靠後端補預設——省略的話每一包回應都會比不過回聲而被丟棄', () => {
    expect(toVersionListQuery(1, 1).sort).toEqual({ field: 'effectiveFrom', order: 'desc' })
  })

  test('排序是生效日由新到舊：這一頁問的是「哪一版適用於哪一段期間」', () => {
    expect(toVersionListQuery(1, 1).sort.field).toBe('effectiveFrom')
    expect(toVersionListQuery(1, 1).sort.order).toBe('desc')
  })

  test('版本清單不吃基準日——「有哪幾版」與「今天適用哪一版」是兩個問題', () => {
    expect(Object.keys(toVersionListQuery(1, 1))).not.toContain('asOfDate')
  })

  test('查詢裡沒有任何公司欄位（計畫 §2.1，日後也不得加）', () => {
    expect(Object.keys(toVersionListQuery(1, 1)).sort()).toEqual([
      'currentPage',
      'datasetCode',
      'perPage',
      'sort',
    ])
  })
})

describe('版本內容的查詢組裝', () => {
  test('資料集 ＋ 基準日，沒有版本 id——後端沒有「依版本取內容」的端點', () => {
    expect(toResolveQuery(3, '2025-01-01')).toEqual({ datasetCode: 3, asOfDate: '2025-01-01' })
  })
})
