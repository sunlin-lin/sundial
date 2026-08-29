/**
 * 職務主檔的業務型別。形狀與 `job-titles/main/domain/job-title-model.ts` 完全同構
 * ——職稱與職務除了表名與外鍵目標不同外，主檔本身的欄位與規則逐字相同（皆有系統預設）。
 */
export type { JobPositionStatusValue } from '../../../../db/schema/index.ts'

import type { JobPositionStatusValue } from '../../../../db/schema/index.ts'

export type JobPositionDetail = {
  readonly id: string
  readonly isSystem: boolean
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: JobPositionStatusValue
  readonly createdAt: string
  readonly updatedAt: string
}

export type JobPositionListPage = {
  readonly items: readonly JobPositionDetail[]
  readonly totalCount: number
}

export type JobPositionListQuery = {
  readonly keyword: string | null
  readonly perPage: number
  readonly currentPage: number
}

/** 新增職務。沒有 `status`／`companyId`／`isSystem`，理由與 `CreateJobTitleInput` 同構。 */
export type CreateJobPositionInput = {
  readonly code: string
  readonly name: string
  readonly description: string | null
}

export type UpdateJobPositionInput = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: JobPositionStatusValue
}

export type JobPositionTargetInput = {
  readonly id: string
}

export type DeletedJobPosition = {
  readonly id: string
}
