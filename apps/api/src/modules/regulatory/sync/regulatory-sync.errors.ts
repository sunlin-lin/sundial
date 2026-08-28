/**
 * 法規同步的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3、計畫 §4.4）。
 *
 * ## 這兩則錯誤都不會出現在任何 HTTP 回應裡，這一點必須先講
 *
 * 本次目錄只有一支端點（`/regulatory/sync/list`），而它是查詢類、沒有業務錯誤。
 * 下面兩則碼的呼叫者是 **`runSync` 的呼叫端**（日後的排程器，或伺服器上執行的一次性程式），
 * 那條路徑不經過 HTTP——計畫 D3 明確不開放 `/regulatory/sync/trigger`：
 * 觸發全平台同步不該由某一家公司的管理者做，而平台管理員這個角色還不存在。
 *
 * ## 為什麼同步失敗要回 `ServiceResult` 的失敗分支，而不是回一個「結果物件」
 *
 * 失敗**已經**寫進 `regulatory_sync_logs`（`status_code=3` ＋ `error_message`），
 * 從資料完整性的角度什麼都不缺。差別在呼叫端：回一個帶 `status` 欄位的成功值時，
 * 「跑完了」與「失敗了」在型別上完全一樣，排程器最自然的寫法是 log 一行然後跑下一個資料集
 * ——於是政府調了費率、我們的解析器壞了，而告警一次都不會響。
 *
 * `ServiceResult<T>` 是可辨識聯集，**不處理失敗分支就取不到 `value`**，編譯不過（§3.1.1）。
 * 這與 `datasets` 那一側「回 `null` 會讓某個人的薪資單安靜消失」是同一條理由的兩個場景。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）：錯誤分組用具名常數表達。
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2），字面中文在
 * `shared/i18n/locales/zh-TW/regulatory.ts`。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'
import type { RegulatoryDatasetCode } from '../datasets/regulatory-datasets.service.ts'

/**
 * 本次目錄的錯誤碼（§1.3）。
 *
 * `satisfies Record<string, ErrorCode>` 把每一個碼釘在集中聯集（`shared/i18n/messages.ts`）上：
 * 新增一個碼卻忘了寫訊息時，**這一行當場編譯不過**。
 *
 * 碼由模組路徑機械推導：本次目錄在 `modules/regulatory/sync/`，因此一律 `regulatory.sync.errors.*`。
 */
export const RegulatorySyncErrorCode = {
  AlreadyRunning: 'regulatory.sync.errors.already-running',
  SyncFailed: 'regulatory.sync.errors.sync-failed',
} as const satisfies Record<string, ErrorCode>

export type RegulatorySyncErrorCodeValue = (typeof RegulatorySyncErrorCode)[keyof typeof RegulatorySyncErrorCode]

/**
 * 同一個資料集已經有**活著的**同步在跑。
 *
 * 「活著」的判準是心跳（計畫 §3.4）：`status_code=1` 且 `heartbeat_at` 落後不超過三個週期。
 * 心跳落後超過三個週期的那些不會走到這裡——它們會先被判死、改成 `status_code=3` 並寫入
 * `error_message`（**不是直接忽略**，那樣就少了一次失敗紀錄，而那正是事後要查
 * 「為什麼那三天沒同步」時唯一的線索）。
 *
 * 分組是 `Conflict`（→ 409／`300`）而不是 `Unprocessable`：這正是「你要做的事與另一個
 * 正在進行的操作撞了」，呼叫端的處置是稍後再試，不是去改輸入。
 *
 * **這一次不會寫進 `regulatory_sync_logs`。** 那張表記的是「一次同步的下載、驗證與套用結果」，
 * 而這一次根本沒有開始；為它寫一列會讓歷程裡混進一堆沒有做任何事的紀錄，
 * 把真正的失敗淹掉。要知道「有東西在跑」，看的是那一筆 `status_code=1` 的紀錄本身。
 */
export const regulatorySyncAlreadyRunning = (datasetCode: RegulatoryDatasetCode, runningLogId: number): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RegulatorySyncErrorCode.AlreadyRunning,
  msg: RegulatorySyncErrorCode.AlreadyRunning,
  data: { datasetCode, runningLogId },
})

/**
 * 這一次同步失敗了（`regulatory_sync_logs` 已寫入 `status_code=3` ＋ `error_message`）。
 *
 * `data` 一定要帶 `syncLogId`：呼叫端唯一有用的動作是去看那一列的 `error_message`，
 * 而失敗原因往往很長（政府回了一頁 HTML、某一列的日期壞了），不適合塞進錯誤訊息本身。
 * `reason` 同時帶一份摘要，讓告警上看得到「壞在哪一步」而不必先去查資料庫。
 *
 * 分組是 `Unprocessable`（→ 422／`300`）：這不是撞單，是「這批資料我們處理不了」。
 */
export const regulatorySyncFailed = (
  datasetCode: RegulatoryDatasetCode,
  syncLogId: number,
  reason: string,
): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RegulatorySyncErrorCode.SyncFailed,
  msg: RegulatorySyncErrorCode.SyncFailed,
  data: { datasetCode, syncLogId, reason },
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定。
 */
export type RegulatorySyncErrorDeclaration = {
  readonly code: RegulatorySyncErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`。 */
  readonly webFlowCode: '300'
}

/**
 * 每支端點會吐出哪些業務錯誤。
 *
 * **`list` 是空清單，而空清單必須明寫**（§1.8.3）：省略時「這支沒有業務錯誤」與
 * 「有人忘了宣告」在契約上長得一模一樣，前端只能一律當作「可能有沒寫出來的錯誤」而退回保守處理。
 *
 * 上面那兩則碼不在這裡，也不會在任何端點的清單裡（理由見檔頭）——列進來等於給前端一份
 * 騙人的契約，它會為一個永遠收不到的碼寫一條分支。
 */
export const REGULATORY_SYNC_ENDPOINT_ERRORS = {
  /** 查詢類：查無資料回空清單，不是錯誤（§3.1.3）。 */
  list: [],
} as const satisfies Record<string, readonly RegulatorySyncErrorDeclaration[]>

/**
 * 把宣告清單轉成 OpenAPI 的 `description` 文字。
 *
 * 清單必須進契約（§1.8.3），而 Elysia 的 `detail` 只吃標準 OpenAPI 欄位；塞進 `description`
 * 是目前唯一不需要自訂擴充欄位就能讓前端看到這份清單的位置。
 */
export const describeRegulatorySyncErrors = (declarations: readonly RegulatorySyncErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
