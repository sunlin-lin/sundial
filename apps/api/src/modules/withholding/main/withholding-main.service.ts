/** 扣繳設定的業務入口（§0.4）。 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { WithholdingMainContext } from './domain/withholding-context.ts'
import type {
  CreateWithholdingSettingInput,
  WithholdingSettingDetail,
  WithholdingSettingListPage,
  WithholdingSettingListQuery,
} from './domain/withholding-model.ts'
import { createWithholdingSetting as createWithholdingSettingImpl } from './impl/withholding-main.create.service.ts'
import { listWithholdingSettings as listWithholdingSettingsImpl } from './impl/withholding-main.list.service.ts'

export type { WithholdingMainContext }
export type {
  CreateWithholdingSettingInput,
  WithholdingSettingDetail,
  WithholdingSettingListPage,
  WithholdingSettingListQuery,
} from './domain/withholding-model.ts'

export const createWithholdingSetting = (
  context: WithholdingMainContext,
  input: CreateWithholdingSettingInput,
): Promise<ServiceResult<WithholdingSettingDetail>> => createWithholdingSettingImpl(context, input)

export const listWithholdingSettings = (
  context: WithholdingMainContext,
  query: WithholdingSettingListQuery,
): Promise<ServiceResult<WithholdingSettingListPage>> => listWithholdingSettingsImpl(context, query)
