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
export { shiftDefinitions, ShiftWorkType, type ShiftWorkTypeValue } from './shift-definitions.ts'
export { shiftWorkPeriods } from './shift-work-periods.ts'
export { shiftBreaks } from './shift-breaks.ts'
export { departments, DepartmentStatus, type DepartmentStatusValue } from './departments.ts'
export {
  employeeEmployments,
  EmploymentStatus,
  type EmploymentStatusValue,
  EmploymentTypeCode,
  type EmploymentTypeCodeValue,
} from './employee-employments.ts'
export { employeeDepartmentHistories } from './employee-department-histories.ts'
export {
  employeeWithholdingSettings,
  WithholdingMethodCode,
  type WithholdingMethodCodeValue,
} from './employee-withholding-settings.ts'
export { jobTitles, JobTitleStatus, type JobTitleStatusValue } from './job-titles.ts'
export { jobPositions, JobPositionStatus, type JobPositionStatusValue } from './job-positions.ts'
export { employeeJobTitleHistories } from './employee-job-title-histories.ts'
export { employeeJobPositionHistories } from './employee-job-position-histories.ts'
export {
  employeeDependents,
  DependentStatus,
  type DependentStatusValue,
  DependentRelationshipCode,
  type DependentRelationshipCodeValue,
} from './employee-dependents.ts'
export { employeeLaborPensionSettings } from './employee-labor-pension-settings.ts'
export { attendanceSettings } from './attendance-settings.ts'

import { attendanceSettings } from './attendance-settings.ts'
import { auditLogs } from './audit-logs.ts'
import { companyUserRoles } from './company-user-roles.ts'
import { companyUsers } from './company-users.ts'
import { departments } from './departments.ts'
import { employeeDepartmentHistories } from './employee-department-histories.ts'
import { employeeEmployments } from './employee-employments.ts'
import { employeeJobPositionHistories } from './employee-job-position-histories.ts'
import { employeeJobTitleHistories } from './employee-job-title-histories.ts'
import { employeeWithholdingSettings } from './employee-withholding-settings.ts'
import { employeeDependents } from './employee-dependents.ts'
import { employeeLaborPensionSettings } from './employee-labor-pension-settings.ts'
import { employees } from './employees.ts'
import { jobPositions } from './job-positions.ts'
import { jobTitles } from './job-titles.ts'
import { refreshTokens } from './refresh-tokens.ts'
import { rolePermissions } from './role-permissions.ts'
import { roles } from './roles.ts'
import { shiftDefinitions } from './shift-definitions.ts'

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
  /**
   * `shift_definitions` 有 `company_id`，因此屬於這個聯集（實作計畫 `plans/04-shift-definitions.md` §5.1）。
   *
   * **`shift_work_periods` 與 `shift_breaks` 刻意不在這裡，這不是漏加。** 兩張表都沒有
   * `company_id` 欄位——公司範圍由 `shift_definition_id` 間接決定，硬把它們納進來會變成
   * 「用 company_id 過濾一張沒有 company_id 的表」，型別上就寫不出來，與法規三表不進本聯集
   * 是同一類理由（見下方法規三表的段落）。這兩張子表只能經由 `shift_definitions` 的 service
   * 存取，不單獨開端點，因此也不需要 `TenantDatabase` 替它們強制公司條件。
   */
  | typeof shiftDefinitions
  /**
   * `departments` 有 `company_id`，因此屬於這個聯集（實作計畫 `plans/05-employee-onboarding.md` §5）。
   *
   * **加入的位置很重要，這裡先說清楚為什麼放在 `employees` 附近，而不是照字母或建立順序排。**
   * 這張表日後會被 `employee_department_histories`（複合外鍵 `(company_id, employment_id) →
   * employee_employments(company_id, id)` 之類，那條線尚未動工）參照，屆時 `departments` 必須
   * 排在 `employee_department_histories` 之後、且晚於 `employees`／`employee_employments` 被清空
   * ——但那張表現在還不存在，這裡沒有東西可以「排在它之前」。**現階段放在 `employees` 附近即可
   * （見下方陣列），日後那張表出現時，第一件要做的事就是回來重排這裡的順序**，不是把新表加進來
   * 就當作完工：先前 `shift_definitions` 那次事故就是因為「加進聯集」與「想清楚放哪裡」被當成
   * 同一步做完了，結果順序判斷被省略、直到跑 seed 撞見外鍵錯誤才發現漏了東西。
   *
   * 自我參照的 `fk_departments_parent`（`db/schema/departments.ts`）不影響這裡的排序考量：
   * 那條外鍵是 `ON DELETE CASCADE`（該檔已詳述理由），同一張表內的父子順序由資料庫自己處理，
   * 這裡的順序只需要管「哪些其他表參照了 `departments`」。
   */
  | typeof departments
  /**
   * `employee_employments`／`employee_department_histories`／`employee_withholding_settings`
   * 三張都有 `company_id`，因此屬於這個聯集（實作計畫 `plans/05-employee-onboarding.md` Stage 3）。
   * **三張表字典本身都沒有 `company_id` 欄位**，這裡新增的理由與加入的方式完全同構，寫在各自的
   * `db/schema/employee-*.ts` 檔頭第 1 點，這裡不重複。
   *
   * **排序（見下方陣列）：`employeeDepartmentHistories`／`employeeWithholdingSettings` 必須排在
   * `employeeEmployments` 之前，`employeeEmployments` 必須排在 `employees` 之前**——三張表都以
   * 複合外鍵指向被參照端，`companyScopedTablesInDeleteOrder` 清理整間公司時，子表必須先於父表被
   * 清空，否則撞外鍵違反（`departments`／`shift_definitions` 那次事故的同一個成因，見下方陣列的
   * 註解）。`employeeDepartmentHistories` 另外參照 `departments`，因此也必須排在它之前。
   */
  | typeof employeeEmployments
  | typeof employeeDepartmentHistories
  | typeof employeeWithholdingSettings
  /**
   * `job_titles`／`job_positions`／`employee_job_title_histories`／`employee_job_position_histories`
   * 四張都有 `company_id`，因此屬於這個聯集（實作計畫 `plans/05-employee-onboarding.md` Stage 5）。
   *
   * **`job_titles`／`job_positions` 的 `company_id` 可為 NULL**（系統預設，見兩檔的 schema 檔頭），
   * 這件事不影響它們屬於本聯集——`TenantDatabase` 的過濾條件 `eq(companyId, 本公司)` 對
   * `company_id IS NULL` 的列天生不會命中，效果剛好是「公司範圍內的寫入動作（新增／修改／刪除）
   * 摸不到系統預設列」，這正是我們要的行為，不是缺陷。查詢「公司自訂 ＋ 系統預設」需要繞過
   * `TenantDatabase` 的預設 scope，見兩個 `main` 模組的 `list.repository.ts`。
   *
   * **排序（見下方陣列）：兩張歷史表必須排在 `employeeEmployments` 之前**（複合外鍵指向它），
   * `employeeJobTitleHistories`／`employeeJobPositionHistories` 對 `jobTitles`／`jobPositions`
   * 則是**單欄外鍵**（`job_titles.company_id`／`job_positions.company_id` 可為 NULL，複合外鍵在
   * 系統預設列上恆不匹配，見兩張歷史表的 schema 檔頭第 2 點），因此兩張歷史表與
   * `jobTitles`／`jobPositions` 之間**沒有「先清哪一個」的外鍵順序要求**——單欄外鍵只保證
   * 「id 存在」，`companyScopedTablesInDeleteOrder` 逐表刪除時,`job_titles`／`job_positions`
   * 若先被清空，歷史表裡指向它們的 `job_title_id`／`job_position_id` 會變成指向不存在的 id，
   * 但那不會撞外鍵違反（單欄外鍵只在**新增**時檢查，`DELETE` 不會反向檢查子表）。實務上仍然把
   * 兩張歷史表排在 `jobTitles`／`jobPositions` 之前，與其餘「歷史表先於主檔」的排列習慣一致，
   * 方便閱讀，不是因為外鍵要求。
   */
  | typeof jobTitles
  | typeof jobPositions
  | typeof employeeJobTitleHistories
  | typeof employeeJobPositionHistories
  /**
   * `employee_dependents`／`employee_labor_pension_settings` 都有 `company_id`，因此屬於這個聯集
   * （實作計畫 `plans/05-employee-onboarding.md` §3.3、§8 Stage 7）。**兩張表字典本身都沒有
   * `company_id` 欄位**，新增理由與加入方式與其餘 `employee_*` 系列表同構，寫在各自的
   * `db/schema/employee-*.ts` 檔頭第 1 點，這裡不重複。
   *
   * **排序（見下方陣列）：兩張都只以複合外鍵指向 `employees`（`employee_labor_pension_settings`
   * 另外指向 `company_users`，見該檔），因此都必須排在 `employees` 之前**——與
   * `employeeWithholdingSettings` 是同一種依賴形狀，放在它旁邊即可，彼此之間互不依賴。
   */
  | typeof employeeDependents
  | typeof employeeLaborPensionSettings
  /**
   * `attendance_settings` 有 `company_id`，因此屬於這個聯集（實作計畫 `plans/06-attendance.md`
   * §5 Stage 2）。**這張表沒有任何其他表以外鍵指向它**（本階段只做這一張表，出勤層其餘四張表
   * 尚未動工），因此排序上與 `employees`／`shiftDefinitions`／`departments` 同一類：只以外鍵
   * 指向 `companies`，放在依賴鏈中段即可（見下方陣列）。
   */
  | typeof attendanceSettings

/**
 * 對「窮舉一個聯集的所有成員」做編譯期檢查的小工具，供下方 {@link companyScopedTablesInDeleteOrder} 使用。
 *
 * **為什麼不能只用 `satisfies readonly CompanyScopedTable[]`。** 那只能擋住一個方向——陣列裡
 * 混進一張不屬於聯集的表，元素型別對不上會編譯錯誤。但它擋不住另一個方向：聯集新增了一張表、
 * 陣列忘了加，`satisfies` 完全看不出來，因為「聯集的子集」本來就永遠滿足 `satisfies` 的檢查。
 * 而**這次事故正是那個方向**——`shift_definitions` 加進了 `CompanyScopedTable`，`seed-dev.ts`
 * 的清理清單沒有人記得同步改，且沒有任何地方變紅，要等到跑 seed 撞見外鍵錯誤才發現。
 *
 * 這裡改用一個 curry 過的泛型把兩個方向一起釘住：先呼叫一次固定「要窮舉的聯集是誰」
 * （`exhaustiveCompanyScopedTables<CompanyScopedTable>()`），再把陣列字面量傳進第二次呼叫。
 *
 * **條件型別兩側都刻意包一層 tuple（`[TUnion] extends [TArray[number]]`），不是隨手加的括號。**
 * 條件型別預設是分配式的：`TUnion extends TArray[number] ? TArray : never` 會把 `TUnion` 拆成
 * 一個個成員分別檢查，再把每個成員的檢查結果**聯集**起來——而聯集會吃掉 `never`
 * （`TArray | never` 化簡為 `TArray`）。後果是只要陣列裡有任何一張表通過檢查，
 * 少掉的那幾張表各自產出的 `never` 就會在聯集中直接消失，整個型別依然是 `TArray`，
 * 檢查形同虛設——這是實作時第一版踩到的坑，`bun run typecheck` 在少了一張表時完全沒有變紅。
 * 包一層 tuple 可以關掉分配式行為，讓 TS 把 `TUnion` 當成一個整體去比對「是不是
 * `TArray[number]` 的子集合」，這樣才真的是「聯集裡每一個成員都必須出現在陣列裡」。
 */
const exhaustiveCompanyScopedTables =
  <TUnion>() =>
  <TArray extends readonly TUnion[]>(tables: [TUnion] extends [TArray[number]] ? TArray : never): TArray =>
    tables

/**
 * `CompanyScopedTable` 的執行期版本，`apps/api/scripts/seed-dev.ts` 清理上一輪種子資料時要用來
 * 逐張表清空——型別聯集在執行期完全不存在，for 迴圈走不過去，必須另外有一份實際的陣列可以疊代。
 *
 * **這份陣列與上面的型別聯集綁在一起，不是另一份手抄清單**：漏一張、或多一張不屬於聯集的表，
 * 都會在 `exhaustiveCompanyScopedTables` 那一行編譯不過（見上方說明），因此不會出現「兩邊各自
 * 增修、各自漂移」的情況——這正是本檔要修的那個問題本身。
 *
 * **順序是子表先、父表後，這件事沒辦法從型別推導出來——型別只管「有沒有漏表」，
 * 不管「先刪哪一張」，所以這份陣列本身是有序的，且順序由外鍵決定：**
 *
 *   - `auditLogs`／`companyUserRoles`／`refreshTokens` 都以複合外鍵指向 `companyUsers`
 *     （欄位分別是 `actor_company_user_id`、`company_user_id`、`assigned_by`/`revoked_by`、
 *     `company_user_id`），必須先於 `companyUsers` 清掉。
 *   - `companyUserRoles`／`rolePermissions` 都以複合外鍵指向 `roles`，必須先於 `roles` 清掉。
 *   - `employees`／`shiftDefinitions`／`departments` 只以外鍵指向 `companies`（`companies` 不在
 *     本聯集之列，由呼叫端另外處理），與本清單內其他表互不依賴，放在依賴鏈中段即可。
 *     `departments` 的自我參照外鍵是 `ON DELETE CASCADE`（見 `db/schema/departments.ts`），
 *     同一張表內的父子刪除順序由資料庫自己處理，不影響它在本陣列裡的位置。
 *   - `companyUsers`／`roles` 被上面數張表參照，必須放在最後。
 *
 * **加新表時想清楚放哪裡**：把新表放進去只解決「編譯過不過」，不會告訴你它該排第幾個——
 * 那要靠讀新表的外鍵去判斷它依賴誰、被誰依賴，比照上面的分組邏輯插進正確的位置。
 * `departments` 現在放在 `employees` 之後即可（見上方型別聯集的註解：日後
 * `employee_department_histories` 出現時要回來重排，`departments` 屆時必須排在它之後）。
 *
 * **`audit_logs` 雖是 append-only 的稽核紀錄，這裡仍然清空，不是例外。** `seed-dev.ts` 刪的是
 * 整間 demo 公司，`audit_logs.company_id` 對 `companies.id` 有外鍵（`fk_audit_logs_company`）；
 * 公司都不在了，稽核紀錄留著只會指向一個不存在的公司——那不是「保留歷史」，是孤兒列。
 * 而且不清的話，刪 `companies` 那一步會被同一種外鍵錯誤擋下，與這次 `shift_definitions`
 * 是同一個症狀、同一個成因（漏清子表），只是換了一張表發作。
 */
export const companyScopedTablesInDeleteOrder = exhaustiveCompanyScopedTables<CompanyScopedTable>()([
  auditLogs,
  companyUserRoles,
  rolePermissions,
  refreshTokens,
  // 三張新表必須排在 employees（也早於 departments、employeeEmployments）之前：見上方型別聯集的
  // 排序註解。employeeDepartmentHistories 同時參照 employeeEmployments 與 departments，因此必須
  // 排在兩者之前；employeeWithholdingSettings 與 employeeEmployments 都只參照 employees，因此都
  // 必須排在 employees 之前，兩者之間互不依賴（順序無關）。
  // 兩張新歷史表排在 employeeEmployments 之前（複合外鍵指向它，理由與 employeeDepartmentHistories
  // 相同）；對 jobTitles／jobPositions 只是單欄外鍵，順序考量見上方型別聯集的說明。
  employeeJobTitleHistories,
  employeeJobPositionHistories,
  employeeDepartmentHistories,
  employeeWithholdingSettings,
  // 兩張新表（Stage 7）與 employeeWithholdingSettings 是同一種依賴形狀：都只指向 employees
  // （employeeLaborPensionSettings 另外指向 companyUsers，但 companyUsers 排在本陣列最後，
  // 子表先於父表清空不受影響），因此排在 employees 之前即可，彼此之間與 employeeWithholdingSettings
  // 之間都互不依賴（順序無關）。
  employeeDependents,
  employeeLaborPensionSettings,
  employeeEmployments,
  employees,
  shiftDefinitions,
  departments,
  // 出勤設定：只以外鍵指向 companies，沒有其他表指向它，放在同一類的最後（順序無關）。
  attendanceSettings,
  jobTitles,
  jobPositions,
  companyUsers,
  roles,
] as const)

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
