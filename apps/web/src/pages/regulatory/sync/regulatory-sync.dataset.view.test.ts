import { describe, expect, test } from 'bun:test'
import {
  DATASET_OPTIONS,
  DEFAULT_DATASET_CODE,
  datasetLabelKey,
} from './regulatory-sync.dataset.view.ts'

describe('資料集下拉的選項', () => {
  test('九個資料集全部在選項裡，順序＝代碼順序', () => {
    expect(DATASET_OPTIONS.map((option) => option.code)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10])
  })

  test('7 是永久空號，不得出現——補上它等於把 8 以後的意義往後推一格', () => {
    // 放寬成 `number[]` 才比得下去：`7` 已經不在型別的聯集裡（那正是我們要的），
    // 直接比會被編譯器擋成「不可能相等」。這一條測的是**執行期真的沒有那一項**。
    const codes: readonly number[] = DATASET_OPTIONS.map((option) => option.code)
    expect(codes).not.toContain(7)
  })

  test('每個資料集各有自己的語系 key，沒有兩個資料集共用同一個名稱', () => {
    const labelKeys = DATASET_OPTIONS.map((option) => option.labelKey)
    expect(new Set(labelKeys).size).toBe(labelKeys.length)
  })

  test('預設選的資料集是選項之一——否則下拉一進頁面就是空的', () => {
    expect(DATASET_OPTIONS.some((option) => option.code === DEFAULT_DATASET_CODE)).toBe(true)
  })
})

describe('表格的資料集欄', () => {
  test('代碼對到選項裡的同一個名稱，兩處不會各說各話', () => {
    for (const option of DATASET_OPTIONS) {
      expect(datasetLabelKey(option.code)).toBe(option.labelKey)
    }
  })
})
