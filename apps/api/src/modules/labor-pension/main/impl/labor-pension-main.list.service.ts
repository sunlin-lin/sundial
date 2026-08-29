/** 業務動作：查詢勞退設定清單。查詢類端點沒有業務錯誤（§3.1.3）。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { LaborPensionMainContext } from '../domain/labor-pension-context.ts'
import type { LaborPensionSettingListPage, LaborPensionSettingListQuery } from '../domain/labor-pension-model.ts'
import { listLaborPensionSettingPage } from '../labor-pension-main.repository.ts'

export const listLaborPensionSettings = async (
  context: LaborPensionMainContext,
  query: LaborPensionSettingListQuery,
): Promise<ServiceResult<LaborPensionSettingListPage>> =>
  succeed(await listLaborPensionSettingPage(context.db, context.companyId, query))
