/**
 * 資料存取：更新職稱主檔的基本欄位（含狀態）。
 *
 * **走 `TenantDatabase` 的標準 scope，不是 `selectFrom`**：與 `find`／`list` 兩支刻意相反——
 * 寫入動作只能碰這家公司自訂的職稱，`eq(companyId, 本公司)` 天生摸不到系統預設列
 * （`company_id IS NULL`），公司因此不能修改系統預設，這是刻意的不對稱（見 domain model 檔頭）。
 *
 * **不檢查影響列數**：理由與 `departments-main.update-profile.repository.ts` 同構——欄位皆為
 * 明文，使用者按儲存卻沒改到任何欄位時 `affectedRows` 會是 0，拿它當併發衝突依據會誤報。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobTitles, type JobTitleStatusValue } from '../../../../db/schema/index.ts'
import { isDuplicateJobTitleCode } from '../domain/job-title-duplicate.ts'

export type JobTitleProfileUpdate = {
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: JobTitleStatusValue
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export type JobTitleProfileUpdateOutcome = 'written' | 'duplicate-code'

export const updateJobTitleProfile = async (
  runner: QueryRunner,
  companyId: string,
  jobTitleId: string,
  update: JobTitleProfileUpdate,
): Promise<JobTitleProfileUpdateOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.update(
      jobTitles,
      {
        code: update.code,
        name: update.name,
        description: update.description,
        status: update.status,
        updatedAt: update.now,
      },
      eq(jobTitles.id, jobTitleId),
      eq(jobTitles.deletedSeq, 0),
      isNull(jobTitles.deletedAt),
    )

    return 'written'
  } catch (error) {
    if (isDuplicateJobTitleCode(error)) return 'duplicate-code'
    throw error
  }
}
