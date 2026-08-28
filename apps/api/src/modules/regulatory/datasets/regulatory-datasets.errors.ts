/**
 * 法規資料集的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3、計畫 §4.4）。
 *
 * ## 這裡只有一則錯誤，而「缺席的那幾則」才是本檔的重點
 *
 * - **沒有 `version-not-found`，這是刻意的**（計畫 §4.4）。`/regulatory/datasets/get` 是查詢類端點，
 *   §3.1.3 規定查詢類的「目標不存在」回 HTTP 200 ＋ `code='200'` ＋ `data: null`，
 *   **不算錯誤、不進錯誤集合**。多開一個 not-found 碼會讓這支端點的「查無資料」跟全站其他查詢端點
 *   長得不一樣，前端就得為它單獨寫一條分支。
 * - **沒有「未知的 `datasetCode`」**：它是列舉值，由 schema 驗證擋下（`100`，§2），不是業務錯誤。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）：錯誤分組用具名常數表達，
 * 「這個分組在某個入口上對應什麼狀態碼」是入口的事。
 *
 * **每一筆的 `msg` 是訊息 key，不是字面訊息**（§1.8.2）：本檔決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定。字面中文在 `shared/i18n/locales/zh-TW/regulatory.ts`。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'
import type { RegulatoryDatasetCode } from './domain/regulatory-dataset-code.ts'

/**
 * 本模組的錯誤碼（§1.3）。
 *
 * `satisfies Record<string, ErrorCode>` 把每一個碼釘在集中聯集（`shared/i18n/messages.ts`）上：
 * 新增一個碼卻忘了寫訊息時，**這一行當場編譯不過**，而不是等到執行期回一句查不到的訊息。
 *
 * **碼由模組路徑機械推導**：`<大目錄>.<次目錄>.<類別>.<訊息名>`，本模組在
 * `modules/regulatory/datasets/`，因此一律 `regulatory.datasets.errors.*`。
 */
export const RegulatoryDatasetErrorCode = {
  NoEffectiveVersion: 'regulatory.datasets.errors.no-effective-version',
} as const satisfies Record<string, ErrorCode>

export type RegulatoryDatasetErrorCodeValue =
  (typeof RegulatoryDatasetErrorCode)[keyof typeof RegulatoryDatasetErrorCode]

/**
 * 該基準日沒有適用版本——「這一天的法規我們沒有資料」。
 *
 * ## 這是本模組最重要的一則錯誤，而它有兩個形狀不同的呼叫者（計畫 §4.4）
 *
 * | 呼叫者 | 拿到什麼 |
 * |---|---|
 * | service `resolveEffectiveDataset`（Payroll 等模組） | `ServiceResult` 的失敗分支，帶這一筆 |
 * | HTTP `/regulatory/datasets/resolve` | 查詢類，HTTP 200 ＋ `data: null`（§3.1.3，由 handler 收斂） |
 *
 * **service 端回 `ServiceResult` 而不是拋例外**（§3.1.1）：拋例外的話 Payroll 必須 `catch`
 * 才能繼續，而用 `catch` 表達業務流程正是該節禁止的事。安全性來自型別，不是來自例外——
 * `ServiceResult<T>` 是可辨識聯集，**不處理失敗分支就取不到 `value`**，編譯不過；
 * 例外可以被一個空的 `catch` 吞掉，型別不行。
 *
 * **`data` 一定要帶 `datasetCode` 與 `asOfDate`**（計畫 §4.4）：跨模組的錯誤碼必須由呼叫端
 * 轉譯成自己的碼（Payroll 的端點只能吐 `payrolls.*`），而轉譯時「哪個資料集、哪一天」
 * 是唯一有用的資訊——不帶的話它會在轉譯過程中掉光。
 *
 * 不這樣規定的話會發生什麼：300 名員工的批次結算，其中 1 人因為新的職災行業別還沒同步而查無版本。
 * 若介面回的是 `null`，呼叫端很容易寫成「單人失敗就 log 並 continue」——**那個人的薪資單直接從
 * 當期結果中消失**，批次跑完看起來成功，只是少一張。
 *
 * 分組是 `Unprocessable`（→ 422／`300`）而不是 `Conflict`：這不是「你的值與別人撞了」，
 * 是「這個基準日我們沒有資料可以算」，使用者（或上游模組）的處置是去補資料或改基準日。
 */
export const regulatoryNoEffectiveVersion = (datasetCode: RegulatoryDatasetCode, asOfDate: string): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RegulatoryDatasetErrorCode.NoEffectiveVersion,
  msg: RegulatoryDatasetErrorCode.NoEffectiveVersion,
  data: { field: 'asOfDate', datasetCode, asOfDate },
})

/**
 * 端點錯誤碼宣告（§1.8.3）。**未宣告的錯誤碼不得在執行期出現。**
 *
 * `httpStatus` 在這裡是**契約文件**，不是控制流程：實際的 status 由邊界層依 `group` 決定
 * （`http/error-boundary.ts`），業務程式碼一行都不會讀它。
 */
export type RegulatoryDatasetErrorDeclaration = {
  readonly code: RegulatoryDatasetErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 422
  /** envelope `code`（§1.3）。業務錯誤恆為 `300`。 */
  readonly webFlowCode: '300'
}

/**
 * 每支端點會吐出哪些業務錯誤。
 *
 * **四支端點全部是空清單，而空清單必須明寫**（§1.8.3）：省略時「這支沒有業務錯誤」與
 * 「有人忘了宣告」在契約上長得一模一樣，前端只能一律當作「可能有沒寫出來的錯誤」而退回保守處理。
 *
 * `resolve` 為什麼也是空的：{@link regulatoryNoEffectiveVersion} 只走 service 那一側
 * （給 Payroll 用）。HTTP 那一側依 §3.1.3 把它收斂成 `data: null`，因此**前端永遠不會**
 * 在 `errors` 裡看到 `regulatory.datasets.errors.no-effective-version`——
 * 宣告它反而是騙人的契約（前端會為一個不會出現的碼寫一條處置分支）。
 */
export const REGULATORY_DATASET_ENDPOINT_ERRORS = {
  /** 查詢類：查無資料回空清單，不是錯誤（§3.1.3）。 */
  list: [],
  /** 查詢類：查無資料回 `data: null`，不是錯誤（§3.1.3）。 */
  get: [],
  /** 查詢類：查無適用版本回 `data: null`（計畫 §4.4，見上）。 */
  resolve: [],
  /**
   * 總覽固定回九列（任務一），沒有「查無資料」這件事可以發生，也沒有其他業務規則要檢查——
   * 單一資料集在該基準日沒有適用版本，反映在那一列的 `effectiveVersion: null` 上，
   * 不是整支端點的錯誤。
   */
  overview: [],
} as const satisfies Record<string, readonly RegulatoryDatasetErrorDeclaration[]>

/**
 * 把宣告清單轉成 OpenAPI 的 `description` 文字。
 *
 * 清單必須進契約（§1.8.3），而 Elysia 的 `detail` 只吃標準 OpenAPI 欄位；塞進 `description`
 * 是目前唯一不需要自訂擴充欄位就能讓前端看到這份清單的位置。
 */
export const describeRegulatoryDatasetErrors = (
  declarations: readonly RegulatoryDatasetErrorDeclaration[],
): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
