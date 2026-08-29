/**
 * 員工主檔的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體對資料庫做了哪些事、
 * 各自收什麼、回什麼，一頁看完；實作在 `impl/` 底下，一個動作一個檔。
 *
 * 這裡的「動作」是**資料存取動作，不是端點動作**（§0.4）：`findEmployeeDetail` 被 `get`、
 * `update`、`delete` 三支端點共用。以端點為單位切，同一段查詢就會被複製進好幾個切片
 * （改一處漏一處，而且不會有任何地方變紅），或者切片開始互相 import（§0.4 禁止）。
 *
 * 本檔（含 `impl/`）是本模組唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）——要資料一律走 service。
 *
 * **加解密器由參數傳入，不由本層自己建立**（§5.1）：金鑰來自環境變數，讓資料存取層自己去讀，
 * 測試就得為了跑一條測試去設環境變數，而「用錯金鑰」這條路徑也就永遠測不到。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { FieldCipher } from '../../../db/field-encryption.ts'
import type { EmployeeWriteOutcome } from './domain/employee-duplicate.ts'
import type {
  EmployeeDetail,
  EmployeeListPage,
  EmployeeListQuery,
  EmployeeProfileInput,
} from './domain/employee-model.ts'
import { findEmployeeAuditSnapshot as findEmployeeAuditSnapshotImpl } from './impl/employees-main.find-audit-snapshot.repository.ts'
import { findEmployeeDetail as findEmployeeDetailImpl } from './impl/employees-main.find.repository.ts'
import {
  insertEmployee as insertEmployeeImpl,
  type EmployeeInsertOutcome,
  type NewEmployee,
} from './impl/employees-main.insert.repository.ts'
import { listEmployeePage as listEmployeePageImpl } from './impl/employees-main.list.repository.ts'
import {
  markEmployeeDeleted as markEmployeeDeletedImpl,
  type EmployeeDeletion,
} from './impl/employees-main.mark-deleted.repository.ts'
import {
  updateEmployeeProfile as updateEmployeeProfileImpl,
  type EmployeeProfileUpdate,
} from './impl/employees-main.update-profile.repository.ts'

export type { EmployeeDeletion, EmployeeInsertOutcome, EmployeeProfileUpdate, EmployeeWriteOutcome, NewEmployee }

/**
 * 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別（§4.2 的封裝要的就是這一組）。
 *
 * **刻意不另外宣告一份更窄的 `Pick<Database, …>`**：窄化擋的是「呼叫得到某個方法」，
 * 封裝擋的是「查詢漏掉公司條件」，而窄化過的 runner 交不給 `TenantDatabase`，
 * 於是那些切片只能退回裸 runner 自己在 `WHERE` 裡手寫 `companyId`——正是封裝要堵的破口。
 */
export type { QueryRunner }

export const listEmployeePage = (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  today: string,
  query: EmployeeListQuery,
): Promise<EmployeeListPage> => listEmployeePageImpl(runner, cipher, companyId, today, query)

export const findEmployeeDetail = (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  employeeId: string,
): Promise<EmployeeDetail | null> => findEmployeeDetailImpl(runner, cipher, companyId, employeeId)

/** 稽核用明文快照（稽核計畫 §4.4）。**只給 `buildAuditChanges` 用**，見 impl 切片檔頭。 */
export const findEmployeeAuditSnapshot = (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  employeeId: string,
): Promise<EmployeeProfileInput | null> => findEmployeeAuditSnapshotImpl(runner, cipher, companyId, employeeId)

export const insertEmployee = (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  employee: NewEmployee,
): Promise<EmployeeInsertOutcome> => insertEmployeeImpl(runner, cipher, companyId, employee)

export const updateEmployeeProfile = (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  employeeId: string,
  update: EmployeeProfileUpdate,
): Promise<EmployeeWriteOutcome> => updateEmployeeProfileImpl(runner, cipher, companyId, employeeId, update)

export const markEmployeeDeleted = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  deletion: EmployeeDeletion,
): Promise<number> => markEmployeeDeletedImpl(runner, companyId, employeeId, deletion)
