/**
 * 逐欄差異的計算（零 IO 純函式，計畫 §4.2、§4.3、§4.4）。
 *
 * 本檔**不得 import 任何 db 或 http 模組**（§3.1.1、§0.1）：它收到的是已經解密／解析好的
 * **業務層明文物件**，不是資料庫 row。這不是分層潔癖，而是 `presence` 這一級能不能成立的關鍵，
 * 理由見下方「為什麼一定要比明文」。
 *
 * ## 為什麼是逐欄差異，不是「前後兩包整筆」
 *
 * `{ before: { 整筆 }, after: { 整筆 } }` 會把**沒有改動的欄位**也複製兩份，
 * 而 `employees` 沒改動的欄位裡就有身分證——光是改一個員工編號，整份身分證就跟著進了稽核表，
 * 而那正是資料字典明文禁止的。逐欄的話，只有真的被改到的欄位才有機會進來，
 * 而且每一欄都還要先過欄位政策（`audit-field-policy.ts`）。
 *
 * ## 為什麼一定要比明文（計畫 §4.4）
 *
 * 員工更新是**全量提交**：使用者送出表單時，身分證明文會原封不動地一起送回來、再被重新加密一次，
 * 而 AES-256-GCM **每次寫入的 IV 都不同**（`db/field-encryption.ts` 檔頭寫明了這是刻意的設計）。
 * 於是**HR 只改了一個電話號碼，身分證的密文也一定跟改之前不同**。
 *
 * 如果變更判定是拿密文的位元組去比，每一次員工資料更新都會產生一筆
 * `{ field: 'identityNumber', changed: true }`——身分證根本沒被動過。
 * 這不是偶發，是每一次更新都會發生：稽核表裡「這個人的身分證被改過幾次」會變得跟
 * 「這個人的資料被改過幾次」完全同義，而 `presence` 這一級存在的唯一理由
 * （把「真的動了敏感欄位」這個訊號分辨出來）整個失效。
 *
 * 因此本檔比對的一律是加密**之前**的明文，而且它拿不到密文——參數型別就不收位元組。
 */
import { AuditFieldLevel, type AuditTablePolicy } from './audit-field-policy.ts'

/**
 * 稽核看得懂的欄位值。
 *
 * **刻意不允許物件與陣列。** 允許巢狀值等於開一條路，讓整包子結構（例如一整筆任職紀錄、
 * 一整份加密欄位組）以「一個欄位」的名義被塞進 `changes`——而政策是**逐欄**分級的，
 * 巢狀值裡面那些欄位一個都沒有被分類過，等於整組繞過白名單。
 * 真的有子結構要稽核時，正確作法是它自己成為一個 `subject_table`（有自己的政策）。
 */
export type AuditFieldValue = string | number | boolean | null

/**
 * 前後快照：業務層明文物件（`EmployeeProfileInput` 那一套），**不是資料庫 row**。
 *
 * 用 `Record` 而不是泛型綁定某個業務型別：綁定就得 import 對方模組的內部檔案（§0.3 禁止），
 * 而型別安全在這裡也買不到真正的保障——會出事的是「多了一個沒分類的欄位」，
 * 那件事由政策比對在執行期擋（見 {@link buildChangeSet} 的拋例外分支），不是由型別擋。
 */
export type AuditSnapshot = Readonly<Record<string, AuditFieldValue>>

/** `value` 級的一筆差異。新增時 `before` 為 `null`，刪除時 `after` 為 `null`。 */
export type AuditValueChange = {
  readonly field: string
  readonly before: AuditFieldValue
  readonly after: AuditFieldValue
}

/**
 * `presence` 級的一筆差異：**只說「這一欄變更了」**。
 *
 * **刻意不帶 `before`／`after`，而不是塞 `'***'`**：塞遮罩字串的話，讀稽核的程式仍然要判斷
 * 「這個值是真的還是遮罩」，而判斷錯的後果是把 `***` 當成使用者真的填了三個星號。
 * 結構不同，就沒有這個判斷。
 *
 * `changed` 的型別是字面值 `true` 而不是 `boolean`：**沒有變更的欄位根本不會出現**，
 * 因此 `changed: false` 這種狀態不存在。允許它存在的話，讀的人就得分辨
 * 「沒有這一筆」與「有這一筆但 false」，而兩者其實是同一件事。
 */
export type AuditPresenceChange = {
  readonly field: string
  readonly changed: true
}

/** 寫進 `audit_logs.changes` 的一筆差異。 */
export type AuditChange = AuditValueChange | AuditPresenceChange

/**
 * 取前後快照的欄位聯集，並保留出現順序。
 *
 * 用聯集而不是只取其中一邊：新增時只有 `after`、刪除時只有 `before`，而更新時兩邊理應同形
 * ——只取一邊的話，另外兩種事件會靜靜地少記欄位。
 */
const collectFields = (before: AuditSnapshot | null, after: AuditSnapshot | null): readonly string[] => [
  ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
]

/**
 * 讀取快照上的值。
 *
 * 快照本身為 `null`（新增或刪除的另一側）與「快照有、但沒有這個 key」都收斂成 `null`：
 * 兩邊是同形的業務物件，缺 key 只可能發生在其中一側整個不存在的時候，
 * 而讓它多出一種 `undefined` 狀態，會讓下游每一處都要多寫一次「這是沒填還是沒這個欄位」的判斷。
 */
const readValue = (snapshot: AuditSnapshot | null, field: string): AuditFieldValue =>
  snapshot === null ? null : (snapshot[field] ?? null)

/**
 * 依政策把前後快照算成逐欄差異。
 *
 * @param policy 這張表的欄位政策。**由呼叫端傳進來而不是在本函式內查表**：政策是純資料，
 *   傳進來讓這個函式對「有哪些表」一無所知，也讓三個級別的行為可以各自被測到
 *   ——真實政策裡不一定同時存在三種級別的欄位。查表由入口的 `buildAuditChanges` 負責。
 * @param before 異動前的業務明文快照；**新增時傳 `null`**。
 * @param after 異動後的業務明文快照；**刪除時傳 `null`**。
 * @returns 只含真的變更了、且政策允許記錄的欄位。沒有任何變更時回空陣列。
 *
 * @throws 出現政策未分類的欄位時拋出。**這是系統錯誤（§3.1.2），不是業務拒絕**：
 *   它代表有人加了欄位卻沒有更新政策，是程式錯誤，使用者做什麼都改變不了它。
 *   **刻意不靜默丟棄**——丟棄的話稽核會少一欄，而沒有任何人會知道（計畫 §4.3）。
 */
export const buildChangeSet = (
  policy: AuditTablePolicy,
  before: AuditSnapshot | null,
  after: AuditSnapshot | null,
): readonly AuditChange[] => {
  const changes: AuditChange[] = []

  for (const field of collectFields(before, after)) {
    const level = policy.fields[field]

    if (level === undefined) {
      // 訊息只帶欄位名與型別來源，**不帶值**（§3.2 末條：例外訊息禁止含個資明文，
      // 而例外訊息一定會進 log，log 的保存期會跟著變成個資保存期）。
      throw new Error(`稽核欄位政策未分類的欄位 ${field}（政策來源 ${policy.source}），請先在 AUDIT_FIELD_POLICY 分級`)
    }

    // `excluded` 是「刻意不記」：連欄位名都不出現，與「沒有變更」在 `changes` 上無從區分
    // ——這正是要的，讀稽核的人不需要知道系統裡還有這一欄。
    if (level === AuditFieldLevel.Excluded) continue

    const previousValue = readValue(before, field)
    const nextValue = readValue(after, field)
    if (previousValue === nextValue) continue

    changes.push(
      level === AuditFieldLevel.Presence
        ? { field, changed: true }
        : { field, before: previousValue, after: nextValue },
    )
  }

  return changes
}
