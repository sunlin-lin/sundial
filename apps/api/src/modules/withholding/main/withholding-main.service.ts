/** 扣繳設定的業務入口（§0.4）。 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { WithholdingMainContext } from './domain/withholding-context.ts'
import type {
  CreateWithholdingSettingInput,
  WithholdingSettingDetail,
  WithholdingSettingListPage,
  WithholdingSettingListQuery,
} from './domain/withholding-model.ts'
import { createWithholdingSettingInTransaction as createWithholdingSettingInTransactionImpl } from './impl/withholding-main.create.service.ts'
import { listWithholdingSettings as listWithholdingSettingsImpl } from './impl/withholding-main.list.service.ts'

export type { WithholdingMainContext }
export type {
  CreateWithholdingSettingInput,
  WithholdingSettingDetail,
  WithholdingSettingListPage,
  WithholdingSettingListQuery,
} from './domain/withholding-model.ts'

/** 新增扣繳設定。自己開交易，給單一端點用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const createWithholdingSetting = (
  context: WithholdingMainContext,
  input: CreateWithholdingSettingInput,
): Promise<ServiceResult<WithholdingSettingDetail>> =>
  context.db.transaction((tx) => createWithholdingSettingInTransactionImpl(tx, context, input))

/** 新增扣繳設定。收外部交易 handle，給 Stage 4 編排點用（計畫 §4.1）。 */
export const createWithholdingSettingInTransaction = (
  tx: TransactionRunner,
  context: WithholdingMainContext,
  input: CreateWithholdingSettingInput,
): Promise<ServiceResult<WithholdingSettingDetail>> => createWithholdingSettingInTransactionImpl(tx, context, input)

export const listWithholdingSettings = (
  context: WithholdingMainContext,
  query: WithholdingSettingListQuery,
): Promise<ServiceResult<WithholdingSettingListPage>> => listWithholdingSettingsImpl(context, query)
