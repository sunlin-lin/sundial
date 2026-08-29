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
export type {
  CompanyUserStatusValue,
  EmploymentStatusValue,
  EmploymentTypeCodeValue,
  GenderValue,
} from '../../../../db/schema/index.ts'

import type {
  CompanyUserStatusValue,
  EmploymentStatusValue,
  EmploymentTypeCodeValue,
  GenderValue,
} from '../../../../db/schema/index.ts'

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
  /**
   * 目前有效部門名稱（UI 定案 `docs/ui/20-employee-list.md` §1「部門」欄）。
   *
   * 依附於下面「目前任職」（見 `employmentStatus` 的檔頭）：查那筆任職在今天生效中的部門歷史。
   * `null` 代表這位員工從未建立任職、或目前任職沒有生效中的部門歸屬。
   */
  readonly departmentName: string | null
  /**
   * 「目前任職」的僱用類型代碼（UI 定案 §1「僱用類型」欄）。`null` = 從未建立任職。
   *
   * **「目前任職」的定義是「到職日最新的一筆任職紀錄，不論在職或離職」**，不是「狀態＝ACTIVE的
   * 那一筆」：UI 同時要求顯示離職員工的到職日與任職狀態（§1「到職日」「任職狀態」兩欄），
   * 若只認 ACTIVE，離職員工這幾欄會全部變成 `null`，而清單明顯還是要顯示他最後一次任職的資訊。
   * `uq_employee_employments_employee_hire_date` 保證同一員工的未刪除任職紀錄到職日不重複，
   * 「到職日最新」因此沒有平手的疑慮（見 `impl/employees-main.list.repository.ts`）。
   */
  readonly employmentTypeCode: EmploymentTypeCodeValue | null
  /** 「目前任職」的到職日期（UI 定案 §1「到職日」欄）。`null` = 從未建立任職。 */
  readonly hireDate: string | null
  /** 「目前任職」的狀態，在職或離職（UI 定案 §1「任職狀態」欄）。`null` = 從未建立任職。 */
  readonly employmentStatus: EmploymentStatusValue | null
  /**
   * 登入帳號狀態（UI 定案 §1「帳號狀態」欄）。`null` = 這位員工沒有登入帳號
   * ——目前只有透過 `employees/onboarding` 建立的員工才會有帳號。
   */
  readonly accountStatus: CompanyUserStatusValue | null
}

/**
 * 單筆員工的完整內容。`get`／`create`／`update` 共用同一個形狀。敏感欄位一律已遮罩。
 *
 * **含 `companyUserId`**（UI 定案 `docs/ui/20-employee-list.md` §3.5：明細頁要管理這位員工的
 * 登入帳號與角色，前端得先知道 `companyUserId` 才問得下去——目前系統裡沒有任何一支對外端點能由
 * `employeeId` 反查它）。之所以放進這個三支端點共用的型別，而不是只加在 `get` 專用的型別上，
 * 是因為 `apps/web` 的員工明細頁把 `get` 與 `update` 的回應當成**同一個**「目前這位員工」狀態
 * ——`update` 成功後會直接拿它的回應覆蓋畫面上的員工物件（見
 * `apps/web/src/pages/employees/detail/employees-detail.view.ts` 的 `EmployeeSummary`
 * 型別，逐字等於 `get` 的回應型別）。若只有 `get` 帶這一欄，`update` 回應覆蓋回去的那一刻，
 * 這個欄位就會在畫面狀態裡消失——這正是「契約擴充前要先檢查消費端」這條規則要擋的事。
 * 查詢作法見 `impl/employees-main.find.repository.ts` 檔頭。
 */
export type EmployeeDetail = EmployeeSummary & {
  readonly birthdayMasked: string
  readonly phoneMasked: string
  /** `null` 代表沒填 Email，不是「填了但看不到」——兩者必須分得出來。 */
  readonly emailMasked: string | null
  readonly addressMasked: string
  readonly createdAt: string
  readonly updatedAt: string
  /** `null` 代表這位員工目前沒有有效的登入帳號（尚未透過 onboarding 建立帳號，或帳號已停用）。 */
  readonly companyUserId: string | null
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
 * **`keyword` 只比對 `name` 與 `employee_code`**：身分證等其餘個資欄位刻意不開放模糊搜尋
 * ——開放的話等於讓任何有清單查詢權限的人用片段反查是哪一位員工，這是業務規則的選擇，
 * 與欄位是否加密無關（理由見 `impl/employees-main.list.repository.ts` 的 `buildConditions`）。
 */
export type EmployeeListQuery = {
  readonly keyword: string | null
  /** 部門篩選（UI 定案 §1 查詢條件「部門」）。比對的是「目前有效部門」，`null` = 不篩選。 */
  readonly departmentId: string | null
  /** 任職狀態篩選（UI 定案 §1 查詢條件「任職狀態」）。比對的是「目前任職」的狀態，`null` = 不篩選。 */
  readonly employmentStatus: EmploymentStatusValue | null
  /** 帳號狀態篩選（UI 定案 §1 查詢條件「帳號狀態」）。`null` = 不篩選。 */
  readonly accountStatus: CompanyUserStatusValue | null
  readonly perPage: number
  readonly currentPage: number
  readonly sort: EmployeeSortOption
}

/**
 * 員工的個資欄位，**全量、帶明文**。
 *
 * **這是建立用的輸入形狀，也是稽核前後快照的形狀**（`AUDIT_FIELD_POLICY.employees.source`
 * 逐字指到這個型別，見 `modules/audit/main/domain/audit-field-policy.ts`）——因此**這個型別本身
 * 不能為了「修改可以省略敏感欄位」而把任何欄位改成選填**，改了會讓稽核政策掃描器
 * （`check:audit-policy`）找不到這幾欄對應的分類，掃描直接失敗。
 *
 * **`update` 端點的請求 body 改用 {@link EmployeeProfileUpdateInput}（見下）**，不是這個型別：
 * `updateEmployeeInTransaction` 會把使用者省略的欄位由目前值補齊，湊回一份完整的
 * `EmployeeProfileInput` 才交給稽核比對——稽核政策因此完全不必知道「這次請求省略了什麼」，
 * 它比對的永遠是兩份同形的完整快照。
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
 * 修改員工用的個資輸入。
 *
 * **與 {@link EmployeeProfileInput} 不同：身分證、生日、手機、地址四個加密儲存欄位改成選填，
 * 省略＝不變更目前值**（定案：`get` 回的這幾欄是遮罩值，要求連同它們一起全量送出，等於逼前端
 * 把身分證明文重新顯示、重新輸入一次才能單獨改一個姓名或電話——這不只是難用，更是安全上的退步：
 * 它讓身分證明文更頻繁地出現在畫面上與傳輸中。這四欄可以安全地採「省略＝不變更」，是因為它們
 * **沒有「清空」這個合法操作**（身分證不能被清成空的），省略的意涵因此沒有歧義。
 * 完整的寫入行為見 `impl/employees-main.update-profile.repository.ts` 檔頭。
 *
 * **`email` 刻意不在此列，維持 `EmployeeProfileInput` 原本的必填 `string | null`**：Email 本來就有
 * 「送空值＝清空」這個合法操作（它是選填欄位，`null` 代表沒填），這個語意在建立時就已經定義過。
 * 若讓它在 `update` 上再疊一層「省略＝不變更」，同一個「body 沒有這個欄位」的動作在不同欄位上
 * 會有不同解讀——一種是「不變更」、一種是「清空」——那是使用者與下一個維護者都要額外記住的特例，
 * 不是一致的規則。**只有加密欄位適用「省略＝不變更」**，其餘欄位（含 email、姓名、性別）維持
 * 原本的完整取代語意。
 *
 * **只用在 request 輸入端。** 稽核比對前，`updateEmployeeInTransaction` 一律把它還原成完整的
 * {@link EmployeeProfileInput}（省略的欄位補回目前值），因此稽核欄位政策
 * （`AUDIT_FIELD_POLICY.employees.source`）仍然只需要認得 `EmployeeProfileInput` 一種形狀，
 * 不必為 `update` 另開一份政策，也不會因為這裡新增了選填欄位而被 `check:audit-policy` 判定
 * 「型別多了欄位、政策沒跟上」。
 */
export type EmployeeProfileUpdateInput = {
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  readonly identityNumber?: string
  readonly birthday?: string
  readonly phone?: string
  readonly email: string | null
  readonly address?: string
}

/**
 * 修改員工。
 *
 * **含 `employeeCode`**：與 `roles` 不同，員工編號依規格是**可以修改**的
 * （資料字典：「可修改，修改前後須留稽核紀錄」），只是不得與同公司其他員工重複。
 */
export type UpdateEmployeeInput = { readonly id: string } & EmployeeProfileUpdateInput

/** 只帶識別碼的動作輸入（`get`／`delete`）。 */
export type EmployeeTargetInput = {
  readonly id: string
}

/** `delete` 的回傳。只回 `id`：刪掉之後沒有「變更後的完整資源」可回。 */
export type DeletedEmployee = {
  readonly id: string
}
