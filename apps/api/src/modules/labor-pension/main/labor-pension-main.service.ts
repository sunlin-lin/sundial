/** 勞退自願提繳率設定的業務入口（§0.4）。 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { LaborPensionMainContext } from './domain/labor-pension-context.ts'
import type {
  CreateLaborPensionSettingInput,
  LaborPensionSettingDetail,
  LaborPensionSettingListPage,
  LaborPensionSettingListQuery,
} from './domain/labor-pension-model.ts'
import { createLaborPensionSettingInTransaction as createLaborPensionSettingInTransactionImpl } from './impl/labor-pension-main.create.service.ts'
import { listLaborPensionSettings as listLaborPensionSettingsImpl } from './impl/labor-pension-main.list.service.ts'

export type { LaborPensionMainContext }
export type {
  CreateLaborPensionSettingInput,
  LaborPensionSettingDetail,
  LaborPensionSettingListPage,
  LaborPensionSettingListQuery,
} from './domain/labor-pension-model.ts'

/** 新增勞退設定。自己開交易，給單一端點用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const createLaborPensionSetting = (
  context: LaborPensionMainContext,
  input: CreateLaborPensionSettingInput,
): Promise<ServiceResult<LaborPensionSettingDetail>> =>
  context.db.transaction((tx) => createLaborPensionSettingInTransactionImpl(tx, context, input))

/** 新增勞退設定。收外部交易 handle，給日後跨模組編排點用（形狀比照 `withholding` 的同名動作）。 */
export const createLaborPensionSettingInTransaction = (
  tx: TransactionRunner,
  context: LaborPensionMainContext,
  input: CreateLaborPensionSettingInput,
): Promise<ServiceResult<LaborPensionSettingDetail>> => createLaborPensionSettingInTransactionImpl(tx, context, input)

export const listLaborPensionSettings = (
  context: LaborPensionMainContext,
  query: LaborPensionSettingListQuery,
): Promise<ServiceResult<LaborPensionSettingListPage>> => listLaborPensionSettingsImpl(context, query)
