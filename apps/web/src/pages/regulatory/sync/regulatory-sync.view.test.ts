import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { failureReasonDisplay, recordsReceivedDisplay, toDisplayRows, type SyncLogRow } from './regulatory-sync.view.ts'

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

// ⚠️ 這一輪拿掉了「資料集下拉的一個選項」那組測試（原本測 `toDatasetOption`）。
// 那支函式已經整支刪掉：下拉的選項現在是 `page.datasets` 直接指派給 `datasetOptions.value`
//（見 `.page.vue` 的 `load()`），沒有轉換邏輯——`DatasetOption` 只是產生型別的別名
//（見 `.view.ts` 的檔頭），型別本身已經由 `bun run typecheck:web` 守著（後端改欄位名稱
// 這裡會編譯錯誤），純函式測試在這裡沒有東西可以測，硬補一組只會測到「賦值有賦值」。

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
    const [row] = toDisplayRows([buildRow()], echoTranslate, '勞工保險投保薪資分級表')
    expect(row?.startedAt).toBe('2026-08-26 03:00')
    expect(row?.finishedAt).toBe('2026-08-26 03:00')
  })

  test('還沒結束的同步：結束時間顯示「沒有值」，不補一個午夜', () => {
    const [row] = toDisplayRows(
      [buildRow({ statusCode: 1, finishedAt: null })],
      echoTranslate,
      '勞工保險投保薪資分級表',
    )
    expect(row?.finishedAt).toBe('—')
  })

  test('資料集名稱是整包回應共用的同一個字串，不是逐列查表——狀態同樣已經翻成文字', () => {
    const [row] = toDisplayRows([buildRow({ datasetCode: 5, statusCode: 3 })], echoTranslate, '健保費負擔金額表')
    expect(row?.dataset).toBe('健保費負擔金額表')
    expect(row?.statusLabel).toBe('regulatory.sync-status.failed')
    expect(row?.statusTone).toBe('danger')
  })

  test('id 一律收成字串，表格的 row-key 才不會因為型別而對不上', () => {
    const [numeric] = toDisplayRows([buildRow({ id: 12 })], echoTranslate, '勞工保險投保薪資分級表')
    const [text] = toDisplayRows([buildRow({ id: '12' })], echoTranslate, '勞工保險投保薪資分級表')
    expect(numeric?.id).toBe('12')
    expect(text?.id).toBe('12')
  })

  test('空清單組出空清單，不是一列空白', () => {
    expect(toDisplayRows([], echoTranslate, '勞工保險投保薪資分級表')).toEqual([])
  })
})
