/**
 * `shifts/main` 的純函式測試（§7.1）。
 *
 * 這些是**不需要資料庫**的規則：推導值的計算（計畫 §4.1）與時段／休息的結構驗證（計畫 §5.2）。
 * 端點測試（連 MariaDB）驗證的是「這些規則真的被 service 呼叫並回成業務錯誤」，
 * 本檔驗證的是規則本身算得對不對——兩者職責不同，因此分成兩支。
 */
import { describe, expect, test } from 'bun:test'
import { computeShiftDerivedValues, validateShiftStructure } from '../domain/shift-validation.ts'
import { fromDbTime, minuteOfDay, toAbsoluteMinutes, toDbTime } from '../domain/shift-time.ts'
import { DEFAULT_SHIFT_SORT, resolveShiftSort } from '../domain/shift-list-view.ts'
import { ShiftErrorCode } from '../shifts-main.errors.ts'
import type { ShiftBreakInput, ShiftWorkPeriodInput } from '../domain/shift-model.ts'

describe('時間換算', () => {
  test('HH:mm 換算成當日第幾分鐘', () => {
    expect(minuteOfDay('00:00')).toBe(0)
    expect(minuteOfDay('09:00')).toBe(540)
    expect(minuteOfDay('23:59')).toBe(1439)
  })

  test('日偏移換算成絕對分鐘：跨日時段的結束時刻換算後大於開始時刻', () => {
    // 22:00–06:00(+1) 的夜班：換算前 '06:00' < '22:00' 用字串／不含日偏移比大小會算成負的時長，
    // 這正是後端規範 §6.2 明文警告的陷阱；含日偏移換算後必須是正的。
    const startAbs = toAbsoluteMinutes('22:00', 0)
    const endAbs = toAbsoluteMinutes('06:00', 1)
    expect(startAbs).toBe(1320)
    expect(endAbs).toBe(1800)
    expect(endAbs - startAbs).toBe(480)
  })

  test('DB 的 HH:mm:ss 與 API 的 HH:mm 互相轉換', () => {
    expect(toDbTime('09:00')).toBe('09:00:00')
    expect(fromDbTime('09:00:00')).toBe('09:00')
  })
})

describe('列表排序', () => {
  test('沒送 sort 時補上預設值', () => {
    expect(resolveShiftSort(undefined)).toEqual(DEFAULT_SHIFT_SORT)
    expect(DEFAULT_SHIFT_SORT).toEqual({ field: 'code', order: 'asc' })
  })

  test('有送就照送的用', () => {
    expect(resolveShiftSort({ field: 'name', order: 'desc' })).toEqual({ field: 'name', order: 'desc' })
  })
})

/** ★ 驗收案例（計畫 Stage 2）：22:00–06:00 含 02:00–03:00 無薪休息的跨日班。 */
const OVERNIGHT_WORK_PERIODS: readonly ShiftWorkPeriodInput[] = [
  { sequenceNo: 1, startTime: '22:00', endTime: '06:00', endDayOffset: 1 },
]
// 保留單一物件常數（而不是只留陣列再用 `[0]!` 取出）：`noUncheckedIndexedAccess` 下陣列索引
// 一律是 `T | undefined`，用 `!` 繞過會被 ESLint 的 no-non-null-assertion 擋下（通用規範 §4.2）；
// 這裡本來就只有一筆固定測試資料，直接留一份具名參照最單純。
const OVERNIGHT_UNPAID_BREAK_ENTRY: ShiftBreakInput = {
  sequenceNo: 1,
  startTime: '02:00',
  endTime: '03:00',
  startDayOffset: 1,
  endDayOffset: 1,
  isPaid: false,
}
const OVERNIGHT_UNPAID_BREAK: readonly ShiftBreakInput[] = [OVERNIGHT_UNPAID_BREAK_ENTRY]

describe('推導值計算（計畫 §4.1）', () => {
  test('★ 22:00–06:00 含 02:00–03:00 無薪休息：isOvernight=true，requiredWorkMinutes=420', () => {
    expect(validateShiftStructure(OVERNIGHT_WORK_PERIODS, OVERNIGHT_UNPAID_BREAK)).toEqual([])

    const derived = computeShiftDerivedValues(OVERNIGHT_WORK_PERIODS, OVERNIGHT_UNPAID_BREAK)

    expect(derived.isOvernight).toBe(true)
    // 480 分鐘的工作時段 － 60 分鐘無薪休息 = 420。
    expect(derived.requiredWorkMinutes).toBe(420)
    expect(derived.workPeriods[0]?.workMinutes).toBe(480)
    expect(derived.breaks[0]?.breakMinutes).toBe(60)
  })

  test('有薪休息不從應工作分鐘中扣除', () => {
    const derived = computeShiftDerivedValues(OVERNIGHT_WORK_PERIODS, [
      { ...OVERNIGHT_UNPAID_BREAK_ENTRY, isPaid: true },
    ])
    expect(derived.requiredWorkMinutes).toBe(480)
  })

  test('非跨日的一般班：isOvernight=false', () => {
    const derived = computeShiftDerivedValues(
      [{ sequenceNo: 1, startTime: '09:00', endTime: '18:00', endDayOffset: 0 }],
      [],
    )
    expect(derived.isOvernight).toBe(false)
    expect(derived.requiredWorkMinutes).toBe(540)
  })
})

describe('工作時段驗證（計畫 §5.2）', () => {
  test('零段工作時段被擋', () => {
    const errors = validateShiftStructure([], [])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe(ShiftErrorCode.WorkPeriodsEmpty)
  })

  test('工作時段重疊被擋', () => {
    const errors = validateShiftStructure(
      [
        { sequenceNo: 1, startTime: '09:00', endTime: '13:00', endDayOffset: 0 },
        { sequenceNo: 2, startTime: '12:00', endTime: '18:00', endDayOffset: 0 },
      ],
      [],
    )
    expect(errors.some((error) => error.code === ShiftErrorCode.WorkPeriodsOverlap)).toBe(true)
  })

  test('中空班的空檔合法（不重疊，通過驗證）', () => {
    const errors = validateShiftStructure(
      [
        { sequenceNo: 1, startTime: '09:00', endTime: '12:00', endDayOffset: 0 },
        { sequenceNo: 2, startTime: '14:00', endTime: '18:00', endDayOffset: 0 },
      ],
      [],
    )
    expect(errors).toEqual([])
  })

  test('緊鄰但不重疊（結束＝下一段開始）合法', () => {
    const errors = validateShiftStructure(
      [
        { sequenceNo: 1, startTime: '09:00', endTime: '12:00', endDayOffset: 0 },
        { sequenceNo: 2, startTime: '12:00', endTime: '18:00', endDayOffset: 0 },
      ],
      [],
    )
    expect(errors).toEqual([])
  })

  test('跨日時段的重疊也算得出來（換算成絕對分鐘後比較）', () => {
    // 第一段 22:00–06:00(+1)（絕對分鐘 1320–1800），第二段 05:00–09:00(+1)（絕對分鐘 1740–1980）
    // 兩段在 1740–1800 之間重疊。
    const errors = validateShiftStructure(
      [
        { sequenceNo: 1, startTime: '22:00', endTime: '06:00', endDayOffset: 1 },
        { sequenceNo: 2, startTime: '05:00', endTime: '09:00', endDayOffset: 1 },
      ],
      [],
    )
    expect(errors.some((error) => error.code === ShiftErrorCode.WorkPeriodsOverlap)).toBe(true)
  })

  test('工作時段起訖顛倒（忘了設跨日）被擋', () => {
    const errors = validateShiftStructure(
      [{ sequenceNo: 1, startTime: '22:00', endTime: '06:00', endDayOffset: 0 }],
      [],
    )
    expect(errors.some((error) => error.code === ShiftErrorCode.WorkPeriodInvalidRange)).toBe(true)
  })

  test('同一班別內 sequenceNo 重複被擋，不會變成 500', () => {
    const errors = validateShiftStructure(
      [
        { sequenceNo: 1, startTime: '09:00', endTime: '12:00', endDayOffset: 0 },
        { sequenceNo: 1, startTime: '14:00', endTime: '18:00', endDayOffset: 0 },
      ],
      [],
    )
    expect(errors.some((error) => error.code === ShiftErrorCode.WorkPeriodSequenceDuplicated)).toBe(true)
  })
})

describe('休息時段驗證（計畫 §5.2）', () => {
  test('休息落在工作時段外被擋', () => {
    const errors = validateShiftStructure(
      [{ sequenceNo: 1, startTime: '09:00', endTime: '18:00', endDayOffset: 0 }],
      [{ sequenceNo: 1, startTime: '19:00', endTime: '20:00', startDayOffset: 0, endDayOffset: 0, isPaid: false }],
    )
    expect(errors.some((error) => error.code === ShiftErrorCode.BreakOutsideWorkPeriod)).toBe(true)
  })

  test('跨日情況下休息落在工作時段外也擋得住（日偏移填錯，換算後落在工作時段之前）', () => {
    // 休息若誤填 startDayOffset=0／endDayOffset=0（應該是 1），換算成絕對分鐘 120–180，
    // 落在工作時段 1320–1800 之外。
    const errors = validateShiftStructure(OVERNIGHT_WORK_PERIODS, [
      { sequenceNo: 1, startTime: '02:00', endTime: '03:00', startDayOffset: 0, endDayOffset: 0, isPaid: false },
    ])
    expect(errors.some((error) => error.code === ShiftErrorCode.BreakOutsideWorkPeriod)).toBe(true)
  })

  test('休息落在工作時段內（跨日換算後）通過驗證', () => {
    expect(validateShiftStructure(OVERNIGHT_WORK_PERIODS, OVERNIGHT_UNPAID_BREAK)).toEqual([])
  })

  test('同一班別內休息的 sequenceNo 重複被擋', () => {
    const errors = validateShiftStructure(
      [{ sequenceNo: 1, startTime: '09:00', endTime: '18:00', endDayOffset: 0 }],
      [
        { sequenceNo: 1, startTime: '10:00', endTime: '10:30', startDayOffset: 0, endDayOffset: 0, isPaid: true },
        { sequenceNo: 1, startTime: '14:00', endTime: '14:30', startDayOffset: 0, endDayOffset: 0, isPaid: true },
      ],
    )
    expect(errors.some((error) => error.code === ShiftErrorCode.BreakSequenceDuplicated)).toBe(true)
  })

  test('一次違反多條規則時，全部收集回報（§3.1.1），不是只回第一筆', () => {
    const errors = validateShiftStructure(
      [
        { sequenceNo: 1, startTime: '09:00', endTime: '13:00', endDayOffset: 0 },
        { sequenceNo: 1, startTime: '12:00', endTime: '18:00', endDayOffset: 0 },
      ],
      [{ sequenceNo: 1, startTime: '19:00', endTime: '20:00', startDayOffset: 0, endDayOffset: 0, isPaid: false }],
    )
    const codes = errors.map((error) => error.code)
    expect(codes).toContain(ShiftErrorCode.WorkPeriodSequenceDuplicated)
    expect(codes).toContain(ShiftErrorCode.WorkPeriodsOverlap)
    expect(codes).toContain(ShiftErrorCode.BreakOutsideWorkPeriod)
    expect(errors.length).toBeGreaterThan(1)
  })

  /**
   * 兩段休息互相重疊：各自都完整落在工作時段內（因此不會被 `BreakOutsideWorkPeriod` 擋到），
   * 問題只在彼此之間——12:30–13:00 這半小時被兩段休息各記一次，`requiredWorkMinutes` 會把
   * 它扣兩次。這是協調者要求補的情境，理由見 `shifts-main.errors.ts` 的 `shiftBreaksOverlap`。
   */
  test('休息時段彼此重疊被擋（12:00–13:00 與 12:30–13:30，兩段都在工作時段內）', () => {
    const errors = validateShiftStructure(
      [{ sequenceNo: 1, startTime: '09:00', endTime: '18:00', endDayOffset: 0 }],
      [
        { sequenceNo: 1, startTime: '12:00', endTime: '13:00', startDayOffset: 0, endDayOffset: 0, isPaid: false },
        { sequenceNo: 2, startTime: '12:30', endTime: '13:30', startDayOffset: 0, endDayOffset: 0, isPaid: false },
      ],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe(ShiftErrorCode.BreaksOverlap)
    // 沒有被誤判成落在工作時段外，也沒有被誤判成 sequenceNo 重複——只有重疊這一條問題。
    expect(errors.some((error) => error.code === ShiftErrorCode.BreakOutsideWorkPeriod)).toBe(false)
  })

  test('休息互相不重疊時，即使緊鄰也通過（結束＝下一段開始）', () => {
    const errors = validateShiftStructure(
      [{ sequenceNo: 1, startTime: '09:00', endTime: '18:00', endDayOffset: 0 }],
      [
        { sequenceNo: 1, startTime: '12:00', endTime: '12:30', startDayOffset: 0, endDayOffset: 0, isPaid: false },
        { sequenceNo: 2, startTime: '12:30', endTime: '13:00', startDayOffset: 0, endDayOffset: 0, isPaid: false },
      ],
    )
    expect(errors).toEqual([])
  })
})

describe('應工作分鐘必須為正值（最後一道防線）', () => {
  test('無薪休息剛好等於整段工作時段：requiredWorkMinutes=0 被擋，即使結構檢查全數通過', () => {
    const errors = validateShiftStructure(
      [{ sequenceNo: 1, startTime: '09:00', endTime: '10:00', endDayOffset: 0 }],
      [{ sequenceNo: 1, startTime: '09:00', endTime: '10:00', startDayOffset: 0, endDayOffset: 0, isPaid: false }],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe(ShiftErrorCode.RequiredWorkMinutesNotPositive)
    // 算出來的實際數字要帶在 data 裡，讓人不必自己重新加總（§3.1「errors 要能讓人直接改」）。
    expect(errors[0]?.data?.['requiredWorkMinutes']).toBe(0)
  })

  test('休息重疊時只回重疊那一條，不會同時疊加「應工作分鐘不是正值」（重疊已經在結構階段擋下）', () => {
    // 兩段各 60 分鐘、重疊 30 分鐘的無薪休息，若沒有重疊檢查，會被扣成 90 分鐘 > 60 分鐘的工作時段，
    // requiredWorkMinutes 會是負的——但這裡應該只看到重疊本身這一條錯誤。
    const errors = validateShiftStructure(
      [{ sequenceNo: 1, startTime: '09:00', endTime: '10:00', endDayOffset: 0 }],
      [
        { sequenceNo: 1, startTime: '09:00', endTime: '09:40', startDayOffset: 0, endDayOffset: 0, isPaid: false },
        { sequenceNo: 2, startTime: '09:10', endTime: '10:00', startDayOffset: 0, endDayOffset: 0, isPaid: false },
      ],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe(ShiftErrorCode.BreaksOverlap)
  })

  test('正常班別（應工作分鐘為正）通過', () => {
    expect(computeShiftDerivedValues(OVERNIGHT_WORK_PERIODS, OVERNIGHT_UNPAID_BREAK).requiredWorkMinutes).toBe(420)
    expect(validateShiftStructure(OVERNIGHT_WORK_PERIODS, OVERNIGHT_UNPAID_BREAK)).toEqual([])
  })
})
