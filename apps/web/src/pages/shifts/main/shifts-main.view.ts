/**
 * 班別清單「一列怎麼組」（§1.3 的第 (1)(2) 類、§0.5 的 `.view.ts`）。
 *
 * 時段與休息各自的呈現邏輯已經按主題拆到 `shifts-main.periods.view.ts`／`shifts-main.breaks.view.ts`
 * （§0.7）；本檔只負責把一整列組起來，以及工作類型、跨日、彈性、狀態這幾個「代碼／布林 → 文字」
 * 的呈現決策。
 *
 * **「使用狀況」這一欄本輪不放**（計畫 04 §8）：沒有任何表引用 `shift_definitions`（排班還沒做），
 * 那一欄只會恆為「未使用」——在畫面上宣告一件現在為真、日後會悄悄變假的事，比不放更糟。
 */
import type { ShiftsMainListData } from '../../../api/generated/api-client.ts'
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'
import { breaksSummaryDisplay } from './shifts-main.breaks.view.ts'
import { requiredWorkHoursDisplay } from './shifts-main.duration.view.ts'
import { periodsSummaryDisplay } from './shifts-main.periods.view.ts'

/** 一列班別（API 形狀）。由產生型別推導，不在前端另寫一份（§3.2）。 */
export type ShiftRow = ShiftsMainListData['data'][number]

/** 工時管理方式代碼。由產生型別推導（§3.2）。 */
export type WorkTypeCode = ShiftRow['workTypeCode']

/** 四個工時管理方式的代碼，供篩選下拉與表單下拉共用（計畫 §5.1、§10：值固定，不會再擴充）。 */
export const WORK_TYPE_CODES: readonly WorkTypeCode[] = [1, 2, 3, 4]

const WORK_TYPE_LABEL_KEYS = {
  1: 'shifts-main.work-type.1',
  2: 'shifts-main.work-type.2',
  3: 'shifts-main.work-type.3',
  4: 'shifts-main.work-type.4',
} as const satisfies Record<WorkTypeCode, MessageKey>

export const workTypeLabel = (code: WorkTypeCode, translate: TranslateMessage): string =>
  translate(WORK_TYPE_LABEL_KEYS[code])

/** 是／否，§9.1 要求文字而不是只有一個布林勾勾。 */
export const yesNoLabel = (value: boolean, translate: TranslateMessage): string =>
  translate(value ? 'shifts-main.yes' : 'shifts-main.no')

/** 啟用／停用的呈現。`tone`／`effect` 與 `shared/regulatory/sync-status.ts` 同一套語意色。 */
export type StatusPresentation = {
  readonly labelKey: MessageKey
  readonly tone: 'success' | 'info'
  readonly effect: 'light'
}

export const statusPresentation = (isActive: boolean): StatusPresentation =>
  isActive
    ? { labelKey: 'shifts-main.status.active', tone: 'success', effect: 'light' }
    : { labelKey: 'shifts-main.status.inactive', tone: 'info', effect: 'light' }

/** 表格實際吃的一列：全部是已經算好的字串（模板不再做任何換算，同 `regulatory-sync.view.ts`）。 */
export type ShiftDisplayRow = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly workType: string
  readonly workPeriods: string
  readonly breaks: string
  readonly requiredHours: string
  readonly overnight: string
  readonly flexible: string
  readonly statusLabel: string
  readonly statusTone: StatusPresentation['tone']
  readonly statusEffect: StatusPresentation['effect']
  /** 原始的啟用狀態：`.actions.ts` 判斷「啟用」還是「停用」鈕要顯示哪一顆要用得到。 */
  readonly isActive: boolean
}

export const toDisplayRows = (rows: readonly ShiftRow[], translate: TranslateMessage): ShiftDisplayRow[] =>
  rows.map((row) => {
    const status = statusPresentation(row.isActive)
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      workType: workTypeLabel(row.workTypeCode, translate),
      workPeriods: periodsSummaryDisplay(row.workPeriods, translate),
      breaks: breaksSummaryDisplay(row.breaks, translate),
      requiredHours: requiredWorkHoursDisplay(row.requiredWorkMinutes, translate),
      overnight: yesNoLabel(row.isOvernight, translate),
      flexible: yesNoLabel(row.isFlexible, translate),
      statusLabel: translate(status.labelKey),
      statusTone: status.tone,
      statusEffect: status.effect,
      isActive: row.isActive,
    }
  })
