import { describe, expect, test } from 'bun:test'
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'
import {
  failureReasonDisplay,
  recordsReceivedDisplay,
  statusPresentation,
  toDisplayRows,
  type SyncLogRow,
} from './regulatory-sync.view.ts'

/** 一列同步紀錄。只有要斷言的欄位由參數帶入，其餘固定——斷言才不會被無關欄位淹掉。 */
const buildRow = (overrides: Partial<SyncLogRow> = {}): SyncLogRow => ({
  id: 1,
  datasetCode: 1,
  triggerTypeCode: 1,
  startedAt: '2026-08-26 03:00:00',
  finishedAt: '2026-08-26 03:00:12',
  statusCode: 2,
  datasetVersionId: 7,
  governmentResourceId: '6258',
  recordsReceived: 97,
  errorMessage: null,
  heartbeatAt: '2026-08-26 03:00:12',
  createdAt: '2026-08-26 03:00:00',
  updatedAt: '2026-08-26 03:00:12',
  ...overrides,
})

/** 翻譯替身：原樣回傳 key，讓斷言直接看得出組出來的是哪一則訊息。 */
const echoTranslate: TranslateMessage = (key) => key

const STATUS_LABEL_CASES: readonly (readonly [SyncLogRow['statusCode'], MessageKey])[] = [
  [1, 'regulatory-sync.status.running'],
  [2, 'regulatory-sync.status.succeeded'],
  [3, 'regulatory-sync.status.failed'],
  [4, 'regulatory-sync.status.no-change'],
]

describe('狀態的呈現', () => {
  test.each(STATUS_LABEL_CASES)('狀態 %i 有自己的文字，四種不共用一則', (code, labelKey) => {
    expect(statusPresentation(code).labelKey).toBe(labelKey)
  })

  test('失敗用危險色的實心標籤，一眼就分得出來', () => {
    expect(statusPresentation(3).tone).toBe('danger')
    expect(statusPresentation(3).effect).toBe('dark')
  })

  test('其餘三種不搶失敗的視覺份量', () => {
    for (const code of [1, 2, 4] as const) {
      expect(statusPresentation(code).tone).not.toBe('danger')
      expect(statusPresentation(code).effect).toBe('light')
    }
  })

  test('「無異動」與「更新成功」是兩種狀態，不得合併成同一種呈現', () => {
    expect(statusPresentation(4).labelKey).not.toBe(statusPresentation(2).labelKey)
    expect(statusPresentation(4).tone).not.toBe(statusPresentation(2).tone)
  })
})

describe('失敗原因', () => {
  test('原文照印，不截斷、不改寫——長訊息一個字都不能少', () => {
    const reason =
      '解析失敗：缺少身分別「本人」的分擔金額欄位；來源 checksum 3f2a…（本地 9c14…）；' +
      '資源說明「自115年1月1日起適用」推導不出生效日，候選資源 6259／13335 皆不在範圍內。'
    expect(failureReasonDisplay(buildRow({ statusCode: 3, errorMessage: reason }))).toBe(reason)
  })

  test('抄自政府公告的民國年不轉西元（計畫 §5.1 的例外）', () => {
    const reason = '公告日期 115/01/01 與資源說明不一致'
    expect(failureReasonDisplay(buildRow({ statusCode: 3, errorMessage: reason }))).toBe(reason)
  })

  test('沒有失敗原因的列顯示「沒有值」，不是空白', () => {
    expect(failureReasonDisplay(buildRow({ statusCode: 2, errorMessage: null }))).toBe('—')
  })

  test('標著失敗卻沒有原因時同樣顯示「沒有值」，不由前端補一句話', () => {
    expect(failureReasonDisplay(buildRow({ statusCode: 3, errorMessage: null }))).toBe('—')
  })
})

describe('收到筆數', () => {
  test('數字加千分位', () => {
    expect(recordsReceivedDisplay(1234)).toBe('1,234')
  })

  test('字串形式同樣走千分位，中間不經過數值轉型', () => {
    expect(recordsReceivedDisplay('1234')).toBe('1,234')
  })

  test('還沒解析就失敗、或還在執行中的列沒有筆數', () => {
    expect(recordsReceivedDisplay(null)).toBe('—')
  })

  test('零筆是一個值，不是沒有值', () => {
    expect(recordsReceivedDisplay(0)).toBe('0')
  })
})

describe('表格的列怎麼組', () => {
  test('時間裁到分鐘、不帶秒，也不經過 Date（§9.2）', () => {
    const [row] = toDisplayRows([buildRow()], echoTranslate)
    expect(row?.startedAt).toBe('2026-08-26 03:00')
    expect(row?.finishedAt).toBe('2026-08-26 03:00')
  })

  test('還沒結束的同步：結束時間顯示「沒有值」，不補一個午夜', () => {
    const [row] = toDisplayRows([buildRow({ statusCode: 1, finishedAt: null })], echoTranslate)
    expect(row?.finishedAt).toBe('—')
  })

  test('資料集與狀態都已經翻成文字，模板不再查表', () => {
    const [row] = toDisplayRows([buildRow({ datasetCode: 5, statusCode: 3 })], echoTranslate)
    expect(row?.dataset).toBe('regulatory-sync.dataset.5')
    expect(row?.statusLabel).toBe('regulatory-sync.status.failed')
    expect(row?.statusTone).toBe('danger')
  })

  test('id 一律收成字串，表格的 row-key 才不會因為型別而對不上', () => {
    const [numeric] = toDisplayRows([buildRow({ id: 12 })], echoTranslate)
    const [text] = toDisplayRows([buildRow({ id: '12' })], echoTranslate)
    expect(numeric?.id).toBe('12')
    expect(text?.id).toBe('12')
  })

  test('空清單組出空清單，不是一列空白', () => {
    expect(toDisplayRows([], echoTranslate)).toEqual([])
  })
})
