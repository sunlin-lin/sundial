/**
 * 資料存取：軟刪除職稱。
 *
 * 走 `TenantDatabase` 標準 scope（天生摸不到系統預設列，見 `update-profile` 切片檔頭）。
 * **檢查影響列數**：刪除是保證會變更的狀態轉移，理由與 `departments-main.mark-deleted.
 * repository.ts` 同構。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { jobTitles } from '../../../../db/schema/index.ts'

export type JobTitleDeletion = {
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
  /** 軟刪除後寫進 `deleted_seq` 的非零值（§4.3）。由呼叫端傳入，理由與 `departments` 同構。 */
  readonly deletedSeq: number
}

export const markJobTitleDeleted = async (
  runner: QueryRunner,
  companyId: string,
  jobTitleId: string,
  deletion: JobTitleDeletion,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    jobTitles,
    { deletedAt: deletion.now, deletedSeq: deletion.deletedSeq, updatedAt: deletion.now },
    eq(jobTitles.id, jobTitleId),
    eq(jobTitles.deletedSeq, 0),
    isNull(jobTitles.deletedAt),
  )

  return readAffectedRows(result)
}
