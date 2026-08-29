import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { statusPresentation, toDisplayRows, workTypeLabel, yesNoLabel, type ShiftRow } from './shifts-main.view.ts'

const echoTranslate: TranslateMessage = (key) => key

/** 一列班別。只有要斷言的欄位由參數帶入，其餘固定——斷言才不會被無關欄位淹掉。 */
const buildRow = (overrides: Partial<ShiftRow> = {}): ShiftRow => ({
  id: 'shift-1',
  code: 'NIGHT',
  name: '夜班',
  workTypeCode: 1,
  isOvernight: true,
  isFlexible: false,
  requiredWorkMinutes: 420,
  isActive: true,
  workPeriods: [{ sequenceNo: 1, startTime: '22:00', endTime: '06:00', endDayOffset: 1, workMinutes: 480 }],
  breaks: [
    {
      sequenceNo: 1,
      startTime: '02:00',
      endTime: '03:00',
      startDayOffset: 1,
      endDayOffset: 1,
      breakMinutes: 60,
      isPaid: false,
    },
  ],
  ...overrides,
})

describe('工時管理方式的文字', () => {
  test('四個代碼各自對到一句話（計畫 §5.1、§10：值固定為 1–4）', () => {
    expect(workTypeLabel(1, echoTranslate)).toBe('shifts-main.work-type.1')
    expect(workTypeLabel(4, echoTranslate)).toBe('shifts-main.work-type.4')
  })
})

describe('是／否', () => {
  test('true 是「是」，false 是「否」——不是裸布林（§9.1）', () => {
    expect(yesNoLabel(true, echoTranslate)).toBe('shifts-main.yes')
    expect(yesNoLabel(false, echoTranslate)).toBe('shifts-main.no')
  })
})

describe('啟用／停用的呈現', () => {
  test('啟用是 success 色調', () => {
    expect(statusPresentation(true)).toEqual({
      labelKey: 'shifts-main.status.active',
      tone: 'success',
      effect: 'light',
    })
  })

  test('停用是 info 色調——不是危險色，停用是正常操作不是錯誤', () => {
    expect(statusPresentation(false)).toEqual({
      labelKey: 'shifts-main.status.inactive',
      tone: 'info',
      effect: 'light',
    })
  })
})

describe('表格的列怎麼組', () => {
  test('計畫 04 驗收案例：跨日班的必要工時顯示 7.0 小時，工作時段顯示「隔日 06:00」', () => {
    const [row] = toDisplayRows([buildRow()], echoTranslate)
    expect(row?.requiredHours).toBe('7.0 shifts-main.unit.hours')
    expect(row?.workPeriods).toBe('22:00–shifts-main.day-offset.next 06:00')
    expect(row?.breaks).toBe(
      'shifts-main.day-offset.next 02:00–shifts-main.day-offset.next 03:00（shifts-main.break.unpaid）',
    )
    expect(row?.overnight).toBe('shifts-main.yes')
  })

  test('中空班：兩段工作時段各自一行', () => {
    const row = buildRow({
      isOvernight: false,
      workPeriods: [
        { sequenceNo: 1, startTime: '09:00', endTime: '12:00', endDayOffset: 0, workMinutes: 180 },
        { sequenceNo: 2, startTime: '14:00', endTime: '18:00', endDayOffset: 0, workMinutes: 240 },
      ],
      breaks: [],
    })
    const [displayRow] = toDisplayRows([row], echoTranslate)
    expect(displayRow?.workPeriods).toBe('09:00–12:00\n14:00–18:00')
    expect(displayRow?.breaks).toBe('—')
    expect(displayRow?.overnight).toBe('shifts-main.no')
  })

  test('原始 isActive 保留在顯示列上，供 `.actions.ts` 判斷要顯示「啟用」還是「停用」鈕', () => {
    const [row] = toDisplayRows([buildRow({ isActive: false })], echoTranslate)
    expect(row?.isActive).toBe(false)
    expect(row?.statusLabel).toBe('shifts-main.status.inactive')
  })

  test('空清單組出空清單', () => {
    expect(toDisplayRows([], echoTranslate)).toEqual([])
  })
})
