import { describe, expect, test } from 'bun:test'
import { sourceTypeLabel } from './source-type.ts'

const $t = (key: string): string => key

describe('sourceTypeLabel：對齊後端代碼', () => {
  test('現場打卡', () => {
    expect(sourceTypeLabel(1, $t)).toBe('attendance.source.field')
  })

  test('人工補登', () => {
    expect(sourceTypeLabel(2, $t)).toBe('attendance.source.manual-correction')
  })
})
