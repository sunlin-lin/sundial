/**
 * 遮罩函式的純函式測試（§7.1、§5.1）。
 *
 * 這幾條斷言的重點不是「輸出長什麼樣」，而是**哪些字元不會出現在輸出裡**——
 * 遮罩寫錯的症狀是回應裡多露了幾碼，那既不會報錯也不會讓任何測試變紅。
 */
import { describe, expect, test } from 'bun:test'
import {
  maskAddress,
  maskBirthday,
  maskEmail,
  maskIdentityNumber,
  maskOptionalEmail,
  maskPhone,
} from '../field-masking.ts'

describe('身分證遮罩（§5.1：僅末 3 碼）', () => {
  test('只露出最後 3 碼，長度不變', () => {
    expect(maskIdentityNumber('A123456789')).toBe('*******789')
  })

  test('輸出不含前 7 碼的任何一段', () => {
    const masked = maskIdentityNumber('A123456789')
    expect(masked).not.toContain('A12')
    expect(masked).not.toContain('3456')
  })

  test('值比要保留的位數還短時整串遮掉，而不是幾乎全露', () => {
    expect(maskIdentityNumber('AB1')).toBe('***')
    expect(maskIdentityNumber('A')).toBe('*')
    expect(maskIdentityNumber('')).toBe('')
  })
})

describe('電話遮罩', () => {
  test('只露出最後 3 碼', () => {
    expect(maskPhone('0912345678')).toBe('*******678')
  })
})

describe('生日遮罩', () => {
  test('保留年份、遮掉月日', () => {
    expect(maskBirthday('1990-05-21')).toBe('1990-**-**')
  })

  test('不是預期格式時整串遮掉', () => {
    expect(maskBirthday('19900521')).toBe('***')
    expect(maskBirthday('')).toBe('***')
  })
})

describe('Email 遮罩', () => {
  test('保留首字元與網域', () => {
    expect(maskEmail('someone@example.com')).toBe('s***@example.com')
  })

  test('遮罩長度固定，不洩漏 local part 的字數', () => {
    expect(maskEmail('ab@x.com')).toBe('a***@x.com')
    expect(maskEmail('abcdefghijklmnop@x.com')).toBe('a***@x.com')
  })

  test('沒有 @ 的值整串遮掉', () => {
    expect(maskEmail('not-an-email')).toBe('***')
  })

  test('選填版本把 null 原樣帶過（「沒填」與「填了但看不到」必須分得出來）', () => {
    expect(maskOptionalEmail(null)).toBeNull()
    expect(maskOptionalEmail('someone@example.com')).toBe('s***@example.com')
  })
})

describe('地址遮罩', () => {
  test('保留縣市與行政區，其餘固定長度遮罩', () => {
    expect(maskAddress('台北市信義區信義路五段7號')).toBe('台北市信義區***')
  })

  test('輸出不含路名與門牌', () => {
    const masked = maskAddress('台北市信義區信義路五段7號')
    expect(masked).not.toContain('信義路')
    expect(masked).not.toContain('7號')
  })

  test('遮罩長度固定，不洩漏原地址的字數', () => {
    expect(maskAddress('台北市信義區信義路五段7號')).toBe(maskAddress('台北市信義區松智路1號'))
  })

  test('短到只有縣市區時整串遮掉', () => {
    expect(maskAddress('台北市信義區')).toBe('***')
  })
})
