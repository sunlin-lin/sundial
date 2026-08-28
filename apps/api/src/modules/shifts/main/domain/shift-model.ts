/**
 * 班別主檔的業務型別（service ↔ repository 之間傳遞的形狀）。
 *
 * 這一組型別**刻意不等於 Drizzle 的 row，也不等於端點的 `data`**（§1.8.0 的三種形狀）：
 * 三者共用同一個型別時，資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變
 * ——那是個資外洩最常見的路徑（§2）。
 *
 * **`isOvernight`／`requiredWorkMinutes`／每個時段的 `workMinutes`／每段休息的 `breakMinutes`
 * 一律不出現在「輸入」方向的型別上**（計畫 §4.1、§5.2，已定案）：它們是推導值，由 service 在
 * `domain/shift-validation.ts` 算出，request 一路到這裡都不曾攜帶這四種值。
 *
 * 本目錄一律零 IO：這裡只有型別與純函式，沒有任何資料庫或 http 相依（§0.1、§3.1.1）。
 */

/**
 * 工時管理方式代碼，`1 | 2 | 3 | 4` 的聯集字面值。
 *
 * **以 type-only import 沿用 `db/schema/shift-definitions.ts` 的定義**，不在這裡另抄一份：
 * 抄一份就是第二份真相，兩邊哪天不一致不會有任何地方變紅。type-only import 在編譯後完全消失，
 * 因此 domain 仍然不帶任何執行期相依（`verbatimModuleSyntax`）。
 */
export type { ShiftWorkTypeValue } from '../../../../db/schema/index.ts'

import type { ShiftWorkTypeValue } from '../../../../db/schema/index.ts'

/**
 * 工作時段（輸入方向）：呼叫端只送起訖時間與日偏移，**沒有 `workMinutes`**（計畫 §4.1）。
 * API 的時刻是 `HH:mm`（後端規範 §6.1），由路由層驗過格式後傳到這裡。
 */
export type ShiftWorkPeriodInput = {
  readonly sequenceNo: number
  readonly startTime: string
  readonly endTime: string
  readonly endDayOffset: number
}

/** 工作時段（輸出方向）：`workMinutes` 由 `domain/shift-validation.ts` 算出後附加。 */
export type ShiftWorkPeriod = ShiftWorkPeriodInput & {
  readonly workMinutes: number
}

/**
 * 休息時段（輸入方向）：**沒有 `breakMinutes`**（計畫 §4.1）。含 `startDayOffset`／`endDayOffset`
 * 兩欄（計畫 §4.2 對資料字典的唯一增補），否則跨日班的休息分不出是開始前還是開始後。
 */
export type ShiftBreakInput = {
  readonly sequenceNo: number
  readonly startTime: string
  readonly endTime: string
  readonly startDayOffset: number
  readonly endDayOffset: number
  readonly isPaid: boolean
}

/** 休息時段（輸出方向）：`breakMinutes` 由 `domain/shift-validation.ts` 算出後附加。 */
export type ShiftBreak = ShiftBreakInput & {
  readonly breakMinutes: number
}

/**
 * 列表單筆。
 *
 * **含完整的工作時段與休息時段**，與 `employees`／`roles` 的列表單筆（只挑清單需要的少數欄位）
 * 不同：UI 定案（`docs/ui/22-ui-shift-settings.md`）明列列表要顯示「工作時段、休息時段」兩欄，
 * 不是只顯示彙總數字。兩張子表都很小（一個班別頂多幾段），一次撈完不像 `employees` 的加密欄位
 * 那樣有解密成本，因此這裡不比照員工清單省欄位。
 */
export type ShiftSummary = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly workTypeCode: ShiftWorkTypeValue
  /** 推導值（計畫 §4.1）：任一工作時段的 `endDayOffset > 0`。 */
  readonly isOvernight: boolean
  readonly isFlexible: boolean
  /** 推導值（計畫 §4.1）：工作時段分鐘總和 － 無薪休息分鐘總和。 */
  readonly requiredWorkMinutes: number
  readonly isActive: boolean
  readonly workPeriods: readonly ShiftWorkPeriod[]
  readonly breaks: readonly ShiftBreak[]
}

/** 單筆班別的完整內容。`get`／`create`／`update`／`copy` 共用同一個形狀。 */
export type ShiftDetail = ShiftSummary & {
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** 列表查詢的一頁結果。**不含總頁數**（§1.4）：兩個數字並存時前端沒有依據判斷該信哪一個。 */
export type ShiftListPage = {
  readonly items: readonly ShiftSummary[]
  readonly totalCount: number
}

/** 排序條件。`field` 是 API 對外欄位名（camelCase），不是資料庫欄位名。 */
export type ShiftSortOption = {
  readonly field: string
  readonly order: 'asc' | 'desc'
}

/**
 * 列表查詢條件。
 *
 * 選填條件一律用 `null` 而不是選填欄位表示「沒有這個條件」：`exactOptionalPropertyTypes` 之下，
 * 「沒有這個欄位」與「欄位是 undefined」是兩件事，讓它在跨層傳遞時只有一種形狀。
 *
 * `isActive` **預設不是 `null`，而是由 handler 補上 `true`**（UI 定案：「預設顯示啟用班別」）：
 * 這裡的型別仍然是 `boolean | null`，因為使用者可以明確要求「只看停用」或「不篩選狀態」，
 * 「沒有帶這個條件」與「預設值是什麼」是兩個決定，後者屬於 handler（見該檔的說明）。
 */
export type ShiftListQuery = {
  readonly keyword: string | null
  readonly workTypeCode: ShiftWorkTypeValue | null
  readonly isOvernight: boolean | null
  readonly isFlexible: boolean | null
  readonly isActive: boolean | null
  readonly perPage: number
  readonly currentPage: number
  readonly sort: ShiftSortOption
}

/** 建立與修改共用的基本欄位。 */
export type ShiftProfileInput = {
  readonly code: string
  readonly name: string
  readonly workTypeCode: ShiftWorkTypeValue
  readonly isFlexible: boolean
  /** 非空字串（計畫 §10，已定案）：DB 是 NOT NULL，但空字串通得過 NOT NULL，因此驗證放在 service。 */
  readonly description: string
  readonly isActive: boolean
  readonly workPeriods: readonly ShiftWorkPeriodInput[]
  readonly breaks: readonly ShiftBreakInput[]
}

export type CreateShiftInput = ShiftProfileInput

export type UpdateShiftInput = ShiftProfileInput & {
  readonly id: string
}

/**
 * 複製班別（計畫 §7、§10）。
 *
 * **沒有 `workTypeCode`／`isFlexible`／`workPeriods`／`breaks`**：這些是「內容」，計畫 §7 明文
 * 「內容複製自來源班別」，因此一律取自來源，呼叫端送了也不會被採用（request schema 上根本沒有
 * 這幾個欄位，理由與推導值不收同一件事——收了就要處理「送來的與來源不一樣」該以哪邊為準）。
 *
 * **有 `code`／`name`／`description`／`isActive`**：複製的目的是「停用舊的、複製建立新的」
 * （計畫 §7），新班別必須有自己的代碼（唯一鍵）；`description` 依計畫 §10 的定案必須非空，
 * 而「這一份跟來源差在哪裡」正是半年後分辨這批相似班別唯一的依據，因此複製時要求呼叫端
 * **重新填寫**說明，而不是連說明一起原樣複製過去。
 */
export type CopyShiftInput = {
  readonly sourceId: string
  readonly code: string
  readonly name: string
  readonly description: string
  readonly isActive: boolean
}

/** 只帶識別碼的動作輸入（`get`／`delete`）。 */
export type ShiftTargetInput = {
  readonly id: string
}

/** `delete` 的回傳。只回 `id`：刪掉之後沒有「變更後的完整資源」可回。 */
export type DeletedShift = {
  readonly id: string
}
