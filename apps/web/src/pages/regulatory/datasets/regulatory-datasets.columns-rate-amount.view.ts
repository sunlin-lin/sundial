/**
 * 費率與金額表的欄位定義：代碼 4／6（§0.7 從 `.columns.view.ts` 依資料集族群再拆出的兄弟檔，
 * 分組理由見該檔檔頭）。
 *
 * 兩份的共同形狀是「金額或費率並列」而不是「查表定級距」——勞就保保險費分擔金額表已經是
 * 政府算好的金額，費率欄只是政府在每一列上重複標註的計算依據；職災費率表則是三個費率並列，
 * 完全沒有金額欄。兩者都不屬於 `.columns-bracket.view.ts` 那種「級距 → 金額」的形狀，因此獨立成組。
 */
import type { DatasetCode } from './regulatory-datasets.payload.ts'
import type { ColumnsBuilder } from './regulatory-datasets.record.view.ts'
import { amountColumn, rateColumn, textColumn } from './regulatory-datasets.record-columns.view.ts'

/** 資料集代碼 → 欄位定義。`Pick<Record<DatasetCode, …>, …>` 讓這裡的 `satisfies` 只鎖住這兩碼。 */
export const RATE_AMOUNT_TABLE_COLUMNS = {
  // 勞就保保險費分擔金額表。**這是金額表不是費率表**：政府已經算好每一級要繳多少，
  // 兩個費率欄只是政府在每一列上重複標註的計算依據（後端 schema 的警告）。
  4: () => [
    amountColumn('insuredSalary', 'regulatory-datasets.field.insured-salary', 120),
    rateColumn('laborInsuranceRate', 'regulatory-datasets.field.labor-insurance-rate', 110),
    rateColumn(
      'employmentInsuranceRate',
      'regulatory-datasets.field.employment-insurance-rate',
      110,
    ),
    amountColumn('employeeShareAmount', 'regulatory-datasets.field.employee-share', 120),
    amountColumn('employerShareAmount', 'regulatory-datasets.field.employer-share', 120),
  ],

  // 勞工職業災害保險行業別費率。三個費率各佔一欄（行業別 ＋ 上下班 ＝ 災保，後端會驗算）。
  6: () => [
    textColumn('majorCategoryName', 'regulatory-datasets.field.major-category', 150),
    textColumn('rateCode', 'regulatory-datasets.field.rate-code', 90),
    textColumn('industryName', 'regulatory-datasets.field.industry-name', 220),
    rateColumn('industryRate', 'regulatory-datasets.field.industry-rate', 110),
    rateColumn('commutingRate', 'regulatory-datasets.field.commuting-rate', 110),
    rateColumn(
      'occupationalAccidentRate',
      'regulatory-datasets.field.occupational-accident-rate',
      120,
    ),
  ],
} as const satisfies Pick<Record<DatasetCode, ColumnsBuilder>, 4 | 6>
