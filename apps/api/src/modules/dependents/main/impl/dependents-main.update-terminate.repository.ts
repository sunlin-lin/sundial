/**
 * 資料存取：終止扶養——寫入 `end_date` 並把 `status` 改成 `TERMINATED`。
 *
 * **條件式 UPDATE ＋ 檢查影響列數**（§4.4），理由與 `employments-main.update-leave.repository.ts`
 * 同構：`WHERE` 帶上「預期的目前狀態」是 `status = ACTIVE`。兩個人同時對同一筆眷屬按終止，
 * 第二筆會影響 0 列——不是因為資料被改壞，是終止本來就不是可以重複執行的動作。
 */
import { eq, isNull } from 'drizzle-orm'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { DependentStatus, employeeDependents } from '../../../../db/schema/index.ts'

export type TerminateUpdate = {
  readonly endDate: string
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

/** @returns 影響列數。**0 代表在讀取與寫入之間已經有人終止（或刪除）了這筆眷屬**（§4.4）。 */
export const markDependentTerminated = async (
  runner: QueryRunner,
  companyId: string,
  dependentId: string,
  update: TerminateUpdate,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    employeeDependents,
    {
      endDate: update.endDate,
      status: DependentStatus.Terminated,
      updatedAt: update.now,
    },
    eq(employeeDependents.id, dependentId),
    // 預期目前狀態：仍在扶養中、未刪除。
    eq(employeeDependents.status, DependentStatus.Active),
    eq(employeeDependents.deletedSeq, 0),
    isNull(employeeDependents.deletedAt),
  )

  return readAffectedRows(result)
}
