/**
 * `employees/main` 的純函式測試（§7.1）。
 *
 * 這些是**不需要資料庫**的規則，因此獨立成一支：端點測試要連 MariaDB，而下面這幾條
 * （身分證正規化、預設排序、明文有沒有真的被遮罩）是規則本身，不該綁在環境上。
 */
import { Buffer } from 'node:buffer'
import { describe, expect, test } from 'bun:test'
import { createFieldCipher, createKeyRing, ENCRYPTION_KEY_BYTE_LENGTH } from '../../../../db/field-encryption.ts'
import { normalizeIdentityNumber } from '../domain/employee-identity.ts'
import { DEFAULT_EMPLOYEE_SORT, resolveEmployeeSort } from '../domain/employee-list-view.ts'
import { toEncryptedColumns, toMaskedDetail } from '../domain/employee-secrets.ts'
import type { EmployeeProfileInput } from '../domain/employee-model.ts'

const testKey = (seed: number): string => Buffer.alloc(ENCRYPTION_KEY_BYTE_LENGTH, seed).toString('base64')

const cipher = createFieldCipher(
  createKeyRing({ keys: `v1:${testKey(11)}`, activeKeyId: 'v1', blindIndexKey: testKey(12) }),
)

const profile: EmployeeProfileInput = {
  employeeCode: 'A001',
  name: '王小明',
  gender: 'MALE',
  identityNumber: 'A123456789',
  birthday: '1990-05-21',
  phone: '0912345678',
  email: 'someone@example.com',
  address: '台北市信義區信義路五段7號',
}

describe('身分證正規化', () => {
  test('去掉前後空白並轉大寫', () => {
    expect(normalizeIdentityNumber('  a123456789 ')).toBe('A123456789')
  })

  test('大小寫不同的同一個號碼算出同一個 blind index', () => {
    // 沒有這一步的話，同一個人用不同大小寫可以被建立兩次，而唯一鍵一次也擋不到
    // ——HMAC 是逐位元組計算的，'a' 與 'A' 是兩個不同的位元組。
    const lower = cipher.blindIndex(normalizeIdentityNumber('a123456789'))
    const upper = cipher.blindIndex(normalizeIdentityNumber('A123456789'))
    expect(lower.equals(upper)).toBe(true)
  })
})

describe('列表排序', () => {
  test('沒送 sort 時補上預設值（回聲的必須是實際生效的排序）', () => {
    expect(resolveEmployeeSort(undefined)).toEqual(DEFAULT_EMPLOYEE_SORT)
    expect(DEFAULT_EMPLOYEE_SORT).toEqual({ field: 'employeeCode', order: 'asc' })
  })

  test('有送就照送的用', () => {
    expect(resolveEmployeeSort({ field: 'name', order: 'desc' })).toEqual({ field: 'name', order: 'desc' })
  })
})

describe('明文 → 加密欄位 → 遮罩輸出', () => {
  const columns = toEncryptedColumns(cipher, profile)

  test('加密欄位裡找不到任何一段明文', () => {
    // 這是「資料庫裡沒有明文」這件事在純函式層級的證明：
    // 端點測試會再從真正的資料庫確認一次。
    for (const value of [profile.identityNumber, profile.birthday, profile.phone, profile.address]) {
      const haystack = Buffer.concat([
        columns.identityNumberEncrypted,
        columns.identityNumberHash,
        columns.birthdayEncrypted,
        columns.phoneEncrypted,
        columns.addressEncrypted,
      ]).toString('latin1')
      expect(haystack).not.toContain(value)
    }
  })

  test('身分證的 blind index 用的是正規化後的值', () => {
    const lowerCased = toEncryptedColumns(cipher, { ...profile, identityNumber: 'a123456789' })
    expect(lowerCased.identityNumberHash.equals(columns.identityNumberHash)).toBe(true)
  })

  test('沒填 Email 時寫入 null，而不是加密一個空字串', () => {
    // 加密後的空字串在資料庫裡是一串看起來很正常的位元組，
    // 於是「沒填」與「填了空字串」再也分不出來。
    expect(toEncryptedColumns(cipher, { ...profile, email: null }).emailEncrypted).toBeNull()
  })

  test('讀回來的每一個敏感欄位都已遮罩，型別上根本沒有明文欄位', () => {
    const detail = toMaskedDetail(cipher, {
      id: 'employee-id',
      employeeCode: profile.employeeCode,
      name: profile.name,
      gender: profile.gender,
      identityNumberEncrypted: columns.identityNumberEncrypted,
      birthdayEncrypted: columns.birthdayEncrypted,
      phoneEncrypted: columns.phoneEncrypted,
      emailEncrypted: columns.emailEncrypted,
      addressEncrypted: columns.addressEncrypted,
      createdAt: '2026-08-27 12:00:00',
      updatedAt: '2026-08-27 12:00:00',
    })

    expect(detail.identityNumberMasked).toBe('*******789')
    expect(detail.birthdayMasked).toBe('1990-**-**')
    expect(detail.phoneMasked).toBe('*******678')
    expect(detail.emailMasked).toBe('s***@example.com')
    expect(detail.addressMasked).toBe('台北市信義區***')

    // 整包序列化之後也找不到任何一段明文——這才是「對外回應一律遮罩」真正要保證的事。
    const serialized = JSON.stringify(detail)
    expect(serialized).not.toContain(profile.identityNumber)
    expect(serialized).not.toContain(profile.birthday)
    expect(serialized).not.toContain(profile.phone)
    expect(serialized).not.toContain(profile.address)
  })
})
