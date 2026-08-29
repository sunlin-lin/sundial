/** 勞退自願提繳率設定的資料存取入口（§0.4）。 */
import type { QueryRunner } from '../../../db/client.ts'
import type { EffectivePeriod } from '../../../shared/effective-period.ts'
import type { LaborPensionSettingListPage, LaborPensionSettingListQuery } from './domain/labor-pension-model.ts'
import { findEmployeeForUpdate as findEmployeeForUpdateImpl } from './impl/labor-pension-main.find-employee-for-update.repository.ts'
import {
  insertLaborPensionSetting as insertLaborPensionSettingImpl,
  type NewLaborPensionSetting,
} from './impl/labor-pension-main.insert.repository.ts'
import { listLaborPensionPeriods as listLaborPensionPeriodsImpl } from './impl/labor-pension-main.list-periods.repository.ts'
import { listLaborPensionSettingPage as listLaborPensionSettingPageImpl } from './impl/labor-pension-main.list.repository.ts'
import type { LaborPensionSettingInsertOutcome } from './domain/labor-pension-duplicate.ts'

export type { NewLaborPensionSetting }
export type { QueryRunner }

export const findEmployeeForUpdate = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => findEmployeeForUpdateImpl(runner, companyId, employeeId)

export const listLaborPensionPeriods = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<readonly EffectivePeriod[]> => listLaborPensionPeriodsImpl(runner, companyId, employeeId)

export const insertLaborPensionSetting = (
  runner: QueryRunner,
  companyId: string,
  setting: NewLaborPensionSetting,
): Promise<LaborPensionSettingInsertOutcome> => insertLaborPensionSettingImpl(runner, companyId, setting)

export const listLaborPensionSettingPage = (
  runner: QueryRunner,
  companyId: string,
  query: LaborPensionSettingListQuery,
): Promise<LaborPensionSettingListPage> => listLaborPensionSettingPageImpl(runner, companyId, query)
