/**
 * 公司帳號成員關係的業務入口（§0.4）。
 *
 * 目前只有一支**沒有端點的業務動作**（§0.4 明文允許）：{@link deactivateCompanyUser}，
 * 供離職流程呼叫。本次目錄暫時沒有 `routes.ts`／`handler.ts`／`errors.ts`——理由與
 * `modules/audit/main/` 相同（沒有業務錯誤可以收集、也沒有對外端點），見該模組的
 * `audit-main.service.ts` 檔頭。
 */
import { deactivateCompanyUser as deactivateCompanyUserImpl } from './impl/company-users-main.deactivate.service.ts'
import type { CompanyUserDeactivation } from './impl/company-users-main.deactivate.service.ts'
import type { QueryRunner } from '../../../db/client.ts'

export type { CompanyUserDeactivation }

export const deactivateCompanyUser = (
  tx: QueryRunner,
  companyId: string,
  employeeId: string,
  now: string,
): Promise<CompanyUserDeactivation> => deactivateCompanyUserImpl(tx, companyId, employeeId, now)
