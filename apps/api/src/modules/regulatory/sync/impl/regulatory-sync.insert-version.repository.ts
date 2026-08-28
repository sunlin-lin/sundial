/**
 * 資料存取：寫入一個法規資料版本（`regulatory_dataset_versions` 的一列）。
 *
 * **呼叫端必須在交易內呼叫它**（§4.4：交易邊界屬於 service 層，repository 不自開交易）：
 * 版本與它的 records 是同一個業務操作，只成功一半會留下一個「有版本、沒有內容」的殼，
 * 而 `resolve` 會查到它、回一張空的分級表——Payroll 拿到的是「這一天的法規是空的」。
 *
 * ## `effective_to` 一律寫 `null`
 *
 * 計畫 §3.2 (d)：**只在政府明示失效日時才寫入，不拿來記「下一版開始日的前一天」。**
 * 這是本表最容易寫錯的地方——順手 UPDATE 前一版的 `effective_to`，那個 UPDATE 漏掉不會有
 * 任何錯誤，只會讓兩個版本同時宣稱自己在某一天有效。目前九個自動同步的來源沒有任何一個
 * 明示失效日，因此這個參數在簽章上根本不存在（寫不出來，不是「要記得別寫」）。
 */
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions, type RegulatoryRawFormatValue } from '../../../../db/schema/index.ts'

export type InsertDatasetVersionInput = {
  readonly datasetCode: number
  readonly versionCode: string
  readonly effectiveFrom: string
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
    // 政府沒有明示失效日（見檔頭）。有效區間由下一版的 `effective_from` **推導**，不寫入。
    effectiveTo: null,
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
