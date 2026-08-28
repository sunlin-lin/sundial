import { describe, expect, test } from 'bun:test'
import { hasPermission } from './permission.ts'

describe('權限碼判斷', () => {
  test('權限碼在集合裡時允許', () => {
    expect(hasPermission(['regulatory.sync.list'], 'regulatory.sync.list')).toBe(true)
  })

  test('權限碼不在集合裡時不允許', () => {
    expect(hasPermission(['regulatory.sync.list'], 'regulatory.datasets.overview')).toBe(false)
  })

  test('空集合一律不允許——剛啟動、還沒取回身分時就是這個狀態', () => {
    expect(hasPermission([], 'regulatory.datasets.overview')).toBe(false)
  })

  test('後端回來的其他權限碼不影響判斷，也不需要被前端宣告過', () => {
    const granted = ['employees.main.list', 'roles.main.list', 'regulatory.datasets.overview']
    expect(hasPermission(granted, 'regulatory.datasets.overview')).toBe(true)
    expect(hasPermission(granted, 'regulatory.sync.list')).toBe(false)
  })

  test('比對是逐字相等，不是前綴——有父節點不等於有葉節點', () => {
    // 後端的權限目錄是樹狀（`regulatory.datasets` 是不可指派的分類節點），
    // 若這裡寫成 `startsWith`，被授予父節點的人會拿到底下全部端點的權限。
    expect(hasPermission(['regulatory.datasets'], 'regulatory.datasets.list')).toBe(false)
    expect(hasPermission(['regulatory.datasets.listing'], 'regulatory.datasets.list')).toBe(false)
  })
})
