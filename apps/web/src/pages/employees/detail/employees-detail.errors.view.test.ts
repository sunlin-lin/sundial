import { describe, expect, test } from 'bun:test'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
} from './employees-detail.errors.view.ts'
import { PermissionDeniedError } from '../../../shared/api/api-error.ts'

type FieldKey = 'departmentId' | 'effectiveFrom'
const KNOWN_KEYS: readonly FieldKey[] = ['departmentId', 'effectiveFrom']

const buildError = (field: string, msg = 'error'): EnvelopeError => ({ code: 'x.errors.y', msg, data: { field } })

describe('toFormErrors', () => {
  test('對得到已知欄位的錯誤進 fieldErrors，對不到的進 generalMessages', () => {
    const errors = [buildError('departmentId', '部門不存在'), buildError('employmentId', '不應該出現在表單上')]
    const result = toFormErrors(errors, KNOWN_KEYS)

    expect(result.fieldErrors.get('departmentId')).toEqual(['部門不存在'])
    expect(result.generalMessages).toEqual(['不應該出現在表單上'])
  })

  test('同一欄位多筆錯誤會累積', () => {
    const errors = [buildError('effectiveFrom', 'A'), buildError('effectiveFrom', 'B')]
    const result = toFormErrors(errors, KNOWN_KEYS)
    expect(result.fieldErrors.get('effectiveFrom')).toEqual(['A', 'B'])
  })

  test('沒有 field 的錯誤進 generalMessages', () => {
    const errors: EnvelopeError[] = [{ code: 'x', msg: '系統忙碌', data: {} }]
    const result = toFormErrors(errors, KNOWN_KEYS)
    expect(result.generalMessages).toEqual(['系統忙碌'])
  })
})

describe('formItemErrorProp', () => {
  test('有錯誤時回傳帶 error 鍵的物件，沒有錯誤時回空物件（不是 { error: undefined }）', () => {
    const withError = toFormErrors([buildError('departmentId', '錯誤訊息')], KNOWN_KEYS)
    expect(formItemErrorProp(withError, 'departmentId')).toEqual({ error: '錯誤訊息' })
    expect(formItemErrorProp(withError, 'effectiveFrom')).toEqual({})
    expect('error' in formItemErrorProp(withError, 'effectiveFrom')).toBe(false)
  })
})

describe('firstErroredElementId', () => {
  const elementIdOf: Record<FieldKey, string> = {
    departmentId: 'field-department',
    effectiveFrom: 'field-effective-from',
  }

  test('依 knownKeys 順序回傳第一個有錯誤欄位的 DOM id', () => {
    const errors = toFormErrors([buildError('effectiveFrom')], KNOWN_KEYS)
    expect(firstErroredElementId(errors, KNOWN_KEYS, elementIdOf)).toBe('field-effective-from')
  })

  test('沒有欄位級錯誤時回 undefined', () => {
    expect(firstErroredElementId(emptyFormErrors<FieldKey>(), KNOWN_KEYS, elementIdOf)).toBeUndefined()
  })
})

describe('toGeneralFailureMessage', () => {
  test('PermissionDeniedError 顯示無權限文案，其餘一律系統錯誤文案', () => {
    const $t = (key: string): string => key
    expect(toGeneralFailureMessage(new PermissionDeniedError('無權限'), $t)).toBe('error.no-permission')
    expect(toGeneralFailureMessage(new Error('boom'), $t)).toBe('error.system')
  })
})
