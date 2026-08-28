/**
 * 產生物的執行期形狀檢查（前端 `api/generated/api-guard.ts` 的原始碼）。
 *
 * ## 這個檔案為什麼在 `apps/api/scripts/` 底下，卻是前端在用
 *
 * 它**不會被前端 import**——前端禁止 import 後端的任何模組（前端規範 §3.5，含經第三個套件
 * 轉手 re-export）。`bun run gen:api` 是把**本檔的原始碼原封不動複製**到
 * `apps/web/src/api/generated/api-guard.ts`，複製過去的那一份才是前端用的檔案。
 *
 * 為什麼不直接把這段程式碼寫成產生器裡的一個字串樣板：那樣它就不會被型別檢查、不會被 lint、
 * 也不會被編輯器認得。這裡是一支**沒有斷言就會安靜放行**的驗證器，是最不該用未經檢查的字串
 * 來維護的東西。放成一個真的 `.ts` 檔，`bun run typecheck` 就會涵蓋它。
 *
 * 因此本檔有兩條硬限制：**不得 import 任何東西**、**不得使用後端才有的執行環境 API**。
 * 違反其中任何一條，複製到前端的那一份就編不過——而錯誤訊息會指向一個產生物，很難查。
 *
 * ## 為什麼前端還需要執行期檢查（型別不是已經產生了嗎）
 *
 * 產生的型別擋的是**我們自己寫錯**（欄位名打錯、少處理一種形狀），它在編譯期就紅。
 * 但通用規範 §2.2 要擋的是另一件事：**HTTP 回應是外部邊界**，實際跑起來時對面回什麼，
 * 型別一個字都保證不了——後端部署版本比前端舊、反向代理回了一頁 HTML、某支端點回了
 * `data: null`。沒有這一層，那些情況會變成畫面上一個 `undefined`，
 * 而爆點離成因好幾層遠（`Cannot read property of undefined`）。
 *
 * ## 判準：認得的形狀嚴格比對，不認得的一律放行
 *
 * 支援 `$ref`／`anyOf`／`const`／`type`／`properties`／`required`／`items`，其餘關鍵字
 *（`minLength`、`pattern`、`format`…）一律忽略。**這是刻意的**：這一層要回答的是
 * 「形狀對不對」，不是「值合不合法」——值的合法性由後端驗（§2），前端再驗一次只會出現
 * 「後端放行、前端卻把正常回應判成壞掉」這種永遠查不出來的狀況。
 *
 * 同理，**物件允許有多餘的欄位**。後端加一個欄位是相容變更（§1.6），舊版前端必須照常運作；
 * 嚴格禁止多餘欄位的話，後端每加一個欄位就會讓所有還沒更新的前端整批壞掉。
 */

/** `components.schemas`：`$ref` 的解析對象。由產生器把 spec 裡的可重用 schema 原樣帶進來。 */
export type ContractSchemaDefinitions = Readonly<Record<string, unknown>>

/** 產生器寫出來的 `$ref` 一律是這個前綴 ＋ `components.schemas` 的鍵。 */
const REF_PREFIX = '#/components/schemas/'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value)

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

/**
 * 物件形狀比對。
 *
 * 必填欄位必須**存在**（`hasOwnProperty`，不是 `!== undefined`）：JSON 裡沒有 `undefined`，
 * 用 `!== undefined` 判斷會把「後端明確回了 `null`」與「後端根本沒回這個欄位」混為一談，
 * 而那兩件事在契約上是不同的（前者要 schema 允許 `null` 才合法）。
 */
const matchesObject = (
  schema: Record<string, unknown>,
  value: unknown,
  definitions: ContractSchemaDefinitions,
): boolean => {
  if (!isRecord(value)) return false

  const properties: unknown = schema['properties']
  // 沒有 properties 的 object（例如 `t.Record(...)` 產出的 patternProperties）只檢查它是個物件。
  if (!isRecord(properties)) return true

  const required: unknown = schema['required']
  if (isUnknownArray(required)) {
    for (const field of required) {
      if (typeof field !== 'string') continue
      if (!hasOwn(value, field)) return false
    }
  }

  for (const [field, fieldSchema] of Object.entries(properties)) {
    // 選填且沒出現：跳過。出現了就要合形狀，不論必填選填。
    if (!hasOwn(value, field)) continue
    if (!matchesContractSchema(fieldSchema, value[field], definitions)) return false
  }

  return true
}

/**
 * 值是否符合 schema 描述的形狀。
 *
 * @param schema JSON Schema 片段（來自產生的 `openapi.json`）。
 * @param value 從 HTTP 回應拿到的、尚未收斂的值。
 * @param definitions `$ref` 的解析對象。
 */
export const matchesContractSchema = (
  schema: unknown,
  value: unknown,
  definitions: ContractSchemaDefinitions,
): boolean => {
  // 不是物件的 schema（`true`／`false`／缺漏）一律放行：走到這裡代表產生器輸出了我們沒預期的
  // 東西，而在一支「驗證器」裡，猜錯的代價是把正常回應判成壞掉。
  if (!isRecord(schema)) return true

  const ref: unknown = schema['$ref']
  if (typeof ref === 'string') {
    const name = ref.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : ref
    const target: unknown = hasOwn(definitions, name) ? definitions[name] : undefined
    // 解析不到的 `$ref` 同樣放行：這是產生器的問題，不是回應的問題。
    return target === undefined ? true : matchesContractSchema(target, value, definitions)
  }

  const anyOf: unknown = schema['anyOf']
  if (isUnknownArray(anyOf)) {
    return anyOf.some((member) => matchesContractSchema(member, value, definitions))
  }

  const allOf: unknown = schema['allOf']
  if (isUnknownArray(allOf)) {
    return allOf.every((member) => matchesContractSchema(member, value, definitions))
  }

  if (hasOwn(schema, 'const')) return value === schema['const']

  const type: unknown = schema['type']
  switch (type) {
    case 'object':
      return matchesObject(schema, value, definitions)
    case 'array': {
      if (!isUnknownArray(value)) return false
      const items: unknown = schema['items']
      return value.every((item) => matchesContractSchema(items, item, definitions))
    }
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'null':
      return value === null
    default:
      // 沒有 `type`（例如 `t.Unknown()`）或出現我們不認得的 type：放行，理由同上。
      return true
  }
}

/**
 * 產生的 client 用的 `data` 收斂函式工廠。
 *
 * 回傳的函式簽章刻意與統一 client 的 `DataReader<TData>` 相同：形狀不符回 `null`，
 * 由 client 統一轉成「回應的 data 形狀不符契約」的系統錯誤，不在這裡各自拋各自的例外。
 */
export const contractDataReader =
  <TData>(schema: unknown, definitions: ContractSchemaDefinitions) =>
  (value: unknown): TData | null =>
    matchesContractSchema(schema, value, definitions) ? toContractData<TData>(value) : null

/**
 * 已經通過形狀比對的值 → 產生型別。
 *
 * **這是整條契約鏈上唯一一次型別放寬，而且被關在這一個函式裡。**
 * 型別放寬理由：`matchesContractSchema` 的回傳值是 `boolean`，TypeScript 沒有辦法從
 * 「一個以 JSON Schema 資料驅動的比對結果」推導出 `value is TData`——那需要把 schema
 * 提升到型別層，而 schema 是執行期的資料。放寬只發生在**比對通過之後**，
 * 且 `TData` 由產生器從同一份 schema 產出，兩邊不可能指向不同的東西。
 */
const toContractData = <TData>(value: unknown): TData => value as TData
