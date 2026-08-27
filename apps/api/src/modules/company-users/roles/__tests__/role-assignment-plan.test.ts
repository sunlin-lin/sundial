/**
 * 角色指派／撤銷業務規則的純函式測試（§7.1）。
 *
 * 這裡涵蓋 §7.1 中「造得出情境」的那幾條：成功、業務規則不允許、**一次違反兩條規則**
 * （斷言 `errors` 真的回兩筆），以及跨公司存取與目標不存在的**回應逐項相同**。
 *
 * 為什麼跨公司這條測得動：repository 把 `company_id` 寫進 `WHERE`（§4.2），
 * 別家公司的成員在查詢階段就等同於不存在，兩種情境進到規則層時都是同一個 `member: null`
 * ——因此「回應會不會不一致」在這一層就答得出來，而且答案是「想寫出不一致的都寫不出來」。
 *
 * 需要資料庫才造得出來的情境（HTTP status 與 envelope `code` 的映射、`901` 的 `expiresIn`、
 * 併發撤銷的影響列數）尚未寫：本 repo 目前沒有測試資料庫、沒有 migration 執行器，
 * 也還沒有能簽發 access token 的 `sessions` 模組，硬寫出來的只會是永遠跑不起來的檔案。
 * 這一點已寫進交付回報。
 */
import { describe, expect, test } from 'bun:test'
import { CompanyUserStatus, RoleStatus } from '../../../../db/schema/index.ts'
import { RoleAssignmentErrorCode } from '../company-users-roles.errors.ts'
import {
  planRoleAssignment,
  planRoleRevocation,
  type ActiveAssignment,
  type CompanyUserState,
  type RoleState,
} from '../domain/role-assignment-plan.ts'

const ACTIVE_MEMBER: CompanyUserState = { id: 'member-1', status: CompanyUserStatus.Active }
const INACTIVE_MEMBER: CompanyUserState = { id: 'member-1', status: CompanyUserStatus.Inactive }

const rolesMap = (...roles: readonly RoleState[]): ReadonlyMap<string, RoleState> =>
  new Map(roles.map((role): [string, RoleState] => [role.id, role]))

const activeRole = (id: string): RoleState => ({ id, status: RoleStatus.Active })
const inactiveRole = (id: string): RoleState => ({ id, status: RoleStatus.Inactive })
const assignment = (roleId: string): ActiveAssignment => ({ assignmentId: `assignment-${roleId}`, roleId })

const codesOf = (errors: readonly { readonly code: string }[]): readonly string[] => errors.map((error) => error.code)
const fieldsOf = (errors: readonly { readonly data?: Record<string, unknown> }[]): readonly unknown[] =>
  errors.map((error) => error.data?.['field'])

describe('planRoleAssignment', () => {
  test('成功：全部角色都存在、啟用且尚未指派', () => {
    const plan = planRoleAssignment({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-a', 'role-b'],
      rolesById: rolesMap(activeRole('role-a'), activeRole('role-b')),
      activeAssignments: [],
    })

    expect(plan.errors).toEqual([])
    expect(plan.roleIdsToAssign).toEqual(['role-a', 'role-b'])
  })

  test('成員不存在：整批拒絕，且 field 指向 companyUserId', () => {
    const plan = planRoleAssignment({
      member: null,
      requestedRoleIds: ['role-a'],
      rolesById: rolesMap(activeRole('role-a')),
      activeAssignments: [],
    })

    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.CompanyUserNotFound])
    expect(fieldsOf(plan.errors)).toEqual(['companyUserId'])
    expect(plan.roleIdsToAssign).toEqual([])
  })

  test('跨公司存取的回應與目標不存在逐項相同（§3.2）', () => {
    // repository 的 `WHERE company_id = ?` 讓「別家公司的成員」與「不存在的成員」
    // 都以 `member: null` 進到這一層，因此兩者不可能產生不同的錯誤碼、訊息或 field。
    const targetMissing = planRoleAssignment({
      member: null,
      requestedRoleIds: ['role-a'],
      rolesById: rolesMap(activeRole('role-a')),
      activeAssignments: [],
    })
    const otherCompany = planRoleAssignment({
      member: null,
      requestedRoleIds: ['role-a'],
      rolesById: rolesMap(),
      activeAssignments: [],
    })

    expect(otherCompany.errors).toEqual(targetMissing.errors)
  })

  test('成員已停用：整批拒絕', () => {
    const plan = planRoleAssignment({
      member: INACTIVE_MEMBER,
      requestedRoleIds: ['role-a'],
      rolesById: rolesMap(activeRole('role-a')),
      activeAssignments: [],
    })

    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.CompanyUserInactive])
  })

  test('一次違反兩條規則：errors 同時回兩筆，且各自帶自己的索引', () => {
    // 這是唯一能證明規則層真的在「收集」而不是在第一筆就中斷的方式（§3.1.1）。
    const plan = planRoleAssignment({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-missing', 'role-inactive', 'role-ok'],
      rolesById: rolesMap(inactiveRole('role-inactive'), activeRole('role-ok')),
      activeAssignments: [],
    })

    expect(plan.errors).toHaveLength(2)
    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.RoleNotFound, RoleAssignmentErrorCode.RoleInactive])
    expect(fieldsOf(plan.errors)).toEqual(['roleIds.0', 'roleIds.1'])
    // 有錯誤時整批拒絕，通過檢查的那一筆也不會被寫入——由 service 依 `errors` 是否為空決定。
    expect(plan.roleIdsToAssign).toEqual(['role-ok'])
  })

  test('已經擁有的角色回 already-assigned（Conflict），索引正確', () => {
    const plan = planRoleAssignment({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-a', 'role-b'],
      rolesById: rolesMap(activeRole('role-a'), activeRole('role-b')),
      activeAssignments: [assignment('role-b')],
    })

    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.AlreadyAssigned])
    expect(fieldsOf(plan.errors)).toEqual(['roleIds.1'])
  })

  test('同一請求內重複的角色被擋下，不會產生兩筆 INSERT', () => {
    const plan = planRoleAssignment({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-a', 'role-a'],
      rolesById: rolesMap(activeRole('role-a')),
      activeAssignments: [],
    })

    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.AlreadyAssigned])
    expect(plan.roleIdsToAssign).toEqual(['role-a'])
  })
})

describe('planRoleRevocation', () => {
  test('成功：撤銷後仍留有其他角色', () => {
    const plan = planRoleRevocation({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-a'],
      activeAssignments: [assignment('role-a'), assignment('role-b')],
    })

    expect(plan.errors).toEqual([])
    expect(plan.assignmentIdsToRevoke).toEqual(['assignment-role-a'])
  })

  test('撤銷後會歸零時整批拒絕（UI §3.5：每個帳號至少保留一個角色）', () => {
    const plan = planRoleRevocation({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-a', 'role-b'],
      activeAssignments: [assignment('role-a'), assignment('role-b')],
    })

    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.LastRoleRequired])
    expect(fieldsOf(plan.errors)).toEqual(['roleIds'])
  })

  test('一次違反兩條規則：不存在的指派 ＋ 撤銷後歸零，errors 回兩筆', () => {
    const plan = planRoleRevocation({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-missing', 'role-a'],
      activeAssignments: [assignment('role-a')],
    })

    expect(plan.errors).toHaveLength(2)
    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.NotFound, RoleAssignmentErrorCode.LastRoleRequired])
    expect(fieldsOf(plan.errors)).toEqual(['roleIds.0', 'roleIds'])
  })

  test('停用的成員仍可撤銷角色（離職後必須收得回權限）', () => {
    const plan = planRoleRevocation({
      member: INACTIVE_MEMBER,
      requestedRoleIds: ['role-a'],
      activeAssignments: [assignment('role-a'), assignment('role-b')],
    })

    expect(plan.errors).toEqual([])
    expect(plan.assignmentIdsToRevoke).toEqual(['assignment-role-a'])
  })

  test('成員不存在：與跨公司存取回同一筆錯誤（§3.2）', () => {
    const targetMissing = planRoleRevocation({
      member: null,
      requestedRoleIds: ['role-a'],
      activeAssignments: [],
    })
    const otherCompany = planRoleRevocation({
      member: null,
      requestedRoleIds: ['role-a'],
      activeAssignments: [],
    })

    expect(codesOf(targetMissing.errors)).toEqual([RoleAssignmentErrorCode.CompanyUserNotFound])
    expect(otherCompany.errors).toEqual(targetMissing.errors)
  })

  test('沒有任何有效指派時只回「找不到可撤銷的指派」，不附加最後角色錯誤', () => {
    const plan = planRoleRevocation({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-a'],
      activeAssignments: [],
    })

    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.NotFound])
  })

  test('同一請求內重複的角色，第二筆回找不到可撤銷的指派', () => {
    const plan = planRoleRevocation({
      member: ACTIVE_MEMBER,
      requestedRoleIds: ['role-a', 'role-a'],
      activeAssignments: [assignment('role-a'), assignment('role-b')],
    })

    expect(codesOf(plan.errors)).toEqual([RoleAssignmentErrorCode.NotFound])
    expect(fieldsOf(plan.errors)).toEqual(['roleIds.1'])
    expect(plan.assignmentIdsToRevoke).toEqual(['assignment-role-a'])
  })
})
