/**
 * 資料存取：新增職稱（一律新增公司自訂職稱，`is_system=false`，見 domain model 檔頭）。
 *
 * **唯一性由資料庫的唯一鍵擋，不做「先 SELECT 再 INSERT」**（§4.3），理由與
 * `departments-main.insert.repository.ts` 同構。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobTitles, type JobTitleStatusValue } from '../../../../db/schema/index.ts'
import { isDuplicateJobTitleCode, type JobTitleInsertOutcome } from '../domain/job-title-duplicate.ts'

export type NewJobTitle = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: JobTitleStatusValue
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const insertJobTitle = async (
  runner: QueryRunner,
  companyId: string,
  jobTitle: NewJobTitle,
): Promise<JobTitleInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(jobTitles, (scopedCompanyId) => ({
      id: jobTitle.id,
      companyId: scopedCompanyId,
      code: jobTitle.code,
      name: jobTitle.name,
      description: jobTitle.description,
      isSystem: false,
      status: jobTitle.status,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: jobTitle.now,
      updatedAt: jobTitle.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateJobTitleCode(error)) return 'duplicate-code'
    throw error
  }
}
