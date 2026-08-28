/**
 * 資料存取：寫入一筆稽核紀錄。
 *
 * **這是本模組唯一的資料存取動作，而且永遠只會有 INSERT 與（日後的）SELECT。**
 * 稽核紀錄一旦寫入就不得修改或刪除（§5.3），因此 `impl/` 底下不會有 update／delete 切片
 * ——那不是還沒做，是刻意沒有（計畫 §3.4）。有了那兩支，「稽核可以被改」就從
 * 「資料庫帳號沒給權限」退化成「大家記得不要呼叫它」。
 *
 * **不自開交易，也不自開連線**：`runner` 由呼叫端傳入（計畫 §5、§4.4）。
 * 自己另開連線的話，業務 rollback 時稽核不會跟著 rollback，庫裡就會出現
 * 「稽核說改過、資料實際沒改」的紀錄，而查稽核的人沒有任何辦法分辨那一筆是真的還是幽靈。
 *
 * **刻意沒有 try／catch**：寫入失敗一律往上拋（§3.1.2），連帶讓外層的業務交易一起失敗。
 * 代價要講清楚——**稽核寫失敗，業務也會失敗**。這是接受的：在稽核的語意下，
 * 「改得成但沒有紀錄」本來就是不該發生的事，而稽核寫入只是一次 INSERT，
 * 失敗機率與業務寫入同級，把它排除在交易外並沒有換到多少可用性。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { auditLogs, AuditActorType, type AuditActorTypeValue } from '../../../../db/schema/index.ts'
import type { AuditChange } from '../domain/audit-change-set.ts'

/**
 * 操作者。
 *
 * **做成可辨識聯集，而不是「一個 code ＋ 一個可空的 id」**：後者允許寫出
 * `actorTypeCode=1 且 actorCompanyUserId=null`（稽核指不到任何人）與
 * `actorTypeCode=2 卻帶著某個成員 ID`（稽核指向一個沒做過這件事的人）這兩種列，
 * 而資料庫兩種都收（`actor_company_user_id` 依規格必須 nullable，見 schema 註解）。
 * 聯集讓這兩種組合**寫不出來**，「條件必填」因此不必靠人記得。
 */
export type AuditActor =
  | {
      readonly type: 'company-user'
      /** 操作者本人。必須是**本公司**的成員——複合外鍵 `fk_audit_logs_actor` 會擋跨公司的值。 */
      readonly companyUserId: string
    }
  /** 系統（排程／驗證器）產生，沒有人可以負責。例如 refresh token 重用偵測。 */
  | { readonly type: 'system' }

/** 要寫入的一列。公司 ID 不在這裡——它由 {@link TenantDatabase} 從呼叫參數注入（§4.2）。 */
export type NewAuditLog = {
  readonly id: string
  readonly actor: AuditActor
  readonly action: string
  readonly subjectTable: string
  /** 主體主鍵的**字串形式**：uuid 直接存，`bigint` 存十進位字串（計畫 §3.2）。 */
  readonly subjectId: string
  readonly changes: readonly AuditChange[]
  /** 帶生效日的異動才有；沒有就是 `null`。台北的日曆日 `YYYY-MM-DD`，不做換算（§6）。 */
  readonly effectiveDate: string | null
  /** 台北牆鐘時間，由呼叫端注入的 clock 取得（§6.2）。這一欄就是資料字典所稱的「操作時間」。 */
  readonly createdAt: string
}

/**
 * 代碼欄位只在這裡由聯集攤平成資料庫的兩欄。
 *
 * 放在資料存取層而不是 service：`AuditActorType` 是**儲存格式**的一部分，
 * 讓 service 去碰它，等於讓業務層知道「系統事件在 DB 裡是 2」——而那個數字改不了、也不該被知道。
 */
const toActorColumns = (
  actor: AuditActor,
): { readonly actorTypeCode: AuditActorTypeValue; readonly actorCompanyUserId: string | null } =>
  actor.type === 'company-user'
    ? { actorTypeCode: AuditActorType.CompanyUser, actorCompanyUserId: actor.companyUserId }
    : { actorTypeCode: AuditActorType.System, actorCompanyUserId: null }

export const insertAuditLog = async (runner: QueryRunner, companyId: string, log: NewAuditLog): Promise<void> => {
  const tenant = new TenantDatabase(runner, companyId)

  await tenant.insert(auditLogs, (scopedCompanyId) => ({
    id: log.id,
    companyId: scopedCompanyId,
    ...toActorColumns(log.actor),
    action: log.action,
    subjectTable: log.subjectTable,
    subjectId: log.subjectId,
    // `changes` 是 `json` 欄位，drizzle 負責序列化。**這裡是全流程唯一把 `changes` 落地的地方**，
    // 因此「有沒有過政策」只要看得到這一行的上游就答得出來（`recordAudit` → `buildChangeSet`）。
    changes: log.changes,
    effectiveDate: log.effectiveDate,
    createdAt: log.createdAt,
  }))
}
