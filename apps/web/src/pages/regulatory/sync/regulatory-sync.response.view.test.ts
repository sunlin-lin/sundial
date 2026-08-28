import { describe, expect, test } from 'bun:test'
import type { RegulatorySyncListData } from '../../../api/generated/api-client.ts'
import {
  AuthRequiredError,
  BusinessRuleError,
  PermissionDeniedError,
  SystemFailureError,
} from '../../../shared/api/api-error.ts'
import { toSyncListQuery } from './regulatory-sync.payload.ts'
import {
  isSyncListEcho,
  toLoadFailure,
  toTotalCount,
} from './regulatory-sync.response.view.ts'

const buildPage = (overrides: Partial<RegulatorySyncListData> = {}): RegulatorySyncListData => ({
  search: { datasetCode: 1 },
  sort: { field: 'startedAt', order: 'desc' },
  pagination: { currentPage: 1, perPage: 20, totalCount: 3 },
  data: [],
  ...overrides,
})

describe('列表回應的回聲比對（舊回應必須被丟棄）', () => {
  const query = toSyncListQuery(1, 1)

  test('條件與排序都相同時採用', () => {
    expect(isSyncListEcho(buildPage(), query)).toBe(true)
  })

  test('資料集不同的回應一律丟棄——那是上一次點選送出的請求晚回來了', () => {
    expect(isSyncListEcho(buildPage({ search: { datasetCode: 5 } }), query)).toBe(false)
  })

  test('排序欄位不同的回應一律丟棄', () => {
    expect(isSyncListEcho(buildPage({ sort: { field: 'createdAt', order: 'desc' } }), query)).toBe(
      false,
    )
  })

  test('排序方向不同的回應一律丟棄', () => {
    expect(isSyncListEcho(buildPage({ sort: { field: 'startedAt', order: 'asc' } }), query)).toBe(
      false,
    )
  })

  test('換了資料集之後，舊資料集的回應比不過新的查詢條件', () => {
    expect(isSyncListEcho(buildPage(), toSyncListQuery(5, 1))).toBe(false)
  })
})

describe('總筆數的收斂', () => {
  test('數字原樣回傳', () => {
    expect(toTotalCount(137)).toBe(137)
  })

  test('字串逐位換算，結果與數字形式相同', () => {
    expect(toTotalCount('137')).toBe(137)
  })

  test('零與前導零都算得出來', () => {
    expect(toTotalCount('0')).toBe(0)
    expect(toTotalCount('007')).toBe(7)
  })

  test('前後空白不影響結果', () => {
    expect(toTotalCount(' 42 ')).toBe(42)
  })

  test('讀不懂的字串回 0，不拋例外——一格壞掉不該讓整頁白掉', () => {
    expect(toTotalCount('1e5')).toBe(0)
    expect(toTotalCount('')).toBe(0)
  })
})

describe('載入失敗的分流', () => {
  test('沒有權限時顯示後端回來的那句話，前端不另備文案', () => {
    const failure = toLoadFailure(new PermissionDeniedError('您沒有執行此操作的權限'))
    expect(failure).toEqual({ kind: 'permission-denied', message: '您沒有執行此操作的權限' })
  })

  test('沒有權限不算系統錯誤，因此走不到重試那條路徑', () => {
    expect(toLoadFailure(new PermissionDeniedError('無權限')).kind).not.toBe('system')
  })

  test.each([
    ['系統錯誤', new SystemFailureError('系統錯誤', '400', null)],
    ['業務錯誤', new BusinessRuleError('不允許', [])],
    ['沒有身分', new AuthRequiredError('請重新登入')],
    ['不是 Error 的東西', 'boom'],
  ])('%s 一律走可重試的系統錯誤畫面', (_label, error) => {
    expect(toLoadFailure(error).kind).toBe('system')
  })
})
