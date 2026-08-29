/** 扣繳設定的資料存取入口（§0.4）。 */
import type { QueryRunner } from '../../../db/client.ts'
import type { EffectivePeriod } from '../../../shared/effective-period.ts'
import type { WithholdingSettingListPage, WithholdingSettingListQuery } from './domain/withholding-model.ts'
import { findEmployeeForUpdate as findEmployeeForUpdateImpl } from './impl/withholding-main.find-employee-for-update.repository.ts'
import {
  insertWithholdingSetting as insertWithholdingSettingImpl,
  type NewWithholdingSetting,
} from './impl/withholding-main.insert.repository.ts'
import { listWithholdingPeriods as listWithholdingPeriodsImpl } from './impl/withholding-main.list-periods.repository.ts'
import { listWithholdingSettingPage as listWithholdingSettingPageImpl } from './impl/withholding-main.list.repository.ts'
import type { WithholdingSettingInsertOutcome } from './domain/withholding-duplicate.ts'

export type { NewWithholdingSetting }
export type { QueryRunner }

export const findEmployeeForUpdate = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => findEmployeeForUpdateImpl(runner, companyId, employeeId)

export const listWithholdingPeriods = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<readonly EffectivePeriod[]> => listWithholdingPeriodsImpl(runner, companyId, employeeId)

export const insertWithholdingSetting = (
  runner: QueryRunner,
  companyId: string,
  setting: NewWithholdingSetting,
): Promise<WithholdingSettingInsertOutcome> => insertWithholdingSettingImpl(runner, companyId, setting)

export const listWithholdingSettingPage = (
  runner: QueryRunner,
  companyId: string,
  query: WithholdingSettingListQuery,
): Promise<WithholdingSettingListPage> => listWithholdingSettingPageImpl(runner, companyId, query)
