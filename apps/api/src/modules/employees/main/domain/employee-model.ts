/**
 * 員工主檔的業務型別（service ↔ repository 之間傳遞的形狀）。
 *
 * 這一組型別**刻意不等於 Drizzle 的 row，也不等於端點的 `data`**（§1.8.0 的三種形狀）：
 * 三者共用同一個型別時，資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變
 * ——那是個資外洩最常見的路徑（§2）。
 *
 * ## 最重要的一條：**輸出型別上根本沒有明文欄位**
 *
 * {@link EmployeeSummary} 與 {@link EmployeeDetail} 帶的一律是 `xxxMasked`，
 * 明文只出現在**寫入方向**的 {@link EmployeeProfileInput}。這是刻意的結構安排，不是命名習慣：
 * §5.1 要求「對外回應一律遮罩」，而如果業務型別上有一個 `identityNumber: string`，
 * 那條規則就退化成「每一支 handler 都要記得先呼叫遮罩函式」——漏掉一支不會有編譯錯誤、
 * 不會有測試變紅，只會有一支端點靜靜地回出完整身分證。
 * 讓 repository 在解密後**當場遮罩**、明文一步都不往上走，這個失敗模式就不存在。
 *
 * 代價要講清楚：日後若真的需要一支「明確授權 ＋ 必寫稽核」的完整值端點（§5.1 允許這種端點），
 * 它必須新增一個**另外命名的** repository 動作與另外一組型別，而不是把明文加回這裡。
 * 那個新增動作會是一次看得見、可以在 PR 上被質疑的變更——正是這種端點該有的樣子。
 *
 * 本目錄一律零 IO：這裡只有型別與純函式，沒有任何資料庫或 http 相依（§0.1、§3.1.1）。
 */

/**
 * 性別代碼，`'MALE' | 'FEMALE'` 的聯集字面值。
 *
 * **以 type-only import 沿用 `db/schema/employees.ts` 的定義**，不在這裡另抄一份：
 * 抄一份就是第二份真相，兩邊哪天不一致不會有任何地方變紅。type-only import 在編譯後完全消失，
 * 因此 domain 仍然不帶任何執行期相依（`verbatimModuleSyntax`）。
 */
export type { GenderValue } from '../../../../db/schema/index.ts'

import type { GenderValue } from '../../../../db/schema/index.ts'

/** 列表單筆。清單只需要這幾欄，其餘個資連解密都不必做（§4.5：清單頁不撈用不到的欄位）。 */
export type EmployeeSummary = {
  readonly id: string
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  /** 已遮罩的身分證（僅末 3 碼，§5.1）。**這裡沒有、也不會有未遮罩的版本**，見檔頭。 */
  readonly identityNumberMasked: string
}

/**
 * 員工清單的一列，比 {@link EmployeeSummary} 多一欄「目前有效職稱」。
 *
 * **只加在列表，不加在 `EmployeeSummary` 本身**：`EmployeeDetail` 是 `EmployeeSummary` 的擴充，
 * `get`／`update` 兩支端點回的是 `EmployeeDetail`，而職稱不是那兩支端點的欄位需求
 * ——UI 定案（`docs/ui/20-employee-list.md` §1）明列「職稱」是**列表**欄位，不是單筆詳情欄位。
 * 把它加進 `EmployeeSummary` 會連帶要求 `get`／`update` 的每一次查詢都算一次職稱，即使畫面根本
 * 不顯示。
 *
 * `jobTitleName` 為 `null` 代表這位員工目前沒有生效中的職稱（職稱依公司設定為選填，見
 * `employees/onboarding` 的 `CreateOnboardingInput.jobTitleId`），不是查詢失敗——計畫 §3.2
 * 點名「不做的話那一欄永遠空白」，本輪（Stage 5）把它接進來。
 *
 * **批次計算，不是逐列查詢**（§4.5）：`impl/employees-main.list.repository.ts` 對整頁員工一次
 * 批次查出目前有效任職與目前有效職稱，在記憶體裡用 `Map` 對應回去，不在迴圈裡逐一查詢。
 */
export type EmployeeListItem = EmployeeSummary & {
  readonly jobTitleName: string | null
}

/** 單筆員工的完整內容。`get`／`create`／`update` 共用同一個形狀。敏感欄位一律已遮罩。 */
export type EmployeeDetail = EmployeeSummary & {
  readonly birthdayMasked: string
  readonly phoneMasked: string
  /** `null` 代表沒填 Email，不是「填了但看不到」——兩者必須分得出來。 */
  readonly emailMasked: string | null
  readonly addressMasked: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** 列表查詢的一頁結果。**不含總頁數**（§1.4）：兩個數字並存時前端沒有依據判斷該信哪一個。 */
export type EmployeeListPage = {
  readonly items: readonly EmployeeListItem[]
  readonly totalCount: number
}

/** 排序條件。`field` 是 API 對外欄位名（camelCase），不是資料庫欄位名。 */
export type EmployeeSortOption = {
  readonly field: string
  readonly order: 'asc' | 'desc'
}

/**
 * 列表查詢條件。
 *
 * `keyword` 用 `null` 而不是選填欄位表示「沒有這個條件」：`exactOptionalPropertyTypes` 之下，
 * 「沒有這個欄位」與「欄位是 undefined」是兩件事，讓它在跨層傳遞時只有一種形狀，
 * 下游就不必為兩種寫法各寫一次判斷。
 *
 * **`keyword` 只比對 `name` 與 `employee_code`**：其餘欄位都是密文，而密文的每一次寫入
 * 都用不同的 IV，同一個明文的位元組每次都不一樣——`LIKE` 在上面連完全相符都比不出來，
 * 更不用說前綴比對。這不是「暫時還沒做」，是加密欄位的固有性質。
 */
export type EmployeeListQuery = {
  readonly keyword: string | null
  readonly perPage: number
  readonly currentPage: number
  readonly sort: EmployeeSortOption
}

/**
 * 建立與修改共用的資料欄位（**寫入方向，帶明文**）。
 *
 * 明文只存在於這個方向：由 handler 收下、由 repository 加密後寫入，**中間不落地、不進 log**（§5.1）。
 */
export type EmployeeProfileInput = {
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  /** 身分證字號。寫入前由 `normalizeIdentityNumber` 正規化，見 `employee-identity.ts`。 */
  readonly identityNumber: string
  /** 出生年月日 `YYYY-MM-DD`，台北的日曆日，不帶時區標記（§6.1）。 */
  readonly birthday: string
  readonly phone: string
  /** 選填。`null` ＝ 沒填，會把資料庫欄位寫成 NULL。 */
  readonly email: string | null
  readonly address: string
}

export type CreateEmployeeInput = EmployeeProfileInput

/**
 * 修改員工。
 *
 * **含 `employeeCode`**：與 `roles` 不同，員工編號依規格是**可以修改**的
 * （資料字典：「可修改，修改前後須留稽核紀錄」），只是不得與同公司其他員工重複。
 */
export type UpdateEmployeeInput = { readonly id: string } & EmployeeProfileInput

/** 只帶識別碼的動作輸入（`get`／`delete`）。 */
export type EmployeeTargetInput = {
  readonly id: string
}

/** `delete` 的回傳。只回 `id`：刪掉之後沒有「變更後的完整資源」可回。 */
export type DeletedEmployee = {
  readonly id: string
}
