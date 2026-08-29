/** 業務動作：查詢一位員工的眷屬清單。查詢類端點沒有業務錯誤（§3.1.3）。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { DependentsMainContext } from '../domain/dependent-context.ts'
import type { DependentListPage, DependentListQuery } from '../domain/dependent-model.ts'
import { listDependentPage } from '../dependents-main.repository.ts'

export const listDependents = async (
  context: DependentsMainContext,
  query: DependentListQuery,
): Promise<ServiceResult<DependentListPage>> =>
  succeed(await listDependentPage(context.db, context.cipher, context.companyId, query))
