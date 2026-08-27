/**
 * `roles/main` 的純函式測試（§7.1）。
 *
 * 這些是**不需要資料庫**的業務規則，因此獨立成一支：端點測試要連 MariaDB，而下面這幾條
 * （錯誤有沒有累積、索引對不對、最後一個管理角色的判定）是規則本身，不該綁在環境上。
 */
import { describe, expect, test } from 'bun:test'
import {
  isLastAdminCapableRole,
  wouldDeactivateLastAdminCapableRole,
  type AdminCapableRole,
} from '../domain/admin-capability.ts'
import { readAffectedRows } from '../domain/driver-result.ts'
import { resolveRoleSort, toKeywordPattern } from '../domain/role-list-view.ts'
import { collectPermissionSelectionErrors, dedupePermissionIds } from '../domain/role-permission-rules.ts'
import { RoleErrorCode } from '../roles-main.errors.ts'

describe('權限選取的錯誤組裝', () => {
  test('全部合格時回空陣列', () => {
    const errors = collectPermissionSelectionErrors(['a', 'b'], { missingIds: [], notAssignableIds: [] })
    expect(errors).toEqual([])
  })

  test('多筆不合格時全部回報，而不是第一筆就中斷', () => {
    // 這條是 §3.1.1 的核心：只回一筆時回應在型別上完全合法、HTTP status 也對，
    // 沒有任何其他檢查抓得到——使用者卻要修三次表單才知道總共有幾個問題。
    const errors = collectPermissionSelectionErrors(['ok', 'missing', 'category', 'missing-2'], {
      missingIds: ['missing', 'missing-2'],
      notAssignableIds: ['category'],
    })

    expect(errors).toHaveLength(3)
    expect(errors.map((error) => error.code)).toEqual([
      RoleErrorCode.PermissionNotFound,
      RoleErrorCode.PermissionNotAssignable,
      RoleErrorCode.PermissionNotFound,
    ])
  })

  test('field 帶著使用者送來的陣列索引，不是欄位名', () => {
    const errors = collectPermissionSelectionErrors(['ok', 'ok-2', 'category'], {
      missingIds: [],
      notAssignableIds: ['category'],
    })

    expect(errors[0]?.data?.['field']).toBe('permissionIds.2')
  })

  test('重複的權限 ID 會被收斂，且保留首次出現的順序', () => {
    expect(dedupePermissionIds(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c'])
  })
})

describe('最後一個具管理能力的角色', () => {
  const target: AdminCapableRole = { id: 'target', status: 'ACTIVE' }
  const other: AdminCapableRole = { id: 'other', status: 'ACTIVE' }

  test('只有它一個時，不可刪除', () => {
    expect(isLastAdminCapableRole('target', [target])).toBe(true)
  })

  test('還有第二個時，可以刪除', () => {
    expect(isLastAdminCapableRole('target', [target, other])).toBe(false)
  })

  test('本來就不具管理能力的角色不受這條規則限制', () => {
    expect(isLastAdminCapableRole('not-admin', [target, other])).toBe(false)
  })

  test('停用時只算「還啟用著」的管理角色——另一個也停用等於公司一樣被鎖在門外', () => {
    const inactiveOther: AdminCapableRole = { id: 'other', status: 'INACTIVE' }
    expect(wouldDeactivateLastAdminCapableRole('target', [target, inactiveOther])).toBe(true)
    expect(wouldDeactivateLastAdminCapableRole('target', [target, other])).toBe(false)
  })
})

describe('列表條件', () => {
  test('關鍵字中的 LIKE 萬用字元會被跳脫', () => {
    // 不跳脫的話，使用者輸入一個 `%` 就等於查詢全部資料。
    expect(toKeywordPattern('100%_a')).toBe('%100\\%\\_a%')
  })

  test('未指定排序時補上預設值，回聲的才會是實際生效的排序', () => {
    expect(resolveRoleSort(undefined)).toEqual({ field: 'code', order: 'asc' })
    expect(resolveRoleSort({ field: 'name', order: 'desc' })).toEqual({ field: 'name', order: 'desc' })
  })
})

describe('影響列數的讀取', () => {
  test('讀得出 mysql2 的巢狀結果', () => {
    expect(readAffectedRows([{ affectedRows: 1 }, []])).toBe(1)
    expect(readAffectedRows({ affectedRows: 0 })).toBe(0)
  })

  test('形狀不符時拋出，而不是猜一個數字', () => {
    // 猜 0 會讓每次正常的狀態變更都被回報成「資料已被別人改過」；
    // 猜 1 會讓真正的併發衝突靜靜通過，而副作用被套用兩次。
    expect(() => readAffectedRows(null)).toThrow()
    expect(() => readAffectedRows({})).toThrow()
  })
})
