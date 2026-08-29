import { describe, expect, test } from 'bun:test'
import { BusinessRuleError, PermissionDeniedError } from '../../../shared/api/api-error.ts'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { toGeneralFailureMessage, toShiftFormErrors } from './shifts-main.errors.view.ts'

const echoTranslate: TranslateMessage = (key) => key

const buildError = (field: string | undefined, msg: string): EnvelopeError => ({
  code: 'shifts.main.errors.example',
  msg,
  data: field === undefined ? {} : { field },
})

describe('業務錯誤 → 表單標紅', () => {
  test('列級錯誤：workPeriods.0.endTime 對到第 0 段工作時段', () => {
    const result = toShiftFormErrors([buildError('workPeriods.0.endTime', '結束時刻早於開始時刻')])
    expect(result.workPeriodErrors.get(0)).toEqual(['結束時刻早於開始時刻'])
    expect(result.breakErrors.size).toBe(0)
    expect(result.generalMessages).toEqual([])
  })

  test('列級錯誤：breaks.2.startTime 對到第 2 段休息（陣列索引，不是第幾筆）', () => {
    const result = toShiftFormErrors([buildError('breaks.2.startTime', '休息不在任何工作時段內')])
    expect(result.breakErrors.get(2)).toEqual(['休息不在任何工作時段內'])
  })

  test('同一列可以有多則錯誤，逐一累加而不是互相覆蓋', () => {
    const result = toShiftFormErrors([
      buildError('workPeriods.1.startTime', '第一則'),
      buildError('workPeriods.1.startTime', '第二則'),
    ])
    expect(result.workPeriodErrors.get(1)).toEqual(['第一則', '第二則'])
  })

  test('表單級錯誤（code 重複）走全域提示，不是列級', () => {
    const result = toShiftFormErrors([buildError('code', '代碼重複')])
    expect(result.generalMessages).toEqual(['代碼重複'])
    expect(result.workPeriodErrors.size).toBe(0)
  })

  test('零段工作時段：field 是 "workPeriods"（沒有索引），走全域提示而不是列級', () => {
    const result = toShiftFormErrors([buildError('workPeriods', '至少要有一段工作時段')])
    expect(result.generalMessages).toEqual(['至少要有一段工作時段'])
  })

  test('沒有 field 的錯誤（§6.3 的保底路徑）同樣走全域提示', () => {
    const result = toShiftFormErrors([buildError(undefined, '無法判斷是哪一格')])
    expect(result.generalMessages).toEqual(['無法判斷是哪一格'])
  })

  test('空陣列組出空的錯誤地圖', () => {
    const result = toShiftFormErrors([])
    expect(result.workPeriodErrors.size).toBe(0)
    expect(result.breakErrors.size).toBe(0)
    expect(result.generalMessages).toEqual([])
  })
})

describe('簡單確認式動作的失敗訊息', () => {
  test('901：顯示無權限，不是系統錯誤——絕對不可被誤導成連線問題', () => {
    const error = new PermissionDeniedError('沒有權限')
    expect(toGeneralFailureMessage(error, echoTranslate)).toBe('error.no-permission')
  })

  test('業務錯誤顯示後端回來的第一則 msg，前端不準備第二份文案', () => {
    const error = new BusinessRuleError('失敗', [buildError('id', '班別不存在')])
    expect(toGeneralFailureMessage(error, echoTranslate)).toBe('班別不存在')
  })

  test('其餘一律系統錯誤文案', () => {
    expect(toGeneralFailureMessage(new Error('network down'), echoTranslate)).toBe('error.system')
  })
})
