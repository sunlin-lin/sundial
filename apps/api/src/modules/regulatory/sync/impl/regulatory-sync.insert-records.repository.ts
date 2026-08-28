/**
 * 資料存取：一次寫入一個版本底下的全部 records。
 *
 * **一句 INSERT 寫完，不在迴圈裡逐筆寫**（§4.5）：一張投保薪資分級表 97 列、職災行業別費率上百列，
 * 逐筆寫就是上百次往返，尖峰時段足以耗盡連線池而讓其他端點一起失敗。
 *
 * **呼叫端必須在交易內呼叫它**，與版本那一列同一個交易（§4.4）：計畫 §7.1 明文
 * 「同一交易寫入 version ＋ records」，而字典的要求是「同步失敗不得破壞既有有效版本」。
 */
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryRecords } from '../../../../db/schema/index.ts'

export type InsertRegulatoryRecordInput = {
  readonly datasetVersionId: number
  readonly recordKey: string
  readonly code: string | null
  readonly name: string | null
  /** 四個數值欄位一律 decimal **字串**或 `null`，禁止 `number`（§4.7、計畫 §6.1）。 */
  readonly rangeFrom: string | null
  readonly rangeTo: string | null
  readonly amount: string | null
  readonly rate: string | null
  /** 已依 `dataset_code` 的形狀驗證過（計畫 §6，驗證在 run 切片，寫入前）。 */
  readonly data: unknown
  readonly sortOrder: number | null
  readonly createdAt: string
}

/**
 * @param rows 要寫入的全部 records。空陣列直接不做事——`INSERT ... VALUES ()` 不是合法語句，
 *   而「這一版一筆內容都沒有」這件事該由呼叫端當成錯誤處理，不是在這裡吞掉。
 */
export const insertRegulatoryRecords = async (
  runner: QueryRunner,
  rows: readonly InsertRegulatoryRecordInput[],
): Promise<void> => {
  if (rows.length === 0) return
  await runner.insert(regulatoryRecords).values([...rows])
}
