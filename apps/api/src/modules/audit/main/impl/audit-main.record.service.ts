/**
 * 業務動作：寫入一筆稽核紀錄。
 *
 * ## 沒有 `ServiceResult`，也沒有錯誤收集
 *
 * 其他 service 回 `ServiceResult` 是因為它們**有業務拒絕可以收集**（§3.1.1）。稽核寫入沒有：
 * 它不是使用者發起的動作，使用者也無法「填對」讓它成功——政策未分類、動作碼寫錯、
 * 資料庫寫不進去，三者全部是程式或環境錯誤，屬於系統錯誤，走例外（§3.1.2）。
 * 硬包一層 `ServiceResult` 的後果是呼叫端會得到一個「失敗但看起來可以繼續」的回傳值，
 * 而稽核失敗**必須**讓業務一起失敗（計畫 §5），那正好是最不該被忽略的一種回傳值。
 * 因此本模組也沒有 `errors.ts`（計畫 §6）。
 *
 * ## 交易 handle 由呼叫端傳入，且型別上就是交易，不是隨便一個連線
 *
 * `runner` 是呼叫端**業務交易**的 handle（計畫 §5）。稽核必須與業務同生共死：
 * 業務 rollback 時稽核跟著消失，業務 commit 時稽核一定在。
 * 丟 queue 事後補也不行——漏記等於沒有稽核，而且漏記沒有症狀：沒有錯誤、沒有告警，
 * 只有事後查不到那一筆，而稽核紀錄**補不回來**（計畫 §1）。
 *
 * 型別是 `TransactionRunner`（`db/client.ts`），不是 `QueryRunner`：後者連線池與交易物件都滿足，
 * `recordAudit(context.db, ...)` 與 `recordAudit(tx, ...)` 在編譯器眼裡會完全等價——這正是稽核
 * 曾經只能靠 `check-audit-transaction.ts` 讀 AST 才擋得住的原因。換成 `TransactionRunner` 之後，
 * 傳裸連線池是編譯錯誤，不必再靠腳本讀語法樹去發現（該腳本的職責變化見其檔頭）。
 */
import { insertAuditLog, type AuditActor } from '../audit-main.repository.ts'
import type { TransactionRunner } from '../../../../db/client.ts'
import type { AuditAction } from '../domain/audit-action.ts'
import type { AuditChange } from '../domain/audit-change-set.ts'
import type { AuditSubjectTable } from '../domain/audit-field-policy.ts'

export type AuditRecordInput = {
  /**
   * 公司範圍。**只能來自已驗證的 token**（§4.2）——與呼叫端寫業務資料時用的是同一個值。
   * 兩邊若不同，會產生一筆記在 A 公司名下、實際改的是 B 公司資料的稽核，而查詢不會有任何異狀。
   */
  readonly companyId: string
  /** 操作者。公司成員與系統事件由型別分開，見 `AuditActor`。 */
  readonly actor: AuditActor
  /** 動作碼，由模組路徑推導（計畫 §4.1），例如 `employees.main.update`。 */
  readonly action: AuditAction
  /**
   * 資料主體所在的表。**型別收斂到欄位政策的 key**（計畫 §4.5）：
   * 沒有政策的表寫不進來，因此不會出現「有稽核紀錄、但沒有任何欄位分級在管它」的列。
   */
  readonly subjectTable: AuditSubjectTable
  /** 主體主鍵的字串形式：uuid 直接存，`bigint` 存十進位字串（計畫 §3.2）。 */
  readonly subjectId: string
  /**
   * 逐欄差異。**必須由 `buildAuditChanges` 產生**（入口檔），那是唯一會套用欄位政策的路徑。
   *
   * 型別上擋不住手工組出來的陣列，這一點要誠實：`changes` 的元素形狀本來就得是公開型別，
   * 否則入口的產生函式也回不出它。擋得住的是「不小心」——手寫一筆 `{ field: 'identityNumber',
   * before, after }` 是一個在 review 上看得見的動作，而不是一行看起來很正常的 import。
   */
  readonly changes: readonly AuditChange[]
  /** 帶生效日的異動才有（部門異動、扣繳方式、投保設定）；其餘一律 `null`。 */
  readonly effectiveDate: string | null
  /**
   * 台北牆鐘時間 `YYYY-MM-DD HH:mm:ss`，由呼叫端注入的 clock 取得（§6.2）。
   *
   * **刻意不在這裡呼叫 clock，也不收 `Clock` 物件**：稽核的「操作時間」必須與同一交易內的業務寫入
   * 是**同一個值**（計畫 §3.3：兩者必然相同）。讓稽核自己取一次「現在」，兩個時間就會差幾毫秒，
   * 而那個差值會落在秒的邊界上——同一次操作在稽核與業務資料上顯示成兩個時刻，
   * 事後比對時看起來像是兩件事。
   */
  readonly now: string
}

export const recordAudit = async (runner: TransactionRunner, input: AuditRecordInput): Promise<void> => {
  await insertAuditLog(runner, input.companyId, {
    // 主鍵在這裡產生而不是交給資料庫：這張表的 `id` 是 uuid（不是 auto-increment），
    // 而 service 產生主鍵是本專案既有的作法（見 `employees-main.create.service.ts`）。
    id: crypto.randomUUID(),
    actor: input.actor,
    action: input.action,
    subjectTable: input.subjectTable,
    subjectId: input.subjectId,
    // **空的 `changes` 照樣寫入。** 計畫沒有規定這種情形，而兩種處置裡只有這一種是安全的：
    // 靜默跳過等於「這個動作沒有留下任何痕跡」，而「有人對這筆資料送出了一次修改、結果什麼都沒改」
    // 本身就是稽核想回答的問題之一。要不要視為異常，是日後有實例時再判斷的事，
    // 不是在這裡用一行 `if` 悄悄決定的事。
    changes: input.changes,
    effectiveDate: input.effectiveDate,
    createdAt: input.now,
  })
}
