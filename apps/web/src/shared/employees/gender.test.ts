import { describe, expect, test } from 'bun:test'
import { genderLabel } from './gender.ts'

describe('genderLabel', () => {
  test('MALE 對到男性的 key', () => {
    expect(genderLabel('MALE', (key) => key)).toBe('employees.gender.male')
  })

  test('FEMALE 對到女性的 key', () => {
    expect(genderLabel('FEMALE', (key) => key)).toBe('employees.gender.female')
  })
})
