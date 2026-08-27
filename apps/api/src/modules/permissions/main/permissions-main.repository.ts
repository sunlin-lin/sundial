/**
 * `permissions/main` 的資料存取入口（§0.4）。
 *
 * 每個動作一個函式、每個函式只有一行委派。**簽章寫在這裡而不是只做 re-export**：
 * 入口存在的目的是「打開它就知道這裡有哪些動作、各自收什麼、回什麼，一頁看完」，
 * 而 `export ... from` 看得到名字卻看不到形狀，那個目的只達成了一半。
 *
 * 依 §0.3，本檔**不得被本次目錄以外的任何檔案 import**：跨次目錄要資料一律走 service，
 * 否則本次目錄的規則（軟刪除、停用過濾）會被整組繞過。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { PermissionRow } from './domain/permission-tree.ts'
import { findPermissionsByIds as findPermissionsByIdsImpl } from './impl/permissions-main.find-by-ids.repository.ts'
import type { PermissionAssignability } from './impl/permissions-main.find-by-ids.repository.ts'
import { listPermissionTreeRows as listPermissionTreeRowsImpl } from './impl/permissions-main.list-tree.repository.ts'

export type { PermissionAssignability }

/**
 * 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別。
 *
 * `permissions` 是**全域表**（沒有 `company_id`，見 `db/schema/permissions.ts`），因此本模組
 * 用不到 §4.2 的公司範圍封裝，只讀不寫，寫成更窄的型別在這裡確實不會有壞處。
 * 仍然改成沿用正典型別，是因為三個模組各自宣告一份「自己剛好用得到什麼」的 runner 型別之後，
 * 讀的人得逐一比對才知道它們差在哪——而那個差異從來不是設計決策，只是各寫各的。
 */
export type { QueryRunner }

/** 取出組成權限樹所需的全部有效權限列（已排除軟刪除與停用）。 */
export const listPermissionTreeRows = (runner: QueryRunner): Promise<readonly PermissionRow[]> =>
  listPermissionTreeRowsImpl(runner)

/** 依 id 批次取出權限的可授權旗標與狀態；只排除軟刪除，停用者仍會回傳。 */
export const findPermissionsByIds = (
  runner: QueryRunner,
  permissionIds: readonly string[],
): Promise<ReadonlyMap<string, PermissionAssignability>> => findPermissionsByIdsImpl(runner, permissionIds)
