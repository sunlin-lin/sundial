/** 業務動作：查詢扣繳設定清單。查詢類端點沒有業務錯誤（§3.1.3）。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { WithholdingMainContext } from '../domain/withholding-context.ts'
import type { WithholdingSettingListPage, WithholdingSettingListQuery } from '../domain/withholding-model.ts'
import { listWithholdingSettingPage } from '../withholding-main.repository.ts'

export const listWithholdingSettings = async (
  context: WithholdingMainContext,
  query: WithholdingSettingListQuery,
): Promise<ServiceResult<WithholdingSettingListPage>> =>
  succeed(await listWithholdingSettingPage(context.db, context.companyId, query))
