/**
 * 稽核紀錄的業務入口（§0.4）。
 *
 * **這是其他模組唯一碰得到的東西**（透過 `modules/audit/index.ts`）：一支寫入、一支產生逐欄差異。
 *
 * ## 為什麼是入口，而不是「內部函式」
 *
 * `recordAudit` 是**沒有端點的業務動作**，§0.4 已經涵蓋這種情形：它一樣放入口檔，
 * 因為它同樣是這個次實體對外的介面，只是呼叫者不是前端而是其他模組（也包括排程與憑證驗證器）。
 *
 * ## 本模組沒有 `routes.ts`、`handler.ts`、`errors.ts`
 *
 * 三者都不是漏掉（計畫 §6）：
 *
 * - 本輪不開任何端點，所以沒有 routes 與 handler。稽核查詢端點要等有明確使用場景才開，
 *   而且已定案「稽核歸稽核，不與歷史表整合查詢」。
 * - 稽核寫入不是使用者發起的動作，**沒有業務錯誤可以收集**（§3.1.1）：政策違規是程式錯誤，
 *   屬於系統錯誤，拋例外處理。因此本層的兩支函式都不回 `ServiceResult`。
 * - 大目錄層也沒有 `routes.ts`：§0.3 規定的是「對外有哪兩個出口、各自能被誰 import」，
 *   不是「兩個都必須存在」。零端點的大目錄只有 `index.ts`——生一個什麼都不 re-export 的
 *   `routes.ts` 只會多一個空殼，而路由組裝點還是得記得別去 import 它。
 */
import type { TransactionRunner } from '../../../db/client.ts'
import { buildChangeSet, type AuditChange, type AuditSnapshot } from './domain/audit-change-set.ts'
import { AUDIT_FIELD_POLICY, type AuditSubjectTable } from './domain/audit-field-policy.ts'
import { recordAudit as recordAuditImpl, type AuditRecordInput } from './impl/audit-main.record.service.ts'

export type { AuditAction } from './domain/audit-action.ts'
export type {
  AuditChange,
  AuditFieldValue,
  AuditPresenceChange,
  AuditSnapshot,
  AuditValueChange,
} from './domain/audit-change-set.ts'
export type { AuditSubjectTable, AuditTablePolicy, AuditFieldLevelValue } from './domain/audit-field-policy.ts'
export { AuditFieldLevel } from './domain/audit-field-policy.ts'
export type { AuditActor } from './audit-main.repository.ts'
export type { AuditRecordInput }

/**
 * 依欄位政策把前後快照算成逐欄差異（計畫 §4.3）。
 *
 * **`changes` 只能由這裡產生。** 政策查表放在入口而不是放在 `domain/`，是為了讓純函式對
 * 「系統裡有哪些表」一無所知（那樣三個級別的行為才各自測得到）；而查表放在這裡，
 * 呼叫端就**選不到別張表的政策**——`subjectTable` 決定了套哪一份，兩者不可能對不上。
 *
 * @param subjectTable 資料主體所在的表，與 {@link AuditRecordInput.subjectTable} 是同一個值。
 * @param before 異動前的**業務層明文快照**；新增時傳 `null`。
 * @param after 異動後的**業務層明文快照**；刪除時傳 `null`。
 *
 * **兩個快照必須是明文，不是資料庫 row**（計畫 §4.4）：加密欄位每次寫入的 IV 都不同，
 * 拿密文比對的話，每一次更新都會宣稱身分證被改過。理由完整寫在 `domain/audit-change-set.ts` 檔頭。
 *
 * @throws 出現政策未分類的欄位時拋出（系統錯誤，§3.1.2）。不靜默丟棄——丟棄的話稽核會少一欄，
 *   而沒有任何人會知道。
 */
export const buildAuditChanges = (
  subjectTable: AuditSubjectTable,
  before: AuditSnapshot | null,
  after: AuditSnapshot | null,
): readonly AuditChange[] => buildChangeSet(AUDIT_FIELD_POLICY[subjectTable], before, after)

/**
 * 寫入一筆稽核紀錄。
 *
 * @param runner 呼叫端**業務交易**的 handle。稽核與業務同生共死（計畫 §5）：自己另開連線的話，
 *   業務 rollback 時稽核不會跟著回滾，庫裡會留下「稽核說改過、資料實際沒改」的幽靈紀錄，
 *   而查稽核的人沒有辦法分辨那一筆是真的還是幽靈。
 *
 *   型別是 `TransactionRunner`，不是 repository 常見的 `QueryRunner`——後者連線池與交易物件
 *   都滿足，會讓「傳裸連線池」與「傳交易」在編譯器眼裡等價。`recordAudit(context.db, ...)`
 *   因此是編譯錯誤，不必再靠 `check-audit-transaction.ts` 讀語法樹才擋得住。
 *
 * @throws 寫入失敗時拋出，**並連帶讓外層業務交易失敗**。代價是明知的：稽核寫失敗，業務也會失敗
 *   ——「改得成但沒有紀錄」在稽核的語意下就是不該發生的事。
 */
export const recordAudit = (runner: TransactionRunner, input: AuditRecordInput): Promise<void> =>
  recordAuditImpl(runner, input)
