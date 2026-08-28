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
 * `dataset_code = 1` 勞工保險投保薪資分級表的 `data`（計畫 §7.0 已實地查證的來源）。
 *
 * 政府那一份（data.gov.tw `6258` 的 JSON 資源）每一列長這樣：
 *
 * ```json
 * {"適用起日":"1150101","序號":"1","身分別":"一般勞工","投保薪資等級":"1",
 *  "月薪資總額":"29500元以下","月投保薪資":"29500"}
 * ```
 *
 * 對照關係（解析器在 `sync/domain/regulatory-labor-insurance-salary.ts`）：
 *
 * | 政府欄位 | 去哪裡 |
 * |---|---|
 * | `適用起日` | **版本的 `effective_from`**，不進 `data`（見下） |
 * | `序號` | `regulatory_records.sort_order`（政府的原始列序） |
 * | `身分別` | {@link insuredCategoryCode} ＋ `insuredCategoryName` ＋ `records.name` |
 * | `投保薪資等級` | {@link grade} ＋ `records.code` |
 * | `月薪資總額` | {@link monthlySalaryRangeText} ＋ `range_from`／`range_to` |
 * | `月投保薪資` | {@link monthlyInsuredSalary} ＋ `records.amount` |
 *
 * ## `身分別` 收斂成四個字面值，不是 `Type.String()`
 *
 * 理由與 `dataset_code=10` 的 `item` 逐字同構（§2）：Payroll 是**依身分別挑分級表**的
 * （一般勞工與部分工時勞工的第 1 級差了將近三倍），寫成 `Type.String()` 之後，
 * 政府哪天把「部分工時勞工」改成別的字，解析會**通過驗證**，然後 Payroll 那一側查不到這一類，
 * 於是那些人的投保薪資悄悄落到另一組級距上——一個完全合理、不會報錯的金額。
 * 收成字面值之後，同一件事會在同步階段就變成 `status=3 失敗` ＋ 一筆 `error_message`。
 *
 * **代價要寫清楚：政府新增一種身分別時，這個資料集會同步失敗。** 那是要的——
 * 新增一類投保身分是法規變更，Payroll 必須知道它存在，而不是靜靜地少算一群人。
 *
 * ## 沒有 `effectiveFrom`，即使政府把它放在每一列裡
 *
 * 生效日是**版本的屬性**（`regulatory_dataset_versions.effective_from`），不是每一筆的屬性。
 * 抄一份進 `data` 會產生第二份真相：兩者不一致時沒有任何地方會報錯，而 `resolve` 只看版本那一份。
 * 解析器改為**要求整批資料的 `適用起日` 完全一致**，不一致即失敗（推不出唯一的生效日，§7.2）。
 *
 * ## 級距上下限允許 `null`，且不補一個「合理的」邊界值
 *
 * 最低一級是「29500元以下」、最高一級是「43901元以上」，兩者各缺一邊。
 * `null` 的意思是「這一邊沒有界線」，**刻意不填 `0` 或某個很大的數**：填了之後，
 * 一支寫錯的級距查詢（`range_from <= x AND range_to >= x`）會回一個看起來正常的級距；
 * 留 `null` 則是查不到——而查不到會有人來看，算錯不會。
 */
const LABOR_INSURANCE_SALARY_GRADE_SHAPE = Type.Object({
  /** 投保身分別代碼。四個值即政府那一份的四種 `身分別`，理由見上。 */
  insuredCategoryCode: Type.Union([
    /** 一般勞工。 */
    Type.Literal('general'),
    /** 庇護性身心障礙者。 */
    Type.Literal('shelteredDisabled'),
    /** 部分工時勞工。 */
    Type.Literal('partTime'),
    /** 職訓機構受訓者。 */
    Type.Literal('vocationalTrainee'),
  ]),
  /** 政府原文的身分別（`一般勞工`…）。保留原文供對帳：代碼是我們取的，原文才是公告上的字。 */
  insuredCategoryName: Type.String({ minLength: 1 }),
  /**
   * 投保薪資等級（級數）。**是字串不是數字**：它是代碼不是量，不參與任何運算。
   *
   * 級數在每一種身分別內各自從 1 起算，因此它單獨不唯一——`record_key` 是
   * 「身分別代碼 ＋ 級數」的組合，見 `sync/domain/` 的解析器。
   */
  grade: Type.String({ pattern: '^\\d+$' }),
  /** 政府原文的月薪資總額區間（`29501元至30300元`）。拆解結果對不上時要能回頭看原文。 */
  monthlySalaryRangeText: Type.String({ minLength: 1 }),
  /** 月薪資總額下限（含）。最低一級是「N 元以下」，沒有下限，因此為 `null`。 */
  monthlySalaryFrom: Type.Union([DecimalString, Type.Null()]),
  /** 月薪資總額上限（含）。最高一級是「N 元以上」，沒有上限，因此為 `null`。 */
  monthlySalaryTo: Type.Union([DecimalString, Type.Null()]),
  /** 月投保薪資：這一級實際用來計算保費的金額。decimal 字串，禁止 `Number(...)`（§4.7）。 */
  monthlyInsuredSalary: DecimalString,
})

/**
 * `dataset_code = 2` 全民健康保險投保金額分級表的 `data`（data.gov.tw `20251` 的 **CSV** 資源）。
 *
 * 政府那一份的表頭與資料列長這樣（2026-08 實測，115年1月那一份 58 列）：
 *
 * ```csv
 * 組別級距,投保等級,月投保金額（元）,實際薪資月額（元）
 * 第一組級距1200元,1,29500,29500以下
 * 第二組級距1500元,2,30300,29501-30300
 * ```
 *
 * | 政府欄位 | 去哪裡 |
 * |---|---|
 * | `組別級距` | {@link groupRangeText} |
 * | `投保等級` | {@link grade} ＋ `records.code` ＋ `records.sort_order` |
 * | `月投保金額（元）` | {@link monthlyInsuredAmount} ＋ `records.amount` |
 * | `實際薪資月額（元）` | {@link actualSalaryRangeText} ＋ `range_from`／`range_to` |
 *
 * ## 這個資料集是 **CSV**，而且**一個資源就是一個年度版本**
 *
 * 前四個資料集都是「一個當期資源 → 一個版本」，這一個不同：`20251` 的 `distribution[]` 有
 * **16 筆 CSV**，每一筆是一個歷史版本，生效日寫在各自的資源說明裡（`115年1月全民健康保險投保金額分級表`）。
 * 因此它走的是同步流程的多版本那一條（見 `sync/impl/regulatory-sync.run.service.ts`）。
 *
 * ⚠️ **其中九筆的說明只有年份、沒有月份**（`100年全民健康保險投保金額分級表`…`109年…`），
 * 那九個版本依計畫 §7.2 一律失敗、不得猜（同一年可能有兩次調整），因此本資料集實際回補得到的
 * 最早版本是**民國 110 年 1 月**。理由與失敗訊息見 `sync/domain/regulatory-roc-date.ts` 的
 * `parseRocYearMonthFromText`。
 *
 * ## 沒有任何一欄是封閉代碼，因此沒有字面值聯集
 *
 * `組別級距`（`第一組級距1200元`）看起來很像一個代碼，**但它每次調整都會變**：實測 16 個版本裡，
 * 同一個組序的級距金額改過（`第十組級距5400元` → `第十組級距6400元` 在同一份檔案裡同時出現），
 * 組數也從 9 變到 12。把它收成字面值聯集會讓每一次例行調整都變成編譯錯誤，
 * 而那正是 `dataset_code=3` 的說明裡講的「過期的檢查會被放寬掉」。
 * 完整性由解析器的**級距連續性**守（見 `sync/domain/regulatory-health-insurance-salary-grade.ts`），
 * 不是由型別守。
 *
 * ## 級距上下限允許 `null`，理由與 `dataset_code=1`、`3` 逐字相同
 *
 * 最低一級是「29500以下」、最高一級是「303001以上」，各缺一邊。`null` 的意思是「這一邊沒有界線」，
 * 刻意不填 `0` 或某個很大的數——填了之後，一支寫錯的級距查詢會回一個看起來正常的級距。
 */
const HEALTH_INSURANCE_SALARY_GRADE_SHAPE = Type.Object({
  /**
   * 政府原文的組別級距（`第一組級距1200元`）。**是原文不是代碼**，理由見上。
   *
   * 保留它的理由與 `dataset_code=3` 的 `備註` 同一條：它是政府特地寫在表上的內容
   *（同一組之內每升一級加多少錢），丟掉的那一刻不會有任何症狀。
   */
  groupRangeText: Type.String({ minLength: 1 }),
  /**
   * 投保等級（級數）。**是字串不是數字**：它是代碼不是量，不參與任何運算。
   *
   * 這張表只有一套級距（不像 `dataset_code=1` 的級數在四種身分別內各自從 1 起算），
   * 因此級數在版本內唯一——但它**不是** `record_key`，理由見解析器（基本工資一調，低薪的幾級被刪掉，
   * 後面每一級的級數整批往前位移）。
   */
  grade: Type.String({ pattern: '^\\d+$' }),
  /** 這一級的月投保金額：健保保費的計算基數，也是 `record_key` 的來源。decimal 字串（§4.7）。 */
  monthlyInsuredAmount: DecimalString,
  /** 政府原文的實際薪資月額區間（`29501-30300`）。**分隔符號是半形連字號**，不是「至」。 */
  actualSalaryRangeText: Type.String({ minLength: 1 }),
  /** 實際薪資月額下限（含）。最低一級是「N以下」，沒有下限，因此為 `null`。 */
  actualSalaryFrom: Type.Union([DecimalString, Type.Null()]),
  /** 實際薪資月額上限（含）。最高一級是「N以上」，沒有上限，因此為 `null`。 */
  actualSalaryTo: Type.Union([DecimalString, Type.Null()]),
})

/**
 * `dataset_code = 5` 健保費負擔金額表（有一定雇主之受僱者）的 `data`
 * （data.gov.tw `20246` 的 **CSV** 資源）。
 *
 * 政府那一份的表頭與資料列長這樣（2026-08 實測，115年1月那一份 58 列）：
 *
 * ```csv
 * 投保金額等級,月投保金額,本人負擔金額（負擔比率30%）,本人+1眷口負擔金額,本人+2眷口負擔金額,本人+3眷口負擔金額,投保單位負擔金額（負擔比率60%）,政府補助金額（補助比率10%）
 * 1,29500,458,916,1374,1832,1428,238
 * ```
 *
 * ## 這是「金額表」不是「費率表」，與 `dataset_code=4` 同一個理由（計畫 §3.1）
 *
 * 政府把每一級、每一種眷口數要繳多少錢都算好了，Payroll **查表**即可。
 * 自己乘費率再取捨會在邊界上與政府的公告值差一塊錢，而那一塊錢在薪資單上是對不起來的實發金額。
 *
 * ## 八欄與政府的八個欄位**一對一**，這一點被 `satisfies` 釘住
 *
 * 見解析器裡的 `FIELD`：它是 `Record<keyof 本形狀, 政府欄位名>` 的**總對總**對照，
 * 而 CSV 的表頭清單由它推導。於是「形狀多一欄卻沒有對應的來源欄位」與「政府多一欄卻沒有進形狀」
 * 兩個方向都當場編譯不過，不需要在兩個地方各維護一份欄位清單。
 *
 * ## 負擔比率寫在**表頭**裡，因此表頭比對同時是「比率有沒有變」的檢查
 *
 * `（負擔比率30%）`、`（負擔比率60%）`、`（補助比率10%）` 是政府欄位名的一部分。
 * 比率改了 → 表頭對不上 → 同步失敗。這是要的：分擔比率調整是法規變更，
 * 而它在資料列上完全看不出來——每一格都還是一個合法的金額。
 *
 * **因此本形狀刻意不另外存一份比率欄位**：存了就會有兩份真相（表頭一份、`data` 一份），
 * 而它們不一致時沒有任何地方會報錯。要知道當期比率，看的是版本的 `raw_data` 表頭。
 *
 * ## 一到三眷口的金額是「本人 × 2／3／4」，這件事由解析器驗算
 *
 * 實測 19 個版本、全部列都成立。這個檢查**不需要引進任何法規知識**——四個數字都在同一列裡，
 * 對不起來就是欄位換了位置或我們讀錯了欄，而換位置之後每一個值單獨看都完全合法。
 */
const HEALTH_INSURANCE_PREMIUM_SHARE_SHAPE = Type.Object({
  /**
   * 投保金額等級（級數）。**是字串不是數字**：它是代碼不是量。
   *
   * ⚠️ **不是 `record_key`，而且政府那一份真的打錯過**：107年1月那一份的第 28 列寫成 `8`
   *（2026-08 實測）。識別這一列的是月投保金額，不是這一欄，理由見解析器。
   */
  grade: Type.String({ pattern: '^\\d+$' }),
  /**
   * 月投保金額：這一級的計算基數，也是 `record_key` 的來源。
   *
   * 與 `dataset_code=2` 的 {@link HEALTH_INSURANCE_SALARY_GRADE_SHAPE} 的 `monthlyInsuredAmount`
   * 是**同一個概念的同一個值**——兩張表是同一組級距的兩面（一面是「薪資落在第幾級」，
   * 一面是「這一級要繳多少」），因此兩邊的 `record_key` 刻意用同一種寫法。
   */
  monthlyInsuredAmount: DecimalString,
  /** 本人（被保險人）負擔金額，無眷口。政府已經算好並取捨過，不要再自己乘比率。 */
  insuredShareAmount: DecimalString,
  /** 本人 ＋ 1 眷口負擔金額（實測恆為本人金額的 2 倍）。 */
  insuredWithOneDependentAmount: DecimalString,
  /** 本人 ＋ 2 眷口負擔金額（實測恆為本人金額的 3 倍）。 */
  insuredWithTwoDependentsAmount: DecimalString,
  /**
   * 本人 ＋ 3 眷口負擔金額（實測恆為本人金額的 4 倍）。
   *
   * **健保的眷口負擔以 3 口為上限**（第 4 口起不再計收），因此這一欄同時是「3 口以上」的金額；
   * 政府那一份就只給到這裡，我們不替它補第 4 欄。
   */
  insuredWithThreeDependentsAmount: DecimalString,
  /** 投保單位負擔金額。 */
  employerShareAmount: DecimalString,
  /** 政府補助金額。 */
  governmentSubsidyAmount: DecimalString,
})

/**
 * `dataset_code = 3` 勞工退休金月提繳工資分級表的 `data`（data.gov.tw `6274` 的 JSON 資源）。
 *
 * 政府那一份每一列長這樣（2026-08 實測，62 列）：
 *
 * ```json
 * {"等級":"1","實際工資/執行業務所得":"1500以下",
 *  "月提繳工資金額/月提繳執行業務所得金額":"1500","生效日":"1150101","備註":""}
 * ```
 *
 * | 政府欄位 | 去哪裡 |
 * |---|---|
 * | `生效日` | **版本的 `effective_from`**，不進 `data`（理由同 `dataset_code=1`：抄一份會有第二份真相） |
 * | `等級` | {@link grade} ＋ `records.code` ＋ `records.sort_order` |
 * | `實際工資/執行業務所得` | {@link actualWageRangeText} ＋ `range_from`／`range_to` |
 * | `月提繳工資金額/月提繳執行業務所得金額` | {@link monthlyContributionWage} ＋ `records.amount` |
 * | `備註` | {@link remark} |
 *
 * ## 與 `dataset_code=1` 的差別：這裡沒有身分別，因此沒有字面值聯集
 *
 * `1` 的分級表按四種投保身分別各給一套級距，`3` 只有一套（雇主提繳與自願提繳共用同一張表），
 * 於是**沒有任何一欄是「固定代碼」**。這不是漏了收斂——`等級` 是 1…62 的序數，
 * 把它寫成 62 個字面值只會讓政府每次增減級距都變成編譯錯誤，而增減級距是這張表的常態。
 * 完整性由解析器的「級數連號、級距首尾相接」守（見 `sync/domain/` 的解析器），不是由型別守。
 *
 * ## `備註` 保留，即使實測 62 列全是空字串
 *
 * 空的時候是 `null`。留著它的理由是**它一旦有值就是法規內容**（例如某一級加註適用對象），
 * 而丟掉的那一刻不會有任何症狀：資料看起來完整、金額全對，只是少了一句政府特地寫上去的話。
 */
const LABOR_PENSION_CONTRIBUTION_WAGE_SHAPE = Type.Object({
  /** 月提繳工資等級（級數）。**是字串不是數字**：它是代碼不是量，不參與任何運算。 */
  grade: Type.String({ pattern: '^\\d+$' }),
  /** 政府原文的實際工資區間（`1501至3000`）。**沒有「元」字**，與 `dataset_code=1` 不同。 */
  actualWageRangeText: Type.String({ minLength: 1 }),
  /** 實際工資下限（含）。最低一級是「N 以下」，沒有下限，因此為 `null`（理由同 `dataset_code=1`）。 */
  actualWageFrom: Type.Union([DecimalString, Type.Null()]),
  /** 實際工資上限（含）。最高一級是「N 以上」，沒有上限，因此為 `null`。 */
  actualWageTo: Type.Union([DecimalString, Type.Null()]),
  /**
   * 這一級的月提繳工資金額：雇主據以提繳 6% 的法定基數。
   *
   * **不等於級距上限**——最高一級的區間是「147901以上」而金額是 `150000`，
   * 兩者是不同的東西，因此各佔一欄而不是共用 `range_to`。
   */
  monthlyContributionWage: DecimalString,
  /** 政府的 `備註` 原文；空字串一律收斂成 `null`（見上）。 */
  remark: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
})

/**
 * `dataset_code = 4` 勞就保保險費分擔金額表的 `data`（data.gov.tw `6259` 的 JSON 資源）。
 *
 * 政府那一份每一列長這樣（2026-08 實測，28 列）：
 *
 * ```json
 * {"序號":"1","勞保普通費率":"11.5%","就保費率":"1%","投保薪資":"11100",
 *  "勞工應負擔保費金額":"277","單位應負擔保費金額":"972"}
 * ```
 *
 * ## 這是「金額表」不是「費率表」，計畫 §3.1 為此推翻過一次設計
 *
 * 政府把每一級要繳多少錢都算好了，因此 Payroll **查表**即可，不必自己乘費率再取捨。
 * 連帶好處是繞開了一個坑：勞保普通事故費率 11.5% 自**民國 114 年 1 月 1 日**起生效，
 * 而這張分擔金額表的資源說明寫的是「自 115 年 1 月 1 日起適用」。
 * 若這一格當初做成「勞保費率」，照資源說明建版本會讓 114 年整年的結算抓到錯的版本邊界。
 *
 * ⚠️ **因此 {@link laborInsuranceRate} 這一欄的生效日不是這個版本的 `effective_from`。**
 * 版本的生效日是**這張金額表**的適用日；費率欄只是政府在每一列上重複標註的計算依據。
 * 要「勞保費率從哪天開始是 11.5%」這個答案的人，不能從這個資料集的版本邊界去讀。
 *
 * ## 費率存成比率（`0.115`）而不是百分比數字（`11.5`）
 *
 * 與 `dataset_code=10` 已經寫進資料庫的 `{"item":"rate","rate":"0.0211"}` 同一種表達法。
 * 兩種表達法混用是本模組最容易發生的靜默錯誤：兩者都是合法的 decimal 字串、都通得過形狀驗證，
 * 而算出來的金額差 100 倍。轉換在 `sync/domain/regulatory-amount.ts` 一次決定。
 */
const LABOR_EMPLOYMENT_INSURANCE_PREMIUM_SHARE_SHAPE = Type.Object({
  /** 這一級的月投保薪資。與 `dataset_code=1` 的 `monthlyInsuredSalary` 是同一個概念的值。 */
  insuredSalary: DecimalString,
  /** 勞工保險普通事故保險費率，比率（實測 `11.5%` → `0.115`）。生效日的警告見上。 */
  laborInsuranceRate: DecimalString,
  /** 就業保險費率，比率（實測 `1%` → `0.01`）。 */
  employmentInsuranceRate: DecimalString,
  /** 勞工（被保險人）應負擔的保費金額，含就業保險。政府已經算好並取捨過，不要再自己乘。 */
  employeeShareAmount: DecimalString,
  /** 投保單位應負擔的保費金額，含就業保險。 */
  employerShareAmount: DecimalString,
})

/**
 * `dataset_code = 6` 勞工職業災害保險行業別費率的 `data`（data.gov.tw `6262` 的 JSON 資源）。
 *
 * 政府那一份每一列長這樣（2026-08 實測，55 列、19 種大分類）：
 *
 * ```json
 * {"序號":"1","大分類":"農、林、漁、牧業","費率編號":"1","行業類別":"農、林、牧業",
 *  "行業別費率%":"0.18","上下班費率%":"0.07","災保費率%":"0.25"}
 * ```
 *
 * ## `大分類` 收斂成 19 個字面值，理由與 `dataset_code=1` 的 `身分別` 逐字同構
 *
 * 公司在 `company_regulatory_settings` 上設定自己屬於哪一個行業，Payroll **依行業挑費率**
 * （最低 0.04%、最高 0.89%，差 20 倍以上）。寫成 `Type.String()` 之後，政府哪天改了某個大分類的
 * 措辭，解析會**通過驗證**，然後那個行業的公司在查詢時對不上，職災保費悄悄算成另一個數字。
 *
 * **代價要寫清楚：政府新增或改名一個大分類時，這個資料集會同步失敗。** 那是要的——
 * 行業標準分類改版是三年一次的大事，Payroll 必須知道它發生了。
 * 這 19 個值就是中華民國行業標準分類的 19 個大類，實測的順序與它一致。
 *
 * ## 三個費率各佔一欄，而且解析器會驗 `行業別 ＋ 上下班 = 災保`
 *
 * 政府自己給了三個數字，實測 55 列全部對得起來。這個檢查**不需要引進任何法規知識**
 * ——三個數字都在同一列裡，對不起來就是欄位換了位置或我們讀錯了欄，
 * 而欄位換位置之後每一個值單獨看都完全合法（都是 0.0x 的小數）。
 *
 * `records.rate` 放的是 {@link occupationalAccidentRate}（實際適用的合計費率），
 * 不是行業別費率——那一欄是「這一列的費率是多少」，答案只有合計那一個。
 */
const OCCUPATIONAL_ACCIDENT_INSURANCE_RATE_SHAPE = Type.Object({
  /**
   * 行業大分類代碼。19 個值即政府那一份的 19 種 `大分類`（＝行業標準分類的 19 大類），理由見上。
   *
   * 用**我們的代碼**而不是中文原文：原文是政府的顯示字串，改一個標點（`公共行政及國防；強制性社會安全`
   * 那個分號）就會讓每一筆的值變成新的，而 Payroll 那一側是拿代碼去比對的。
   */
  majorCategoryCode: Type.Union([
    /** 農、林、漁、牧業。 */
    Type.Literal('agricultureForestryFishingAnimalHusbandry'),
    /** 礦業及土石採取業。 */
    Type.Literal('miningAndQuarrying'),
    /** 製造業。 */
    Type.Literal('manufacturing'),
    /** 電力及燃氣供應業。 */
    Type.Literal('electricityAndGasSupply'),
    /** 用水供應及污染整治業。 */
    Type.Literal('waterSupplyAndRemediation'),
    /** 營建工程業。 */
    Type.Literal('construction'),
    /** 批發及零售業。 */
    Type.Literal('wholesaleAndRetailTrade'),
    /** 運輸及倉儲業。 */
    Type.Literal('transportationAndStorage'),
    /** 住宿及餐飲業。 */
    Type.Literal('accommodationAndFoodServices'),
    /** 出版影音及資通訊業。 */
    Type.Literal('publishingAudioVisualAndIct'),
    /** 金融及保險業。 */
    Type.Literal('financeAndInsurance'),
    /** 不動產業。 */
    Type.Literal('realEstate'),
    /** 專業、科學及技術服務業。 */
    Type.Literal('professionalScientificAndTechnicalServices'),
    /** 支援服務業。 */
    Type.Literal('supportServices'),
    /** 公共行政及國防；強制性社會安全。 */
    Type.Literal('publicAdministrationAndDefence'),
    /** 教育業。 */
    Type.Literal('education'),
    /** 醫療保健及社會工作服務業。 */
    Type.Literal('humanHealthAndSocialWork'),
    /** 藝術、娛樂及休閒服務業。 */
    Type.Literal('artsEntertainmentAndRecreation'),
    /** 其他服務業。 */
    Type.Literal('otherServices'),
  ]),
  /** 政府原文的大分類（`農、林、漁、牧業`）。保留原文供對帳：代碼是我們取的，原文才是公告上的字。 */
  majorCategoryName: Type.String({ minLength: 1 }),
  /**
   * 政府的 `費率編號`。**這是公司設定會存下來的那個代碼**（計畫 §3.1「行業別代碼政府會改」），
   * 也是 `record_key` 的來源。是字串不是數字：它是代碼不是量。
   */
  rateCode: Type.String({ pattern: '^\\d+$' }),
  /** 政府原文的行業類別（`石油及天然氣礦業、砂、石採取及其他礦業`）。這是 55 個細項那一層。 */
  industryName: Type.String({ minLength: 1 }),
  /** 行業別災害費率，比率（實測 `0.18`＝0.18% → `0.0018`）。欄位名的 `%` 是單位，值本身不帶百分號。 */
  industryRate: DecimalString,
  /** 上下班災害費率，比率（實測 55 列全為 `0.07`＝0.07% → `0.0007`）。 */
  commutingRate: DecimalString,
  /** 實際適用的職災保險費率＝行業別＋上下班，比率（實測 `0.25`＝0.25% → `0.0025`）。 */
  occupationalAccidentRate: DecimalString,
})

/** 日曆日 `YYYY-MM-DD`（台北，§6）。與 `effective_from` 同一種寫法，全程不經過 `Date`。 */
const CalendarDateString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })

/**
 * `dataset_code = 8` 最低工資（月薪與時薪）的 `data`
 * （勞動部「歷年最低工資/基本工資調整」公告頁，計畫 §7.0 的兩條路裡的第一條）。
 *
 * 政府那一頁的一則公告長這樣（2026-08 實測，逐字）：
 *
 * ```
 * 民國114年10月21日發布，自115年1月1日起實施，訂定每月最低工資為29,500元，每小時最低工資為196元。
 * ```
 *
 * **一則公告 → 一個版本 → 兩筆 record**（月薪一筆、時薪一筆）。
 *
 * ## 為什麼是兩筆 record 而不是一筆帶兩個金額的
 *
 * 形式與 `dataset_code=10` 的補充保險費逐字相同（`rate`／`chargeLowerBound`／
 * `singlePaymentUpperLimit` 三筆），而理由也一樣：`regulatory_records` 的 `amount` 欄位
 * 是「這一筆的金額」，一筆塞兩個金額就得有一個欄位空著或另外編一個名字。
 * 兩筆之後，Payroll 問「這一天的每月最低工資是多少」拿到的就是一筆 record 的 `amount`。
 *
 * ## `item` 是字面值聯集，理由與 `dataset_code=10` 的 `item` 逐字同構（§2）
 *
 * 寫成 `Type.String()` 之後，解析器打錯一個字母會**通過驗證**，然後 Payroll 找不到那一項，
 * 於是最低工資檢核靜靜地不做——一個不會報錯的漏洞。
 *
 * ## 為什麼有 `announcedOn` 與 `announcementText`，卻沒有 `effectiveFrom`
 *
 * 生效日是**版本的屬性**（`effective_from`），抄一份進 `data` 會產生第二份真相，
 * 理由與 `dataset_code=1`、`3` 逐字相同。
 *
 * 但**發布日在版本上沒有對應欄位**（`source_modified_at` 是「政府標示的檔案修改時間」，
 * 不是「這則公告哪天發布」），而它是對帳時唯一能指認「是哪一則公告」的東西——
 * 同一個實施日不會有兩則公告，但公告本身的日期是公報上查得到的那個號碼的同義詞。
 * `announcementText` 同理：政府原文留著，拆解結果對不上時要能回頭看原文
 * （與 `dataset_code=1` 的 `monthlySalaryRangeText` 同一條）。
 *
 * ⚠️ 兩筆 record 的這兩欄**值相同**（它們出自同一句話）。這是刻意的，不是冗餘：
 * 兩筆各自完整，Payroll 取其中一筆時不必再回頭找另一筆。
 *
 * ## 涵蓋範圍：**民國 114 年 1 月起**，之前的基本工資不在這個資料集裡
 *
 * 勞動部把 113 年以前的調整放在另一頁（「基本工資之制訂與調整經過」），
 * 而那一頁**刻意不爬**——理由不是它難解析，是它有「只調月薪」與「只調時薪」的單值公告
 * （實測：102年1月1日只調時薪 109 元、102年4月1日只調月薪 19,047 元）。
 * 完整論述在 `sync/domain/regulatory-minimum-wage.ts` 的檔頭。
 */
const MINIMUM_WAGE_SHAPE = Type.Union([
  /** 每月最低工資，例如 `29500`。 */
  Type.Object({
    item: Type.Literal('monthly'),
    amount: DecimalString,
    announcedOn: CalendarDateString,
    announcementText: Type.String({ minLength: 1 }),
  }),
  /** 每小時最低工資，例如 `196`。 */
  Type.Object({
    item: Type.Literal('hourly'),
    amount: DecimalString,
    announcedOn: CalendarDateString,
    announcementText: Type.String({ minLength: 1 }),
  }),
])

/**
 * 扣繳稅額表的「配偶及受扶養親屬人數」欄位（`dataset_code=9`）。
 *
 * **這一份清單是政府那張表的欄位數與本形狀的陣列長度的共同來源**，因此兩者不可能分岔：
 * 下面 {@link WITHHOLDING_TAX_BRACKET_SHAPE} 的 `taxByDependentCount` 用它的長度當
 * `minItems`／`maxItems`，而 `sync/domain/regulatory-withholding-tax.ts` 用它逐一組出
 * CSV 的 12 個欄位名（`配偶及受扶養親屬計0人(元)`…）。
 *
 * 政府少發一欄 → 表頭比對失敗；形狀少一格 → 這裡的長度變了、表頭跟著變、同樣失敗。
 * 兩個地方各寫一次 `12` 的話，「政府從 11 人擴到 12 人」會變成一份**通過驗證但少一欄**的資料，
 * 而少的那一欄正好是扶養人數最多、稅額最低的那一群人。
 *
 * 上限 11 人是政府那張表自己的上限（實測 107–115 八個年度皆然），不是我們訂的。
 */
export const WITHHOLDING_TAX_DEPENDENT_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const

/**
 * `dataset_code = 9` 薪資所得扣繳稅額表的 `data`
 * （財政部臺北國稅局 Open Data 下載專區的 **CSV**，**不是** data.gov.tw `25627`，計畫 §7.0）。
 *
 * 政府那一份的表頭與資料列長這樣（2026-08 實測，115 年度那一份 840 列）：
 *
 * ```csv
 * 每月薪資所得,配偶及受扶養親屬計0人(元),…,配偶及受扶養親屬計11人(元)
 * "80,001 ~ 80,500",0,0,0,0,0,0,0,0,0,0,0,0
 * "499,501 ~ 500,000",100700,97340,93970,91430,88900,86380,83850,81330,78800,76280,73750,71230
 * ```
 *
 * | 政府欄位 | 去哪裡 |
 * |---|---|
 * | `每月薪資所得` | {@link monthlySalaryRangeText} ＋ `range_from`／`range_to` |
 * | 12 個 `配偶及受扶養親屬計N人` | {@link taxByDependentCount}（**依人數排序的 12 格**） |
 *
 * ## 為什麼是一列一筆、12 個稅額放在同一筆的陣列裡
 *
 * 另一種做法是「薪資級距 × 扶養人數」各一筆（840 × 12 ＝ 10,080 筆／版本）。不這樣做的理由是
 * **政府那一份的一列就是一個級距**：一列裡的 12 個數字回答的是同一個問題的 12 種情況，
 * 拆開之後「這一級的資料完整嗎」要靠數筆數才答得出來，而少了其中一格不會有任何地方報錯。
 * 收成陣列之後，「必須剛好 12 格」由形狀驗證擋（見 {@link WITHHOLDING_TAX_DEPENDENT_COUNTS}）。
 *
 * ## 這張表**沒有**開放的一端，與四張分級表相反
 *
 * 分級表的最低一級是「N以下」、最高一級是「N以上」（`null` 表示那一邊沒有界線），
 * 扣繳稅額表則是**每一列兩端都有界線**，最後一列到 `499,501 ~ 500,000` 就停了
 * （超過 50 萬另依公式計算，不在這張表上）。因此這裡兩欄都不是 `Type.Union([…, Type.Null()])`
 * ——真的出現開放的一端，代表政府改了這張表的組織方式，那必須失敗。
 * 「被截斷」由解析器的尾端錨定擋（見那支解析器的完整性檢查）。
 *
 * ## 稅額 `0` 是真的 0，不是「沒有資料」
 *
 * 起扣點以下的列每一格都是 `0`（實測 115 年度前 17 列）。因此形狀上它與其他金額一樣是
 * decimal 字串，**不允許 `null`**：允許 `null` 之後，一個讀不到值的欄位會與「這一級不用扣繳」
 * 長得一模一樣，而後者是法定結果。
 */
const WITHHOLDING_TAX_BRACKET_SHAPE = Type.Object({
  /** 政府原文的每月薪資所得區間（`80,001 ~ 80,500`）。**分隔符號是空格包住的半形波浪號**。 */
  monthlySalaryRangeText: Type.String({ minLength: 1 }),
  /** 每月薪資所得下限（含）。這張表沒有「N以下」那種開放的一端，因此必填（見上）。 */
  monthlySalaryFrom: DecimalString,
  /** 每月薪資所得上限（含）。同上，必填。 */
  monthlySalaryTo: DecimalString,
  /**
   * 這一級在各扶養人數下的應扣繳稅額，**索引即人數**（第 0 格是 0 人、第 11 格是 11 人）。
   *
   * 長度由 {@link WITHHOLDING_TAX_DEPENDENT_COUNTS} 釘死，不是寫一個 `12`——理由見那個常數。
   * 值一律 decimal 字串，禁止 `Number(...)`（§4.7）。
   */
  taxByDependentCount: Type.Array(DecimalString, {
    minItems: WITHHOLDING_TAX_DEPENDENT_COUNTS.length,
    maxItems: WITHHOLDING_TAX_DEPENDENT_COUNTS.length,
  }),
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
  // 九個資料集的形狀現在**全部都定了**：每一個都是跟著它自己的解析器一起確定的
  // （計畫 §6：先看過政府真實資料才知道每個欄位叫什麼）。
  //
  // 這裡曾經有一個 `Type.Never()` 的佔位形狀給還沒有解析器的 `8`、`9` 用，現在沒有了——
  // 留著一個沒有人指向的佔位常數，下一個資料集會**理所當然地**先指向它，
  // 而那正好跳過「形狀要跟解析器一起定」這個決定。真的又多一個資料集時，重新寫一個就好。
  1: LABOR_INSURANCE_SALARY_GRADE_SHAPE,
  2: HEALTH_INSURANCE_SALARY_GRADE_SHAPE,
  3: LABOR_PENSION_CONTRIBUTION_WAGE_SHAPE,
  4: LABOR_EMPLOYMENT_INSURANCE_PREMIUM_SHARE_SHAPE,
  5: HEALTH_INSURANCE_PREMIUM_SHARE_SHAPE,
  6: OCCUPATIONAL_ACCIDENT_INSURANCE_RATE_SHAPE,
  // `7` 是永久空號（見 `regulatory-dataset-code.ts`），因此這裡也沒有它——
  // 補一個進來就等於讓那個空號變成「一個沒有形狀的資料集」。
  8: MINIMUM_WAGE_SHAPE,
  9: WITHHOLDING_TAX_BRACKET_SHAPE,
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
  { readonly ok: true; readonly value: RegulatoryRecordData<TCode> } | { readonly ok: false; readonly reason: string }

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
