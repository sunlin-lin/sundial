/**
 * 每個 `dataset_code` 的 `data` 形狀，以及讀出後的驗證（實作計畫 §6、§6.1）。
 *
 * ## 為什麼型別要在這裡收斂
 *
 * `regulatory_records.data` 在資料庫層是 json，沒有型別；十個資料集的形狀差異很大
 * （分級表是級距、費率表是行業別對費率、扣繳稅額表是二維表），資料字典因此刻意先用一個通用欄位承載。
 * 代價就是型別要在程式端補回來，而**不能讓 `data` 以 `unknown` 流進 Payroll**（計畫 §6）
 * ——那等於把型別檢查的邊界推進薪資計算裡面。
 *
 * ## 讀出後也驗證，不是只在寫入前驗證
 *
 * 看起來多餘，但它擋的是另一件事：資料是**幾個月前由另一版程式**寫進去的。解析器改過、欄位名改過、
 * 政府資料格式變過——寫入時的驗證管不到已經在庫裡的資料。
 * **驗不過是系統錯誤（`400`），不是業務錯誤**（計畫 §6）：使用者沒有做錯任何事，
 * 是我們的資料與我們自己的形狀對不上，那是要進告警、要有人去看堆疊的事。
 *
 * ## 金額與費率一律是 decimal 字串，禁止 JSON number
 *
 * §4.7 逐字點名的就是這個場景：浮點誤差在薪資單上是實發金額差一塊錢，而**勞健保級距在邊界值上
 * 會選錯級距**，錯的是法定金額。JSON number 在多數解析器裡就是 double，`0.0211` 一進去就不是
 * 原來那個數了，而且不會報錯——因此下面每一個數值欄位都是 {@link DecimalString}，
 * 一個 `Type.Number()` 都沒有。讀出後也**禁止 `Number(...)` 再計算**（§4.7）。
 *
 * ## 本目錄一律零 IO
 *
 * 只有 TypeBox schema 與純函式，沒有資料庫或 http 相依（§0.1、§3.1.1）。
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { RegulatoryDatasetCode } from './regulatory-dataset-code.ts'

/**
 * decimal 字串：整數部分必填，小數部分選填，可帶負號。
 *
 * **刻意不限制小數位數。** 各資料集的精度不同（費率到小數第 8 位、金額到第 4 位），
 * 而這裡驗的是「它是不是一個沒有經過浮點表示的十進位數字」，不是「它符不符合某一欄的精度」
 * ——精度由資料庫的 DECIMAL 欄位定義，那是它該待的地方。
 *
 * 不接受 `1e5`、`.5`、`5.` 這幾種寫法：它們都是**合法的 JS number 字面值**，
 * 出現在這裡幾乎必然代表某處先把值轉成 number 再 `String()` 回來，而那一步精度已經沒了。
 */
const DecimalString = Type.String({ pattern: '^-?\\d+(?:\\.\\d+)?$' })

/**
 * `dataset_code = 10` 健保補充保險費（費率與計費門檻）的 `data`。
 *
 * **形狀由 migration `0015` 已經寫進資料庫的三筆決定，不是反過來**（§4.1：已套用的 migration
 * 禁止修改）。那三筆是：
 *
 * | `record_key` | `data` |
 * |---|---|
 * | `rate` | `{"item":"rate","rate":"0.0211"}` |
 * | `charge-lower-bound` | `{"item":"chargeLowerBound","amount":"20000"}` |
 * | `single-payment-upper-limit` | `{"item":"singlePaymentUpperLimit","amount":"10000000"}` |
 *
 * **寫成三個字面值分支的聯集，而不是 `{ item: string, rate?: string, amount?: string }`**，
 * 有兩個理由：
 *
 * - §2 要求固定代碼欄位用聯集字面值。`item` 就是這個資料集的項目代碼，寫成 `t.String()` 之後，
 *   解析器打錯一個字母（`chargeLowerBound` → `chargeLowerbound`）會**通過驗證**，
 *   然後 Payroll 找不到那一項，於是補充保費算成 0——一個完全合理、不會報錯的數字。
 * - 選填欄位的版本無法表達「費率那一項一定要有 `rate`」。`{"item":"rate"}` 這種缺值的資料
 *   會通過驗證，而缺的正好是唯一有用的那個數字。
 *
 * 三項放同一個資料集而不是拆開，是因為它們是同一次公告裡的同一件事（計畫 §3.1.1）；
 * 費率調整時**新增一個版本**，不覆寫既有的值，因此這個形狀在未來的版本上一樣成立。
 */
const SUPPLEMENTARY_PREMIUM_SHAPE = Type.Union([
  /** 補充保險費率，例如 `0.0211`（2.11%）。 */
  Type.Object({ item: Type.Literal('rate'), rate: DecimalString }),
  /** 單次給付的計費下限（達此金額才計收）。 */
  Type.Object({ item: Type.Literal('chargeLowerBound'), amount: DecimalString }),
  /** 單次給付的計費上限。 */
  Type.Object({ item: Type.Literal('singlePaymentUpperLimit'), amount: DecimalString }),
])

/**
 * 「這個資料集的 `data` 形狀還沒有定義」。
 *
 * **這是一個明確的宣告，不是留空**，而且它**驗什麼都不會過**。理由與計畫 §7.2
 * 「推導不出生效日一律失敗，不得猜」同一條：形狀是跟著**解析器**一起被確定的
 * （要先看過政府真實資料才知道每個欄位叫什麼），而那九支解析器屬於 Stage 3。
 *
 * 在那之前先寫一個「看起來合理」的寬鬆形狀，代價是實的：它會**通過**驗證，
 * 於是一份欄位名對不上的資料會安靜地流進 Payroll，而 §6 那條「讀出後也驗證」等於沒有作用。
 * 驗不過則是一個會進告警、有堆疊、指得出 `dataset_code` 的系統錯誤。
 *
 * 不用 `Type.Unknown()`：計畫 §6 明文「不能讓 `data` 以 `unknown` 流進 Payroll」。
 * `Type.Never()` 在靜態型別上是 `never`，於是連「先取出來再說」都寫不出來。
 */
const SHAPE_NOT_YET_DEFINED = Type.Never({
  description: '此資料集的 data 形狀尚未定義（Stage 3 與解析器一起確定）',
})

/**
 * `dataset_code` → 該資料集的 `data` schema。
 *
 * **這份對應是「總的」（每個合法代碼都必須有一項）**，由下面的 `satisfies` 釘住：
 * 新增一個 `dataset_code` 卻忘了決定它的形狀時，**這一行當場編譯不過**。
 * 少了這個約束，漏掉的那一個代碼會落到「查不到 schema 就跳過驗證」那條路——
 * 而跳過驗證與驗證通過在程式的行為上完全一樣。
 *
 * 刻意不寫 `as const`：`as const` 會把 TypeBox 的內部結構一起變成唯讀，`Static<>` 就算不出型別了。
 */
export const REGULATORY_RECORD_SHAPES = {
  1: SHAPE_NOT_YET_DEFINED,
  2: SHAPE_NOT_YET_DEFINED,
  3: SHAPE_NOT_YET_DEFINED,
  4: SHAPE_NOT_YET_DEFINED,
  5: SHAPE_NOT_YET_DEFINED,
  6: SHAPE_NOT_YET_DEFINED,
  // `7` 是永久空號（見 `regulatory-dataset-code.ts`），因此這裡也沒有它——
  // 補一個進來就等於讓那個空號變成「一個沒有形狀的資料集」。
  8: SHAPE_NOT_YET_DEFINED,
  9: SHAPE_NOT_YET_DEFINED,
  10: SUPPLEMENTARY_PREMIUM_SHAPE,
} satisfies Record<RegulatoryDatasetCode, TSchema>

/**
 * 某個資料集（或全部資料集）的 `data` 型別。
 *
 * 預設參數是整個 {@link RegulatoryDatasetCode} 聯集，因此不指定時得到的是「任一資料集的 data」
 * ——`resolve` 端點的 response 型別就是這一個，因為它接受任何一個資料集代碼。
 */
export type RegulatoryRecordData<TCode extends RegulatoryDatasetCode = RegulatoryDatasetCode> = Static<
  (typeof REGULATORY_RECORD_SHAPES)[TCode]
>

/**
 * 對外 response 用的 `data` schema：全部資料集形狀的聯集。
 *
 * **由 {@link REGULATORY_RECORD_SHAPES} 推導而不是另外列一份**：另外列的那一份哪天少一個分支，
 * 症狀是某個資料集的 `resolve` 在 response 驗證階段爆掉——而那時資料其實是對的。
 */
export const RegulatoryRecordDataSchema: TSchema = Type.Union(Object.values(REGULATORY_RECORD_SHAPES))

/**
 * 讀出後的驗證結果。
 *
 * **不直接拋例外**，是為了讓「哪一筆、哪個資料集、哪個版本」這些只有呼叫端知道的脈絡
 * 能被加進錯誤訊息裡——本檔是 `domain/`，它看不到那些東西。拋例外的那一層是 repository
 * （讀出資料的那一層，見 `impl/regulatory-datasets.list-records.repository.ts`）。
 */
export type RegulatoryRecordDataResult<TCode extends RegulatoryDatasetCode = RegulatoryDatasetCode> =
  | { readonly ok: true; readonly value: RegulatoryRecordData<TCode> }
  | { readonly ok: false; readonly reason: string }

/**
 * 驗證一筆 `data` 是不是該資料集該有的形狀（計畫 §6）。
 *
 * @param datasetCode 這筆 record 所屬版本的資料集代碼。
 * @param value 從資料庫讀出來的 json 值。**型別是 `unknown`**，這是刻意的：
 *   它是幾個月前另一版程式寫進去的位元組，在這一行之前沒有任何靜態保證。
 *
 * 收斂靠 `Value.Check` 的型別謂詞而不是型別斷言（`as`）：斷言只是叫編譯器閉嘴，
 * 值長什麼樣完全沒被檢查過，而這個函式存在的唯一理由就是去檢查它。
 */
export const parseRegulatoryRecordData = <TCode extends RegulatoryDatasetCode>(
  datasetCode: TCode,
  value: unknown,
): RegulatoryRecordDataResult<TCode> => {
  const schema = REGULATORY_RECORD_SHAPES[datasetCode]
  if (Value.Check(schema, value)) return { ok: true, value }

  // 取第一筆違規就好：這裡的產物是給人看的錯誤訊息，不是回給前端的 `errors` 陣列
  //（那是業務錯誤的形狀，而這是系統錯誤，§3.1.2）。聯集形狀在驗不過時會產出一長串
  // 「每個分支各錯在哪」，全部印出來反而蓋掉真正有用的那一行。
  const [firstError] = [...Value.Errors(schema, value)]
  const detail =
    firstError === undefined ? '' : `：${firstError.path === '' ? '(根層)' : firstError.path} ${firstError.message}`

  return { ok: false, reason: `dataset_code=${datasetCode} 的 data 不符合形狀定義${detail}` }
}
