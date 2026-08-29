/**
 * 畫面上的條件／表單值 → 送給後端的業務欄位（§1.3 的第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * **推導值不在這裡出現**（必做事項 1）：`sequenceNo` 由陣列順序自動編，`workMinutes`／
 * `breakMinutes`／`isOvernight`／`requiredWorkMinutes` 這幾個後端算出來的值，`toProfileFields`
 * 完全沒有寫出——request schema 本來就沒有這幾格。**表單驗證只做「必填」**（§6.1）：長度與格式
 * 產生型別留不住，硬抄一份門檻數字正是漂移的起點，一律交給後端的 `300` 回應（`.errors.view.ts` 定位）。
 */
import type {
  ShiftsMainCopyInput,
  ShiftsMainCreateInput,
  ShiftsMainGetData,
  ShiftsMainListInput,
  ShiftsMainUpdateInput,
} from '../../../api/generated/api-client.ts'
import { isNextDay } from './shifts-main.day-offset.view.ts'
import type { LocalBreak } from './shifts-main.breaks.view.ts'
import { newWorkPeriod, type LocalWorkPeriod } from './shifts-main.periods.view.ts'
import type { WorkTypeCode } from './shifts-main.view.ts'

/** 單一班別明細（四支端點共用同一個形狀）。由產生型別推導（§3.2）。 */
export type ShiftDetail = NonNullable<ShiftsMainGetData>

/** 三態：後端的 isOvernight／isFlexible 是選填布林，不是三選一欄位。`WorkTypeFilter` 的 `0`＝全部
 * （`ElRadioGroup` 的 `modelValue` 不接受 `null`，見 `.page.vue`）。 */
export type TriState = 'all' | 'yes' | 'no'
export type StatusFilter = 'active' | 'inactive' | 'all'
export type WorkTypeFilter = WorkTypeCode | 0
export type ShiftListFilters = {
  keyword: string
  workTypeCode: WorkTypeFilter
  overnight: TriState
  flexible: TriState
  status: StatusFilter
}

/** 預設篩選：狀態預設「啟用」（UI 定案：列表預設只顯示啟用班別）。 */
export const defaultShiftListFilters = (): ShiftListFilters => ({
  keyword: '',
  workTypeCode: 0,
  overnight: 'all',
  flexible: 'all',
  status: 'active',
})

const triStateToBoolean = (value: TriState): boolean | undefined => (value === 'all' ? undefined : value === 'yes')
const statusToBoolean = (value: StatusFilter): boolean | undefined => (value === 'all' ? undefined : value === 'active')
export type ShiftListQuery = ShiftsMainListInput & { readonly sort: NonNullable<ShiftsMainListInput['sort']> }
export const SHIFT_LIST_PER_PAGE = 20
/** 代碼由小到大：班別代碼通常帶編排意義（早／午／晚班前綴），照代碼排最直覺。 */
export const SHIFT_LIST_SORT = { field: 'code', order: 'asc' } as const

/** 用展開式**省略**沒帶的條件，不是設成 `undefined`——`exactOptionalPropertyTypes` 底下兩者是不同形狀。 */
export const toShiftListQuery = (filters: ShiftListFilters, currentPage: number): ShiftListQuery => {
  const keyword = filters.keyword.trim()
  const isOvernight = triStateToBoolean(filters.overnight)
  const isFlexible = triStateToBoolean(filters.flexible)
  const isActive = statusToBoolean(filters.status)

  return {
    ...(keyword === '' ? {} : { keyword }),
    ...(filters.workTypeCode === 0 ? {} : { workTypeCode: filters.workTypeCode }),
    ...(isOvernight === undefined ? {} : { isOvernight }),
    ...(isFlexible === undefined ? {} : { isFlexible }),
    ...(isActive === undefined ? {} : { isActive }),
    currentPage,
    perPage: SHIFT_LIST_PER_PAGE,
    sort: SHIFT_LIST_SORT,
  }
}

/** 借用 `create` 輸入型別的六個基本欄位，只覆寫時段／休息為本地編輯列形狀（後端改欄位名這裡當場編譯錯誤）。 */
export type ShiftFormState = Omit<ShiftsMainCreateInput, 'workPeriods' | 'breaks'> & {
  workPeriods: LocalWorkPeriod[]
  breaks: LocalBreak[]
}
/** 新增班別初始值：一段空白時段（至少一段）、無休息。 */
export const emptyShiftFormState = (): ShiftFormState => ({
  code: '',
  name: '',
  workTypeCode: 1,
  isFlexible: false,
  description: '',
  isActive: true,
  workPeriods: [newWorkPeriod()],
  breaks: [],
})

/** 明細 → 表單值（修改的初始值）。不帶入推導值；`isNextDay(...)?1:0` 是型別收斂不是數值轉型。 */
export const toFormStateFromDetail = (detail: ShiftDetail): ShiftFormState => ({
  code: detail.code,
  name: detail.name,
  workTypeCode: detail.workTypeCode,
  isFlexible: detail.isFlexible,
  description: detail.description,
  isActive: detail.isActive,
  workPeriods: detail.workPeriods.map((period) => ({
    startTime: period.startTime,
    endTime: period.endTime,
    endDayOffset: isNextDay(period.endDayOffset) ? 1 : 0,
  })),
  breaks: detail.breaks.map((entry) => ({
    startTime: entry.startTime,
    endTime: entry.endTime,
    startDayOffset: isNextDay(entry.startDayOffset) ? 1 : 0,
    endDayOffset: isNextDay(entry.endDayOffset) ? 1 : 0,
    isPaid: entry.isPaid,
  })),
})

/** 表單值 → `create`／`update` 共用欄位。`sequenceNo` 用陣列位置 + 1 自動編。 */
const toProfileFields = (form: ShiftFormState): ShiftsMainCreateInput => ({
  code: form.code,
  name: form.name,
  workTypeCode: form.workTypeCode,
  isFlexible: form.isFlexible,
  description: form.description,
  isActive: form.isActive,
  workPeriods: form.workPeriods.map((period, index) => ({
    sequenceNo: index + 1,
    startTime: period.startTime,
    endTime: period.endTime,
    endDayOffset: period.endDayOffset,
  })),
  breaks: form.breaks.map((entry, index) => ({
    sequenceNo: index + 1,
    startTime: entry.startTime,
    endTime: entry.endTime,
    startDayOffset: entry.startDayOffset,
    endDayOffset: entry.endDayOffset,
    isPaid: entry.isPaid,
  })),
})

export const toShiftCreatePayload = (form: ShiftFormState): ShiftsMainCreateInput => toProfileFields(form)
export const toShiftUpdatePayload = (id: string, form: ShiftFormState): ShiftsMainUpdateInput => ({
  id,
  ...toProfileFields(form),
})
export type CopyFormState = { code: string; name: string; description: string; isActive: boolean }
/** 三個欄位一律留白，不帶入來源：代碼帶入會撞重複，說明帶入會產生兩筆一模一樣的說明。 */
export const emptyCopyFormState = (): CopyFormState => ({ code: '', name: '', description: '', isActive: true })

export const toShiftCopyPayload = (sourceId: string, form: CopyFormState): ShiftsMainCopyInput => ({
  sourceId,
  code: form.code,
  name: form.name,
  description: form.description,
  isActive: form.isActive,
})
