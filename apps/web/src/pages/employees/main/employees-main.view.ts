/**
 * 員工清單：API 列 → 表格顯示列（前端規範 §1.3 第 (1) 類，§0.5 的 `.view.ts`）。
 *
 * **這一頁的顯示欄位受限於後端目前的回應形狀**（見 `.page.vue` 檔頭的說明）：UI 定案
 * `docs/ui/20-employee-list.md` §1 列了「部門」「僱用類型」「到職日」「任職狀態」「帳號狀態」
 * 五個欄位，但 `POST /employees/main/list` 的回應（`employees-main.routes.ts` 的
 * `EmployeeSummarySchema`）只有 `id`／`employeeCode`／`name`／`gender`／`identityNumberMasked`／
 * `jobTitleName` 六欄——沒有任何一個查詢或關聯能在不新增端點的情況下補齊那五欄。
 * 本檔只組裝「後端真的給得出來」的欄位，其餘留白由 `.page.vue` 的表格結構決定（不虛構欄位）。
 */
import type { EmployeesMainListData } from '../../../api/generated/api-client.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import { genderLabel } from '../../../shared/employees/gender.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 列表單筆 API 原始形狀（由產生型別推導，§3.2）。 */
export type EmployeeListItem = EmployeesMainListData['data'][number]

/** 表格實際渲染的列——模板只讀這裡算好的字串，不在模板內做任何換算（§1.4）。 */
export type EmployeeDisplayRow = {
  readonly id: string
  readonly employeeCode: string
  readonly name: string
  readonly genderLabel: string
  /** 目前有效職稱；`null` 代表這位員工目前沒有設定職稱，不是查詢失敗（見後端 schema 註解）。 */
  readonly jobTitleName: string
}

// 回傳型別刻意**不加 `readonly`**：`ElTable` 的 `data` prop 要的是可變陣列型別，這裡的陣列
// 送進表格之後不會再被改動，但硬標 `readonly` 只會讓 `:data="rows"` 在 `vue-tsc` 上報型別不符
// （`regulatory-sync.page.vue` 的 `toDisplayRows` 是同一個處置，理由同構）。
export const toDisplayRows = (items: readonly EmployeeListItem[], translate: TranslateMessage): EmployeeDisplayRow[] =>
  items.map((item) => ({
    id: item.id,
    employeeCode: item.employeeCode,
    name: item.name,
    genderLabel: genderLabel(item.gender, translate),
    jobTitleName: item.jobTitleName ?? EMPTY_DISPLAY,
  }))
