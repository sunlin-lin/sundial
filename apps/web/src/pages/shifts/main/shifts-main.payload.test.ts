import { describe, expect, test } from 'bun:test'
import {
  defaultShiftListFilters,
  emptyCopyFormState,
  emptyShiftFormState,
  SHIFT_LIST_PER_PAGE,
  toFormStateFromDetail,
  toShiftCopyPayload,
  toShiftCreatePayload,
  toShiftListQuery,
  toShiftUpdatePayload,
  type ShiftDetail,
  type ShiftFormState,
} from './shifts-main.payload.ts'

/** 一筆班別明細。只有要斷言的欄位由參數帶入，其餘固定。 */
const buildDetail = (overrides: Partial<ShiftDetail> = {}): ShiftDetail => ({
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
  description: '夜班說明',
  createdAt: '2026-01-01 09:00:00',
  updatedAt: '2026-01-01 09:00:00',
  ...overrides,
})

describe('列表查詢', () => {
  test('預設篩選只帶分頁與排序——三態全部是「全部」、狀態是「啟用」時不送對應欄位', () => {
    const query = toShiftListQuery(defaultShiftListFilters(), 1)
    expect(query).toEqual({
      isActive: true,
      currentPage: 1,
      perPage: SHIFT_LIST_PER_PAGE,
      sort: { field: 'code', order: 'asc' },
    })
  })

  test('關鍵字去除頭尾空白後才送出，全空白視為沒有條件', () => {
    expect(toShiftListQuery({ ...defaultShiftListFilters(), keyword: '  night  ' }, 1).keyword).toBe('night')
    expect(toShiftListQuery({ ...defaultShiftListFilters(), keyword: '   ' }, 1)).not.toHaveProperty('keyword')
  })

  test('工作類型選「全部」（0）時不帶 workTypeCode，選特定代碼時帶出去', () => {
    expect(toShiftListQuery(defaultShiftListFilters(), 1)).not.toHaveProperty('workTypeCode')
    expect(toShiftListQuery({ ...defaultShiftListFilters(), workTypeCode: 2 }, 1).workTypeCode).toBe(2)
  })

  test('狀態選「全部」時不送 isActive——不是送 undefined，是整個 key 都不存在', () => {
    const query = toShiftListQuery({ ...defaultShiftListFilters(), status: 'all' }, 1)
    expect(query).not.toHaveProperty('isActive')
  })

  test('跨日／彈性選「是」「否」時各自送對應的布林', () => {
    expect(toShiftListQuery({ ...defaultShiftListFilters(), overnight: 'yes' }, 1).isOvernight).toBe(true)
    expect(toShiftListQuery({ ...defaultShiftListFilters(), overnight: 'no' }, 1).isOvernight).toBe(false)
    expect(toShiftListQuery({ ...defaultShiftListFilters(), flexible: 'yes' }, 1).isFlexible).toBe(true)
  })
})

describe('建立／修改表單：推導值絕對不能出現在送出的 payload 裡（必做事項 1）', () => {
  const form: ShiftFormState = {
    code: 'NIGHT',
    name: '夜班',
    workTypeCode: 1,
    isFlexible: false,
    description: '夜班說明',
    isActive: true,
    workPeriods: [{ startTime: '22:00', endTime: '06:00', endDayOffset: 1 }],
    breaks: [{ startTime: '02:00', endTime: '03:00', startDayOffset: 1, endDayOffset: 1, isPaid: false }],
  }

  test('create 的整個 payload 裡逐字沒有 workMinutes／breakMinutes／isOvernight／requiredWorkMinutes', () => {
    const payload = JSON.stringify(toShiftCreatePayload(form))
    expect(payload).not.toContain('workMinutes')
    expect(payload).not.toContain('breakMinutes')
    expect(payload).not.toContain('isOvernight')
    expect(payload).not.toContain('requiredWorkMinutes')
  })

  test('update 同樣不含推導值，且帶上 id', () => {
    const payload = toShiftUpdatePayload('shift-1', form)
    expect(payload.id).toBe('shift-1')
    expect(JSON.stringify(payload)).not.toContain('requiredWorkMinutes')
  })

  test('sequenceNo 由陣列位置自動編，從 1 起算', () => {
    const twoPeriods: ShiftFormState = {
      ...form,
      workPeriods: [
        { startTime: '09:00', endTime: '12:00', endDayOffset: 0 },
        { startTime: '14:00', endTime: '18:00', endDayOffset: 0 },
      ],
    }
    const payload = toShiftCreatePayload(twoPeriods)
    expect(payload.workPeriods.map((period) => period.sequenceNo)).toEqual([1, 2])
  })

  test('create 的欄位剛好是後端 schema 收的那幾個，一個不多一個不少', () => {
    const payload = toShiftCreatePayload(form)
    expect(Object.keys(payload).sort()).toEqual(
      ['breaks', 'code', 'description', 'isActive', 'isFlexible', 'name', 'workPeriods', 'workTypeCode'].sort(),
    )
  })
})

describe('明細 → 表單值（修改的初始值）', () => {
  test('推導值不會被帶進表單狀態——表單型別上根本沒有這幾個欄位', () => {
    const form = toFormStateFromDetail(buildDetail())
    expect(form).not.toHaveProperty('requiredWorkMinutes')
    expect(form).not.toHaveProperty('isOvernight')
    expect(form.workPeriods[0]).not.toHaveProperty('workMinutes')
    expect(form.breaks[0]).not.toHaveProperty('breakMinutes')
  })

  test('日偏移收斂成表單用的 0｜1，不是原樣帶著 string|number', () => {
    const form = toFormStateFromDetail(buildDetail())
    expect(form.workPeriods[0]?.endDayOffset).toBe(1)
    expect(form.breaks[0]?.startDayOffset).toBe(1)
    expect(form.breaks[0]?.endDayOffset).toBe(1)
  })

  test('往返：明細轉表單再轉回 create payload 的業務欄位值不變', () => {
    const detail = buildDetail()
    const form = toFormStateFromDetail(detail)
    const payload = toShiftCreatePayload(form)
    expect(payload.code).toBe(detail.code)
    expect(payload.workPeriods[0]).toEqual({ sequenceNo: 1, startTime: '22:00', endTime: '06:00', endDayOffset: 1 })
  })
})

describe('新增班別初始值', () => {
  test('預設一段空白時段、無休息、啟用', () => {
    const form = emptyShiftFormState()
    expect(form.workPeriods).toHaveLength(1)
    expect(form.breaks).toHaveLength(0)
    expect(form.isActive).toBe(true)
  })
})

describe('複製表單', () => {
  test('初始值三個欄位一律留白——不帶入來源', () => {
    const form = emptyCopyFormState()
    expect(form.code).toBe('')
    expect(form.name).toBe('')
    expect(form.description).toBe('')
  })

  test('送出的 payload 帶 sourceId，沒有工作類型／彈性／時段／休息（計畫 §7：一律取自來源）', () => {
    const payload = toShiftCopyPayload('source-id', {
      code: 'NIGHT-2',
      name: '夜班（複製）',
      description: '新的說明',
      isActive: true,
    })
    expect(payload).toEqual({
      sourceId: 'source-id',
      code: 'NIGHT-2',
      name: '夜班（複製）',
      description: '新的說明',
      isActive: true,
    })
  })
})
