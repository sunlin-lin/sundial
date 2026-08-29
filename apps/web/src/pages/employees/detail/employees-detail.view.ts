/**
 * 呈現決策：字典下拉的資料整形、代碼轉文字、期間是否為目前生效（前端規範 §1.3 第 (1)／(2) 類，
 * §0.5 的 `.view.ts`）。
 *
 * **僱用類型／扣繳方式的代碼字典、以及「只顯示啟用中職稱職務」的 `activeOnly`，與
 * `employees/onboarding` 那一份逐欄相同，這裡刻意再寫一份，不是漏改成 import。**
 * §1.5 的判準是「兩個以上頁面實際共用時才移入 `shared/`」——這確實是第二個使用者，
 * 移過去在規則上說得通；但把它搬進 `shared/` 同時要去動 `employees/onboarding` 那一頁
 * （改 import 路徑、重跑它的測試），而那一頁在計畫的前一段已經收尾、不在本段的修改範圍內。
 * 本輪選擇先重複這一小段（僱用類型 8 個字面值、扣繳方式 2 個字面值、`activeOnly` 三行），
 * 把「要不要搬進 `shared/`、順便搬哪幾支」留給下一次同時碰兩頁的人一起決定，
 * 不在本段動另一頁沒被要求變動的檔案（見交付報告）。
 */
import type {
  DepartmentsMainTreeData,
  EmployeesMainGetData,
  EmploymentsMainListData,
  JobTitlesMainListData,
} from '../../../api/generated/api-client.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type { MessageKey } from '../../../shared/i18n/messages.ts'
import type { EmploymentTypeCodeValue, WithholdingMethodCodeValue } from './employees-detail.payload.ts'

/** `employees.main.get` 查得到的那一筆（`null` 是「查無此人」，由呼叫端另外處理，這裡只管有值的形狀）。 */
export type EmployeeSummary = NonNullable<EmployeesMainGetData>

/** `emailMasked` 是選填欄位、可能是 `null`（員工沒有留 Email）；空值呈現交給這裡，不留在模板內判斷（§1.4）。 */
export const emailMaskedDisplay = (employee: EmployeeSummary): string => employee.emailMasked ?? EMPTY_DISPLAY

/** 部門樹的一個節點；`ElTreeSelect` 直接吃這個形狀。 */
export type DepartmentTreeNode = DepartmentsMainTreeData[number]

/** 職稱／職務清單的一筆。兩個端點的回應形狀逐欄相同，共用同一個型別別名（理由同 onboarding）。 */
export type JobDictionaryItem = JobTitlesMainListData['data'][number]

/** 只留啟用中的項目（理由同 `employees/onboarding` 的 `activeOnly`：list 端點沒有 `status` 篩選）。 */
export const activeOnly = <T extends { readonly status: 'ACTIVE' | 'INACTIVE' }>(items: readonly T[]): readonly T[] =>
  items.filter((item) => item.status === 'ACTIVE')

/** 任職清單單筆（由產生型別推導）。 */
export type EmploymentItem = EmploymentsMainListData['data'][number]

/** 僱用類型代碼與對應文字 key，值域對齊後端 `EmploymentTypeCodeSchema`（1–8）。 */
export const EMPLOYMENT_TYPE_LABEL_KEY: Record<EmploymentTypeCodeValue, MessageKey> = {
  1: 'employees-onboarding.employment-type.1',
  2: 'employees-onboarding.employment-type.2',
  3: 'employees-onboarding.employment-type.3',
  4: 'employees-onboarding.employment-type.4',
  5: 'employees-onboarding.employment-type.5',
  6: 'employees-onboarding.employment-type.6',
  7: 'employees-onboarding.employment-type.7',
  8: 'employees-onboarding.employment-type.8',
}

// 沿用新增員工那一頁既有的文案 key（`employees-onboarding.employment-type.*`）：兩頁講的是同一組
// 代碼字典，文字沒有理由分開翻譯兩次；語系檔因此不新增第二組同義 key。
export const EMPLOYMENT_TYPE_CODES: readonly EmploymentTypeCodeValue[] = [1, 2, 3, 4, 5, 6, 7, 8]

export const employmentTypeLabel = (code: EmploymentTypeCodeValue, translate: (key: MessageKey) => string): string =>
  translate(EMPLOYMENT_TYPE_LABEL_KEY[code])

/** 扣繳方式代碼與對應文字 key，同樣沿用 `employees-onboarding.withholding-method.*` 既有文案。 */
export const WITHHOLDING_METHOD_LABEL_KEY: Record<WithholdingMethodCodeValue, MessageKey> = {
  1: 'employees-onboarding.withholding-method.1',
  2: 'employees-onboarding.withholding-method.2',
}

export const WITHHOLDING_METHOD_CODES: readonly WithholdingMethodCodeValue[] = [1, 2]

export const withholdingMethodLabel = (
  code: WithholdingMethodCodeValue,
  translate: (key: MessageKey) => string,
): string => translate(WITHHOLDING_METHOD_LABEL_KEY[code])

/** 任職狀態的文字 key。 */
const EMPLOYMENT_STATUS_LABEL_KEY = {
  ACTIVE: 'employees-detail.employment-status.active',
  LEFT: 'employees-detail.employment-status.left',
} as const satisfies Record<EmploymentItem['status'], MessageKey>

export const employmentStatusLabel = (
  status: EmploymentItem['status'],
  translate: (key: MessageKey) => string,
): string => translate(EMPLOYMENT_STATUS_LABEL_KEY[status])

/** `ElTag` 的 `type`：在職給預設（藍）、離職給資訊（灰），不用紅色——離職是正常的業務狀態，不是錯誤。 */
export const employmentStatusTagType = (status: EmploymentItem['status']): 'success' | 'info' =>
  status === 'ACTIVE' ? 'success' : 'info'

/**
 * 任職性質／離職原因代碼：後端 `OpenCode`（§後端 `employments-main.routes.ts`）是字典未列舉值、
 * 開放任意正整數，前端沒有字典可以查文字，只能原樣顯示數字（`null` 顯示 `EMPTY_DISPLAY`）。
 */
export const formatOpenCode = (value: number | null): string => (value === null ? EMPTY_DISPLAY : String(value))

/**
 * 這一筆期間紀錄（部門／職稱／職務／扣繳歷史共用同一種「生效期間」形狀）在 `today` 這一天
 * 是否為目前生效中：`effectiveFrom <= today`，且 `effectiveTo` 為 `null`（尚未訂結束日）或
 * `today <= effectiveTo`。
 *
 * 三個欄位都是 `YYYY-MM-DD` 的業務日期字串（後端規範 §6.1），逐字典序比較與時間序比較結果相同，
 * 不需要經過 `Date`（§9.2：顯示與比較邏輯一律不經過 `Date` 物件）。`today` 由呼叫端傳入
 * （`shared/format/business-clock.ts` 的 `todayInTaipei()`），本函式本身是純函式、可以逐格測。
 */
export const isCurrentlyEffective = (effectiveFrom: string, effectiveTo: string | null, today: string): boolean =>
  effectiveFrom <= today && (effectiveTo === null || today <= effectiveTo)
