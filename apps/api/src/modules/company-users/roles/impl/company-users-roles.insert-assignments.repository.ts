/**
 * 資料存取動作：批次寫入角色指派。
 *
 * **一句 INSERT 寫入多列，不是在迴圈裡逐筆寫**（§4.5）：一次指派五個角色就是五次往返，
 * 而且它們必須是同一個原子動作——逐筆寫的話，中途失敗會留下「有一半角色」的成員，
 * 而 UI §2.4 的流程（帳號與角色一次建立、任一失敗整筆取消）從此不成立。
 *
 * 公司範圍走 §4.2 的封裝（`TenantDatabase.insertMany`）。這一支原本繞過封裝、自己把
 * `companyId` 填進每一列，理由是封裝的 `insert()` 一次只產生一列、表達不了批次寫入——
 * 而「表達不了」正是封裝該補的缺口，不是繞過它的理由：繞過之後，公司 ID 從「封裝內部唯一的來源」
 * 變成「一個可以被填成任何值的參數」，而寫錯的後果是一整批指派掛到別家公司的成員身上。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUserRoles } from '../../../../db/schema/index.ts'

export type NewAssignment = {
  readonly id: string
  readonly companyUserId: string
  readonly roleId: string
  /** 指派時刻，台北牆鐘時間；由注入的 clock 取得，禁止在這一層自己抓時間（§6.2）。 */
  readonly assignedAt: string
  /** 指派者的公司成員 id，來自已驗證的身分（§5.2「本人關係一律由 token 推導」）。 */
  readonly assignedBy: string
}

export const insertAssignments = (
  runner: QueryRunner,
  companyId: string,
  assignments: readonly NewAssignment[],
): Promise<void> =>
  // 空陣列由 `insertMany` 自己擋掉（`INSERT ... VALUES ()` 不是合法語句）。
  // 上層的 schema 已要求至少一個角色，那是防呆，不是這一層的判斷。
  new TenantDatabase(runner, companyId).insertMany(companyUserRoles, (scopedCompanyId) =>
    assignments.map((assignment) => ({
      id: assignment.id,
      companyId: scopedCompanyId,
      companyUserId: assignment.companyUserId,
      roleId: assignment.roleId,
      assignedAt: assignment.assignedAt,
      assignedBy: assignment.assignedBy,
      // 未撤銷的哨兵值。`revoked_at` 留 NULL，唯一性靠 `revoked_seq = 0` 這一組成立（§4.3）。
      revokedSeq: 0,
      createdAt: assignment.assignedAt,
      updatedAt: assignment.assignedAt,
    })),
  )
