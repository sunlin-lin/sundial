/**
 * 剩下三個資料集的欄位定義：代碼 8／9／10（§0.7 從 `.columns.view.ts` 依資料集族群再拆出的
 * 兄弟檔，分組理由見該檔檔頭）。
 *
 * 這三份**彼此形狀也不一樣**（最低工資是一則公告拆兩筆 record、扣繳稅額表是一列 12 個稅額、
 * 補充保費是三筆各自只有一個數值欄有值），沒有像 bracket／rate-amount 那樣的共同形狀可以歸類，
 * 因此放在「其他」——但仍然各自是一份小定義，不是三個 `v-if`。
 */
import type { MessageKey } from '../../../shared/i18n/messages.ts'
import type { DatasetCode } from './regulatory-datasets.payload.ts'
import type { ColumnsBuilder } from './regulatory-datasets.record.view.ts'
import {
  amountColumn,
  arrayAmountColumn,
  dateColumn,
  enumColumn,
  rateColumn,
  textColumn,
} from './regulatory-datasets.record-columns.view.ts'

/**
 * 扣繳稅額表的 12 個「配偶及受扶養親屬計 N 人」欄。
 *
 * 明列 12 筆而不是用迴圈組 key：語系 key 必須是字面值型別（`MessageKey`），
 * 用 `${index}` 組出來的字串在型別上只是 `string`，一路過關到執行期變成畫面上的一行 key。
 * 上限 11 人是政府那張表自己的上限，形狀上由後端的 `minItems`／`maxItems` 釘死。
 */
const WITHHOLDING_TAX_LABEL_KEYS = [
  'regulatory-datasets.field.tax-0',
  'regulatory-datasets.field.tax-1',
  'regulatory-datasets.field.tax-2',
  'regulatory-datasets.field.tax-3',
  'regulatory-datasets.field.tax-4',
  'regulatory-datasets.field.tax-5',
  'regulatory-datasets.field.tax-6',
  'regulatory-datasets.field.tax-7',
  'regulatory-datasets.field.tax-8',
  'regulatory-datasets.field.tax-9',
  'regulatory-datasets.field.tax-10',
  'regulatory-datasets.field.tax-11',
] as const satisfies readonly MessageKey[]

/** `dataset_code=8` 的 `item`：一則公告拆成月薪與時薪兩筆 record。 */
const MINIMUM_WAGE_ITEM_LABELS = {
  monthly: 'regulatory-datasets.minimum-wage.monthly',
  hourly: 'regulatory-datasets.minimum-wage.hourly',
} as const satisfies Readonly<Record<string, MessageKey>>

/** `dataset_code=10` 的 `item`：費率與兩個計費門檻，同一次公告的三筆。 */
const SUPPLEMENTARY_PREMIUM_ITEM_LABELS = {
  rate: 'regulatory-datasets.supplementary.rate',
  chargeLowerBound: 'regulatory-datasets.supplementary.charge-lower-bound',
  singlePaymentUpperLimit: 'regulatory-datasets.supplementary.single-payment-upper-limit',
} as const satisfies Readonly<Record<string, MessageKey>>

/** 資料集代碼 → 欄位定義。`Pick<Record<DatasetCode, …>, …>` 讓這裡的 `satisfies` 只鎖住這三碼。 */
export const OTHER_TABLE_COLUMNS = {
  // 最低工資。一則公告 → 一個版本 → 兩筆 record（月薪一筆、時薪一筆）。
  // `announcementText` 是政府原文，**裡面的民國年刻意不轉西元**（計畫 §5.1 的例外）：
  // 那是抄自公告的整段文字，改寫它會讓人對不上公告。
  8: (translate) => [
    enumColumn('item', 'regulatory-datasets.field.item', 130, MINIMUM_WAGE_ITEM_LABELS, translate),
    amountColumn('amount', 'regulatory-datasets.field.amount', 110),
    dateColumn('announcedOn', 'regulatory-datasets.field.announced-on', 110),
    textColumn('announcementText', 'regulatory-datasets.field.announcement-text', 380),
  ],

  // 薪資所得扣繳稅額表。一列一個薪資級距，12 個稅額各佔一欄（交叉查表需要欄）。
  9: () => [
    textColumn('monthlySalaryRangeText', 'regulatory-datasets.field.monthly-salary-range', 150),
    ...WITHHOLDING_TAX_LABEL_KEYS.map((labelKey, index) =>
      arrayAmountColumn('taxByDependentCount', index, labelKey, 92),
    ),
  ],

  // 健保補充保險費。三筆 record 各自只有其中一個數值欄有值，另一欄顯示「沒有值」——
  // 那是正確的：費率那一筆沒有金額，門檻那兩筆沒有費率。
  10: (translate) => [
    enumColumn('item', 'regulatory-datasets.field.item', 170, SUPPLEMENTARY_PREMIUM_ITEM_LABELS, translate),
    rateColumn('rate', 'regulatory-datasets.field.rate', 110),
    amountColumn('amount', 'regulatory-datasets.field.amount', 130),
  ],
} as const satisfies Pick<Record<DatasetCode, ColumnsBuilder>, 8 | 9 | 10>
