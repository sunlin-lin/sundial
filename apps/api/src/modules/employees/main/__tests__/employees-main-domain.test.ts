/**
 * `employees/main` 的純函式測試（§7.1）。
 *
 * 這些是**不需要資料庫**的規則，因此獨立成一支：端點測試要連 MariaDB，而下面這幾條
 * （身分證正規化、預設排序、明文有沒有真的被遮罩）是規則本身，不該綁在環境上。
 */
import { describe, expect, test } from 'bun:test'
import { normalizeIdentityNumber } from '../domain/employee-identity.ts'
import { DEFAULT_EMPLOYEE_SORT, resolveEmployeeSort } from '../domain/employee-list-view.ts'
import { toMaskedDetail, toStoredColumns } from '../domain/employee-secrets.ts'
import type { EmployeeProfileInput } from '../domain/employee-model.ts'

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

  test('大小寫不同的同一個號碼正規化後寫入同一個值', () => {
    // 沒有這一步的話，同一個人用不同大小寫可以被建立兩次，而唯一鍵（建在明文欄位上）
    // 一次也擋不到——唯一鍵比對的是逐位元組相等，'a' 與 'A' 是兩個不同的字元。
    const lower = toStoredColumns({ ...profile, identityNumber: 'a123456789' })
    const upper = toStoredColumns({ ...profile, identityNumber: 'A123456789' })
    expect(lower.identityNumber).toBe(upper.identityNumber)
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

describe('明文輸入 → 明文欄位 → 遮罩輸出', () => {
  const columns = toStoredColumns(profile)

  test('身分證欄位是正規化後的值', () => {
    const lowerCased = toStoredColumns({ ...profile, identityNumber: 'a123456789' })
    expect(lowerCased.identityNumber).toBe(columns.identityNumber)
  })

  test('沒填 Email 時寫入 null，而不是空字串', () => {
    // `null` 代表「沒填」，空字串代表「填了空白」，兩者不能混用——否則「沒填」與「填了空字串」
    // 就再也分不出來。
    expect(toStoredColumns({ ...profile, email: null }).email).toBeNull()
  })

  test('讀回來的每一個敏感欄位都已遮罩，型別上根本沒有明文欄位', () => {
    const detail = toMaskedDetail(
      {
        id: 'employee-id',
        employeeCode: profile.employeeCode,
        name: profile.name,
        gender: profile.gender,
        identityNumber: columns.identityNumber,
        birthday: columns.birthday,
        phone: columns.phone,
        email: columns.email,
        address: columns.address,
        createdAt: '2026-08-27 12:00:00',
        updatedAt: '2026-08-27 12:00:00',
      },
      // companyUserId 由呼叫端（repository）另外查好才傳入，本函式是零 IO 純函式（見檔頭）；
      // 這裡任取一個值即可，不是本測試要驗的東西。
      null,
    )

    expect(detail.identityNumberMasked).toBe('*******789')
    expect(detail.birthdayMasked).toBe('1990-**-**')
    expect(detail.phoneMasked).toBe('*******678')
    expect(detail.emailMasked).toBe('s***@example.com')
    expect(detail.addressMasked).toBe('台北市信義區***')

    // 整包序列化之後也找不到任何一段明文——這才是「對外回應一律遮罩」真正要保證的事，
    // 與儲存方式（過去加密、現在明文）無關。
    const serialized = JSON.stringify(detail)
    expect(serialized).not.toContain(profile.identityNumber)
    expect(serialized).not.toContain(profile.birthday)
    expect(serialized).not.toContain(profile.phone)
    expect(serialized).not.toContain(profile.address)
  })

  test('欄位是 null（尚未回填）時，遮罩函式直接拋例外而不是靜默略過', () => {
    // 回填前的舊資料讀出來 identityNumber 是 null（見 `domain/employee-secrets.ts` 的
    // `requirePlaintext`）；這裡要驗的是「拋例外」本身，不是拋出的訊息內容。
    expect(() =>
      toMaskedDetail(
        {
          id: 'employee-id',
          employeeCode: profile.employeeCode,
          name: profile.name,
          gender: profile.gender,
          identityNumber: null,
          birthday: columns.birthday,
          phone: columns.phone,
          email: columns.email,
          address: columns.address,
          createdAt: '2026-08-27 12:00:00',
          updatedAt: '2026-08-27 12:00:00',
        },
        null,
      ),
    ).toThrow()
  })
})
