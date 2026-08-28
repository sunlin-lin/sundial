/**
 * 執行期形狀檢查的行為測試。
 *
 * **為什麼這一支非有不可**：`api-contract-guard.ts` 是一支「沒有斷言就會安靜放行」的驗證器，
 * 而它的失效方式全部都是**綠的**——判斷寫反、`required` 沒真的檢查、`$ref` 解析不到就放行，
 * 每一種的表現都是「檢查通過」，與真正通過一模一樣（通用規範 §7.1：一條寫錯條件的規則
 * 永遠是綠的，比沒有規則更糟）。因此每一條規則都要有**兩個方向**的斷言：該過的過、該擋的擋。
 *
 * 被測的是**本檔旁邊那份原始碼**，不是前端的產生物：`bun run gen:api` 是把這份原始碼原封不動
 * 複製過去（見 `api-contract-guard.ts` 檔頭），所以測這一份等於測那一份，
 * 而且不需要先跑過產生指令才能跑測試。
 */
import { describe, expect, test } from 'bun:test'
import { contractDataReader, matchesContractSchema } from '../api-contract-guard.ts'

const NO_DEFINITIONS = {}

describe('形狀比對', () => {
  test('必填欄位缺一個就不符（`hasOwnProperty`，不是 `!== undefined`）', () => {
    const schema = { type: 'object', required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } } }
    expect(matchesContractSchema(schema, { a: 'x', b: 'y' }, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema(schema, { a: 'x' }, NO_DEFINITIONS)).toBe(false)
  })

  test('多出來的欄位一律放行——後端加欄位是相容變更，舊版前端必須照常運作（§1.6）', () => {
    const schema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } }
    expect(matchesContractSchema(schema, { a: 'x', addedLater: 1 }, NO_DEFINITIONS)).toBe(true)
  })

  test('選填欄位可以不出現，但出現了就要合形狀', () => {
    const schema = { type: 'object', required: [], properties: { a: { type: 'string' } } }
    expect(matchesContractSchema(schema, {}, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema(schema, { a: 1 }, NO_DEFINITIONS)).toBe(false)
  })

  test('`null` 與「欄位不存在」是兩件事', () => {
    const schema = { type: 'object', required: ['a'], properties: { a: { type: 'null' } } }
    expect(matchesContractSchema(schema, { a: null }, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema(schema, {}, NO_DEFINITIONS)).toBe(false)
  })

  test('primitive 的型別逐一分辨，不靠 truthy', () => {
    expect(matchesContractSchema({ type: 'string' }, '', NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema({ type: 'string' }, 0, NO_DEFINITIONS)).toBe(false)
    expect(matchesContractSchema({ type: 'boolean' }, false, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema({ type: 'boolean' }, 'false', NO_DEFINITIONS)).toBe(false)
    expect(matchesContractSchema({ type: 'integer' }, 1, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema({ type: 'integer' }, 1.5, NO_DEFINITIONS)).toBe(false)
    expect(matchesContractSchema({ type: 'null' }, null, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema({ type: 'null' }, undefined, NO_DEFINITIONS)).toBe(false)
  })

  test('陣列逐項比對；物件不能冒充陣列', () => {
    const schema = { type: 'array', items: { type: 'string' } }
    expect(matchesContractSchema(schema, ['a', 'b'], NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema(schema, ['a', 1], NO_DEFINITIONS)).toBe(false)
    expect(matchesContractSchema(schema, { 0: 'a' }, NO_DEFINITIONS)).toBe(false)
  })

  test('陣列不能冒充物件（`typeof [] === "object"` 是這一層最容易漏的坑）', () => {
    expect(matchesContractSchema({ type: 'object', properties: {} }, [], NO_DEFINITIONS)).toBe(false)
  })

  test('`anyOf` 只要有一個成立即可（nullable 欄位就是這樣表達的）', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'null' }] }
    expect(matchesContractSchema(schema, 'x', NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema(schema, null, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema(schema, 1, NO_DEFINITIONS)).toBe(false)
  })

  test('`const` 逐值比對', () => {
    expect(matchesContractSchema({ const: 'zh-TW' }, 'zh-TW', NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema({ const: 'zh-TW' }, 'en', NO_DEFINITIONS)).toBe(false)
  })

  test('`$ref` 解析得到就照著檢查（遞迴 schema：權限樹）', () => {
    const definitions = {
      Node: { type: 'object', required: ['id', 'children'], properties: { id: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } },
    }
    const schema = { $ref: '#/components/schemas/Node' }
    expect(matchesContractSchema(schema, { id: 'a', children: [{ id: 'b', children: [] }] }, definitions)).toBe(true)
    expect(matchesContractSchema(schema, { id: 'a', children: [{ id: 1, children: [] }] }, definitions)).toBe(false)
  })

  test('不認得的關鍵字與解析不到的 `$ref` 一律放行，不把正常回應判成壞掉', () => {
    expect(matchesContractSchema({ $ref: '#/components/schemas/Missing' }, 123, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema({ type: 'somethingNew' }, 123, NO_DEFINITIONS)).toBe(true)
    expect(matchesContractSchema({ pattern: '^a$' }, 'zzz', NO_DEFINITIONS)).toBe(true)
  })
})

describe('產生的 client 用的 data 收斂函式', () => {
  const schema = { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } }

  test('形狀相符時原樣回傳', () => {
    const read = contractDataReader<{ accessToken: string }>(schema, NO_DEFINITIONS)
    expect(read({ accessToken: 'token' })).toEqual({ accessToken: 'token' })
  })

  test('形狀不符回 `null`，由統一 client 轉成「回應的 data 形狀不符契約」', () => {
    const read = contractDataReader<{ accessToken: string }>(schema, NO_DEFINITIONS)
    expect(read({})).toBeNull()
    expect(read(null)).toBeNull()
  })
})
