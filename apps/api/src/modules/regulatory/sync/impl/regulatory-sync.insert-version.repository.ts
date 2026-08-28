/**
 * 資料存取：寫入一個法規資料版本（`regulatory_dataset_versions` 的一列）。
 *
 * **呼叫端必須在交易內呼叫它**（§4.4：交易邊界屬於 service 層，repository 不自開交易）：
 * 版本與它的 records 是同一個業務操作，只成功一半會留下一個「有版本、沒有內容」的殼，
 * 而 `resolve` 會查到它、回一張空的分級表——Payroll 拿到的是「這一天的法規是空的」。
 *
 * ## `effective_to` 幾乎總是 `null`，而它**只能由來源明示**
 *
 * 計畫 §3.2 (d)：**只在政府明示失效日時才寫入，不拿來記「下一版開始日的前一天」。**
 * 這是本表最容易寫錯的地方——順手 UPDATE 前一版的 `effective_to`，那個 UPDATE 漏掉不會有
 * 任何錯誤，只會讓兩個版本同時宣稱自己在某一天有效。
 *
 * 八個自動同步的來源裡**只有一個**有明示失效日：`dataset_code=9` 薪資所得扣繳稅額表，
 * 它的資源名稱寫著「115年度」，那四個字本身就宣告了它管到當年 12 月 31 日為止
 * （推導在 `sync/domain/regulatory-roc-date.ts` 的 `parseRocFiscalYear`）。
 *
 * 因此這個參數存在、而且是**必填**：寫成選填之後，下一個資料集會在沒有做任何決定的情況下
 * 落到 `null`——而 `9` 的例子說明那個預設值是有代價的（少了訖日，補算民國 110 年度會挑到
 * 109 年度那一張表，回一個完全合理的錯誤稅額）。必填則是「每個來源都必須回答這個問題」。
 *
 * ⚠️ 這一欄的值只能來自**資源自己的名字或內容**。本檔沒有、也不得有任何「看下一版是哪一天」的查詢。
 */
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions, type RegulatoryRawFormatValue } from '../../../../db/schema/index.ts'

export type InsertDatasetVersionInput = {
  readonly datasetCode: number
  readonly versionCode: string
  readonly effectiveFrom: string
  /** 政府**明示**的失效日；沒有明示就是 `null`（見檔頭）。 */
  readonly effectiveTo: string | null
  readonly governmentResourceId: string | null
  /** 政府標示的修改時間，**已在解析階段換算成台北牆鐘**（§6、計畫 §3.2）。 */
  readonly sourceModifiedAt: string | null
  readonly syncedAt: string
  readonly checksum: string
  readonly recordCount: number
  readonly rawFormatCode: RegulatoryRawFormatValue
  /** 政府原始 Snapshot（未經任何前處理的那一串）。保存它才有「解析器改了之後重跑」這條路。 */
  readonly rawData: string
  readonly createdAt: string
}

export const insertDatasetVersion = async (runner: QueryRunner, input: InsertDatasetVersionInput): Promise<number> => {
  const [header] = await runner.insert(regulatoryDatasetVersions).values({
    datasetCode: input.datasetCode,
    versionCode: input.versionCode,
    effectiveFrom: input.effectiveFrom,
    // 只有來源明示時才有值（見檔頭）。沒有明示時是 `null`，有效區間由下一版的
    // `effective_from` **推導**，不寫入。
    effectiveTo: input.effectiveTo,
    governmentResourceId: input.governmentResourceId,
    sourceModifiedAt: input.sourceModifiedAt,
    syncedAt: input.syncedAt,
    checksum: input.checksum,
    recordCount: input.recordCount,
    rawFormatCode: input.rawFormatCode,
    rawData: input.rawData,
    createdAt: input.createdAt,
  })

  return header.insertId
}
