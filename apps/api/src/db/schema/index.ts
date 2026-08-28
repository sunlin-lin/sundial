/**
 * schema 的匯總出口。drizzle-kit 由本檔讀取全部資料表定義（見 `drizzle.config.ts`）。
 */
export {
  companies,
  CompanyType,
  type CompanyTypeValue,
  CompanyLegalType,
  type CompanyLegalTypeValue,
  CompanyStatus,
  type CompanyStatusValue,
} from './companies.ts'
export { users } from './users.ts'
export { companyUsers, CompanyUserStatus, type CompanyUserStatusValue } from './company-users.ts'
export { roles, RoleStatus, type RoleStatusValue } from './roles.ts'
export { permissions, PermissionStatus, type PermissionStatusValue } from './permissions.ts'
export { rolePermissions } from './role-permissions.ts'
export { companyUserRoles } from './company-user-roles.ts'
export { employees, Gender, type GenderValue } from './employees.ts'
export {
  refreshTokens,
  RefreshTokenRevokeReason,
  type RefreshTokenRevokeReasonValue,
  TOKEN_HASH_BYTE_LENGTH,
} from './refresh-tokens.ts'
export { auditLogs, AuditActorType, type AuditActorTypeValue } from './audit-logs.ts'
export {
  regulatoryDatasetVersions,
  RegulatoryRawFormat,
  type RegulatoryRawFormatValue,
} from './regulatory-dataset-versions.ts'
export { regulatoryRecords } from './regulatory-records.ts'
export {
  regulatorySyncLogs,
  RegulatorySyncTriggerType,
  type RegulatorySyncTriggerTypeValue,
  RegulatorySyncStatus,
  type RegulatorySyncStatusValue,
} from './regulatory-sync-logs.ts'

import { auditLogs } from './audit-logs.ts'
import { companyUserRoles } from './company-user-roles.ts'
import { companyUsers } from './company-users.ts'
import { employees } from './employees.ts'
import { refreshTokens } from './refresh-tokens.ts'
import { rolePermissions } from './role-permissions.ts'
import { roles } from './roles.ts'

/**
 * 帶公司範圍的資料表。`TenantDatabase`（`db/client.ts`）只接受這個聯集，
 * 於是「對一張帶 company_id 的表做不帶公司條件的查詢」在型別上就寫不出來。
 *
 * **刻意列舉而不是用結構型別（「任何有 companyId 欄位的表」）**：列舉讓「新增一張帶公司範圍的表」
 * 變成一個必須動到本檔的、看得見的步驟；結構型別則會讓新表自動被納入，
 * 而少數**不該**被納入的表（全域表 `users`、`permissions`）與該納入的表在型別上無從區分。
 *
 * **`companies` 刻意不在此列。** 它是 Tenant 根節點，`id` 就是公司範圍本身、沒有 `company_id` 欄位，
 * 交給 `TenantDatabase` 會變成「用 company_id 過濾 company_id 表」這種說不通的形狀。
 * 公司主檔的讀寫屬於 §4.2 所說的跨公司平台管理功能，走獨立且明確命名的路徑，不套用租戶封裝。
 */
export type CompanyScopedTable =
  | typeof roles
  | typeof rolePermissions
  | typeof companyUsers
  | typeof companyUserRoles
  | typeof employees
  | typeof refreshTokens
  /**
   * `audit_logs` 有 `company_id`，因此屬於這個聯集（計畫 §3.6）。
   *
   * 它進來的理由與其他表完全一樣，但**後果特別嚴重，所以單獨寫在這裡**：稽核查詢的形狀是
   * 「這家公司最近有哪些異動」「這個人做過什麼」，一次漏帶公司條件就是把別家公司的
   * 異動明細（含 `changes` 裡的前後值）整批攤出來——而查詢會「有回資料」，不會有任何錯誤。
   * 加進聯集之後，那種查詢在 `TenantDatabase` 上就寫不出來，不必靠每個呼叫端記得。
   *
   * 這一步是刻意要求動到本檔的（見上方「刻意列舉」）：新增一張帶公司範圍的表就得改這裡，
   * 而不是靠結構型別自動納入。
   */
  | typeof auditLogs
/*
 * **法規三表（`regulatory_dataset_versions`、`regulatory_records`、`regulatory_sync_logs`）
 * 刻意不在這個聯集裡，這不是漏加**（實作計畫 `plans/01-regulatory-dataset-versioning.md` §3.2 (b)）。
 *
 * 三張表都**沒有 `company_id` 欄位**：它們存的是勞保、健保、勞退、職災的費率與分級表，
 * 那是全國法定值，全平台共用同一份。硬把它們納進來會變成「用 company_id 過濾一張沒有 company_id
 * 的表」，型別上就寫不出來——與 `companies` 不在此列是同一類理由（見上方段落）。
 *
 * 它們走的是**裸 db client** 那條路（§4.2），和 `users`、`permissions` 同一類。
 *
 * 這段話寫在這裡，是因為這裡才是下一個人會誤判的位置：他會看到「新增一張表就要改 index.ts」
 * 這條規則，然後發現法規三表沒被列進來，第一個念頭是補上去。補上去的後果不是錯誤而是**改不動**
 * ——`TenantDatabase` 會要求每一支法規查詢都帶公司條件，而那個條件在資料上根本不存在。
 *
 * 公司層真正的「選擇」（這家公司用哪一個職災行業別）在 `company_regulatory_settings`，
 * 那張表有 `company_id`，屆時要加進上面的聯集；本輪不做那張表。
 */
