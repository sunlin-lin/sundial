/**
 * 呈現決策：僱用類型／扣繳方式的文字，以及字典下拉的資料整形（前端規範 §1.3 第 (1)／(2) 類，
 * §0.5 的 `.view.ts`）。
 */
import type {
  DepartmentsMainTreeData,
  JobTitlesMainListData,
  RolesMainListData,
} from '../../../api/generated/api-client.ts'
import type { MessageKey } from '../../../shared/i18n/messages.ts'
import type { EmploymentTypeCodeValue, WithholdingMethodCodeValue } from './employees-onboarding.payload.ts'

/** 部門樹的一個節點（由產生型別推導，§3.2）。`ElTreeSelect` 直接吃這個形狀，不必另外轉形。 */
export type DepartmentTreeNode = DepartmentsMainTreeData[number]

/**
 * 職稱／職務清單的一筆。兩個端點（`job-titles.main.list`／`job-positions.main.list`）的
 * `EmployeeSummarySchema` 逐欄相同（`id`／`isSystem`／`code`／`name`／`description`／`status`／
 * `createdAt`／`updatedAt`），因此共用同一個由職稱端點推導的型別別名，不必為職務再宣告一次。
 */
export type JobDictionaryItem = JobTitlesMainListData['data'][number]
export type RoleDictionaryItem = RolesMainListData['data'][number]

/**
 * 只留啟用中的項目。
 *
 * 兩份字典（職稱、職務）的 `list` request 沒有 `status` 篩選（`job-titles-main.routes.ts`／
 * `job-positions-main.routes.ts` 都只收 `keyword`／`perPage`／`currentPage`），所以「只顯示啟用中」
 * 只能在拿到整批之後於前端過濾——這不是前端另訂規則，單純是後端目前沒有這個查詢條件可用。
 * 停用的職稱／職務仍可能是**既有**員工目前的紀錄，但新增員工不該把新人指派到一個已經停用的項目。
 */
export const activeOnly = <T extends { readonly status: 'ACTIVE' | 'INACTIVE' }>(items: readonly T[]): readonly T[] =>
  items.filter((item) => item.status === 'ACTIVE')

/** 僱用類型代碼與對應文字 key。順序即畫面呈現順序，值域對齊後端 `EmploymentTypeCodeSchema`（1–8）。 */
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

// 字面量陣列而不是由 `EMPLOYMENT_TYPE_LABEL_KEY` 的鍵推回數字：`Object.keys` 一律回傳字串鍵，
// 要轉回數字聯集得經過 `Number(`，而 `pages/` 底下禁止任何數字轉型（`check:number-cast`，
// 理由是金額／代碼型別一旦允許 `Number(`，就擋不住有人在別的欄位上誤用同一個寫法）。
export const EMPLOYMENT_TYPE_CODES: readonly EmploymentTypeCodeValue[] = [1, 2, 3, 4, 5, 6, 7, 8]

export const employmentTypeLabel = (code: EmploymentTypeCodeValue, translate: (key: MessageKey) => string): string =>
  translate(EMPLOYMENT_TYPE_LABEL_KEY[code])

/** 扣繳方式代碼與對應文字 key。值域對齊後端 `employee_withholding_settings.WithholdingMethodCode`。 */
export const WITHHOLDING_METHOD_LABEL_KEY: Record<WithholdingMethodCodeValue, MessageKey> = {
  1: 'employees-onboarding.withholding-method.1',
  2: 'employees-onboarding.withholding-method.2',
}

/** 字面量陣列，理由同 `EMPLOYMENT_TYPE_CODES`（避免 `Number(` 轉型）。 */
export const WITHHOLDING_METHOD_CODES: readonly WithholdingMethodCodeValue[] = [1, 2]

export const withholdingMethodLabel = (
  code: WithholdingMethodCodeValue,
  translate: (key: MessageKey) => string,
): string => translate(WITHHOLDING_METHOD_LABEL_KEY[code])
