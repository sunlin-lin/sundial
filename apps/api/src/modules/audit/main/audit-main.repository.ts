/**
 * 稽核紀錄的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體對資料庫做了哪些事
 * ——目前只有一件：新增一列。而且**永遠不會有 update 與 delete**（計畫 §3.4）：
 * 稽核紀錄一旦寫入就不得修改或刪除，這裡沒有那兩個動作，就沒有人能呼叫得到它們。
 *
 * 本檔（含 `impl/`）是本模組唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）——其他模組要寫稽核，一律走 `audit-main.service.ts` 的 `recordAudit`。
 */
import type { QueryRunner } from '../../../db/client.ts'
import {
  insertAuditLog as insertAuditLogImpl,
  type AuditActor,
  type NewAuditLog,
} from './impl/audit-main.insert.repository.ts'

export type { AuditActor, NewAuditLog }

/**
 * 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別（§4.2 的封裝要的就是這一組）。
 *
 * **刻意不另外宣告一份更窄的 `Pick<Database, 'insert'>`**：窄化擋的是「呼叫得到某個方法」，
 * 封裝擋的是「查詢漏掉公司條件」，而窄化過的 runner 交不給 `TenantDatabase`，
 * 於是切片只能退回裸 runner 自己在 `WHERE`／`VALUES` 裡手寫 `companyId`——正是封裝要堵的破口。
 *
 * **本層仍然只要求 `QueryRunner`**：`insertAuditLog` 只是單純寫一列，它不在乎呼叫端傳來的是
 * 連線池還是交易物件（那從來不是 repository 這一層該管的事）。「呼叫端傳進來的一定是交易」
 * 這件事由更上層的 `audit-main.service.ts`／`impl/audit-main.record.service.ts` 用
 * `TransactionRunner` 把關——`TransactionRunner` 是 `QueryRunner` 的子集合，因此那一層驗證過的
 * 交易 handle 一樣可以直接往下傳給這裡，不需要本層也重複收窄一次。
 */
export type { QueryRunner }

export const insertAuditLog = (runner: QueryRunner, companyId: string, log: NewAuditLog): Promise<void> =>
  insertAuditLogImpl(runner, companyId, log)
