/**
 * 級距表的欄位定義：代碼 1／2／3／5（§0.7 從 `.columns.view.ts` 依資料集族群再拆出的兄弟檔，
 * 分組理由見該檔檔頭）。
 *
 * 四份的共同形狀是「級距（或級距的區間文字）＋ 區間上下限 ＋ 對應金額」——勞保投保薪資分級表、
 * 健保投保金額分級表、勞退月提繳工資分級表、健保費負擔金額表都是同一種「查表定級距」的畫面。
 * 放在同一份檔案不是因為程式碼共用（各欄的鍵完全不同，仍然逐一列出），是因為**審閱時這四份
 * 應該放在一起看**：改動其中一份的欄位排法時，另外三份是最直接的參照。
 */
import type { DatasetCode } from './regulatory-datasets.payload.ts'
import type { ColumnsBuilder } from './regulatory-datasets.record.view.ts'
import { amountColumn, textColumn } from './regulatory-datasets.record-columns.view.ts'

/** 資料集代碼 → 欄位定義。`Pick<Record<DatasetCode, …>, …>` 讓這裡的 `satisfies` 只鎖住這四碼。 */
export const BRACKET_TABLE_COLUMNS = {
  // 勞工保險投保薪資分級表。四種身分別各一套級距，因此身分別排第一欄——
  // 少了它，同一個「等級 1」會在表上出現四次而看不出差別。
  1: () => [
    textColumn('insuredCategoryName', 'regulatory-datasets.field.insured-category', 120),
    textColumn('grade', 'regulatory-datasets.field.grade', 72),
    textColumn('monthlySalaryRangeText', 'regulatory-datasets.field.monthly-salary-range', 160),
    amountColumn('monthlySalaryFrom', 'regulatory-datasets.field.range-from', 110),
    amountColumn('monthlySalaryTo', 'regulatory-datasets.field.range-to', 110),
    amountColumn('monthlyInsuredSalary', 'regulatory-datasets.field.monthly-insured-salary', 120),
  ],

  // 全民健康保險投保金額分級表。
  2: () => [
    textColumn('grade', 'regulatory-datasets.field.grade', 72),
    textColumn('groupRangeText', 'regulatory-datasets.field.group-range', 150),
    amountColumn('monthlyInsuredAmount', 'regulatory-datasets.field.monthly-insured-amount', 120),
    textColumn('actualSalaryRangeText', 'regulatory-datasets.field.actual-salary-range', 150),
    amountColumn('actualSalaryFrom', 'regulatory-datasets.field.range-from', 110),
    amountColumn('actualSalaryTo', 'regulatory-datasets.field.range-to', 110),
  ],

  // 勞工退休金月提繳工資分級表。`備註` 實測全是空字串，但它一旦有值就是法規內容，所以留著。
  3: () => [
    textColumn('grade', 'regulatory-datasets.field.grade', 72),
    textColumn('actualWageRangeText', 'regulatory-datasets.field.actual-wage-range', 150),
    amountColumn('actualWageFrom', 'regulatory-datasets.field.range-from', 110),
    amountColumn('actualWageTo', 'regulatory-datasets.field.range-to', 110),
    amountColumn('monthlyContributionWage', 'regulatory-datasets.field.monthly-contribution-wage', 130),
    textColumn('remark', 'regulatory-datasets.field.remark', 120),
  ],

  // 健保費負擔金額表（有一定雇主之受僱者）。八欄與政府那一份一對一。
  5: () => [
    textColumn('grade', 'regulatory-datasets.field.grade', 72),
    amountColumn('monthlyInsuredAmount', 'regulatory-datasets.field.monthly-insured-amount', 120),
    amountColumn('insuredShareAmount', 'regulatory-datasets.field.insured-share', 110),
    amountColumn('insuredWithOneDependentAmount', 'regulatory-datasets.field.insured-with-1', 110),
    amountColumn('insuredWithTwoDependentsAmount', 'regulatory-datasets.field.insured-with-2', 110),
    amountColumn('insuredWithThreeDependentsAmount', 'regulatory-datasets.field.insured-with-3', 110),
    amountColumn('employerShareAmount', 'regulatory-datasets.field.employer-share', 120),
    amountColumn('governmentSubsidyAmount', 'regulatory-datasets.field.government-subsidy', 110),
  ],
} as const satisfies Pick<Record<DatasetCode, ColumnsBuilder>, 1 | 2 | 3 | 5>
