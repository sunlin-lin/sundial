import { describe, expect, test } from 'bun:test'
import { defaultEmployeeListFilters, EMPLOYEE_LIST_PER_PAGE, toEmployeeListQuery } from './employees-main.payload.ts'

describe('toEmployeeListQuery', () => {
  test('省略空白關鍵字，不送出 keyword 欄位', () => {
    const query = toEmployeeListQuery(defaultEmployeeListFilters(), 1)

    expect('keyword' in query).toBe(false)
    expect(query.currentPage).toBe(1)
    expect(query.perPage).toBe(EMPLOYEE_LIST_PER_PAGE)
    expect(query.sort).toEqual({ field: 'employeeCode', order: 'asc' })
  })

  test('關鍵字前後空白會被裁掉', () => {
    const query = toEmployeeListQuery({ keyword: '  A001  ' }, 2)

    expect(query.keyword).toBe('A001')
    expect(query.currentPage).toBe(2)
  })

  test('只有空白字元的關鍵字視同未輸入', () => {
    const query = toEmployeeListQuery({ keyword: '   ' }, 1)

    expect('keyword' in query).toBe(false)
  })
})
