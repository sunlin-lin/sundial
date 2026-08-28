/**
 * `datasets/domain/` 的純函式測試。
 *
 * 目前只有一項：`data` 的形狀驗證（計畫 §6）。它是真正的純函式——形狀定義只有這一份實作，
 * 寫入前與讀出後都呼叫它，因此這裡測到的就是正式路徑上跑的那段程式碼。
 *
 * **「基準日 → 版本」的挑選規則刻意不在這裡測，因為它刻意沒有純函式版本。**
 * 那條規則只有一份實作，就是 `impl/regulatory-datasets.find-effective-version.repository.ts`
 * 裡的那段 SQL（計畫 §3.2 (d) 把它寫死了），守它的是
 * `regulatory-datasets.endpoints.test.ts` 的整合測試。理由寫在那支切片的註解裡。
 */
import { describe, expect, test } from 'bun:test'
import { parseRegulatoryRecordData } from '../domain/regulatory-record-shape.ts'

describe('parseRegulatoryRecordData：dataset_code=10 的三筆（migration 0015 已寫進資料庫的形狀）', () => {
  // 這三筆的字面值必須與 `0015_seed_supplementary_premium.sql` 逐字相同：
  // 已套用的 migration 禁止修改（§4.1），因此是形狀定義要配合資料，不是反過來。
  test('費率那一筆通過，且值是 decimal 字串', () => {
    const parsed = parseRegulatoryRecordData(10, { item: 'rate', rate: '0.0211' })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual({ item: 'rate', rate: '0.0211' })
  })

  test('計費下限與單次上限那兩筆通過', () => {
    expect(parseRegulatoryRecordData(10, { item: 'chargeLowerBound', amount: '20000' }).ok).toBe(true)
    expect(parseRegulatoryRecordData(10, { item: 'singlePaymentUpperLimit', amount: '10000000' }).ok).toBe(true)
  })

  test('數值寫成 JSON number 一律不通過（§4.7：金額與費率禁止 number）', () => {
    // JSON number 在多數解析器裡就是 double：`0.0211` 一進去就不是原來那個數了，而且不會報錯。
    expect(parseRegulatoryRecordData(10, { item: 'rate', rate: 0.0211 }).ok).toBe(false)
    expect(parseRegulatoryRecordData(10, { item: 'chargeLowerBound', amount: 20000 }).ok).toBe(false)
  })

  test('item 打錯字不通過（§2：固定代碼欄位用聯集字面值）', () => {
    // 寫成 `t.String()` 的話這一筆會通過驗證，然後 Payroll 找不到那一項，
    // 補充保費算成 0——一個完全合理、不會報錯的數字。
    const parsed = parseRegulatoryRecordData(10, { item: 'chargeLowerbound', amount: '20000' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('dataset_code=10')
  })

  test('缺了那個唯一有用的數字時不通過', () => {
    expect(parseRegulatoryRecordData(10, { item: 'rate' }).ok).toBe(false)
    // 費率那一項帶的是 `amount` 而不是 `rate`，同樣不通過。
    expect(parseRegulatoryRecordData(10, { item: 'rate', amount: '0.0211' }).ok).toBe(false)
  })

  test('形狀尚未定義的資料集：什麼都驗不過，而不是靜靜放行（計畫 §6、§7.2 的同一種取捨）', () => {
    // 用 `2`（健保投保金額分級表）：它的形狀要跟著解析器一起定（Stage 3），現在是 `Type.Never()`。
    // **不要拿 `1` 來測這件事**——`1` 已經有形狀了（`sync` 次目錄的解析器落地時一起定的），
    // 拿它來測會變成在測「這個物件不符合勞保分級表的形狀」，而那是另一條規則。
    //
    // 先寫一個「看起來合理」的寬鬆形狀，代價是它會**通過**驗證，
    // 於是欄位名對不上的資料會安靜地流進 Payroll。
    const parsed = parseRegulatoryRecordData(2, { grade: 1, salary: '27470' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('dataset_code=2')

    // 「什麼都驗不過」是字面意思：連一個**在別的資料集上完全合法**的 `data` 也不通過。
    // 這一行才是 `Type.Never()` 與「一個看起來合理的寬鬆形狀」真正的差別所在。
    expect(parseRegulatoryRecordData(2, { item: 'rate', rate: '0.0211' }).ok).toBe(false)
  })
})
