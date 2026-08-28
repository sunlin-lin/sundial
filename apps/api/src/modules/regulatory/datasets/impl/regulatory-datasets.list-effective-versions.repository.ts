/**
 * 資料存取：**全部資料集**在某一基準日各自適用的版本（`overview` 動作用，
 * 實作計畫 03 §3、任務一）。
 *
 * ## 這是批次版本，不是對 `find-effective-version.repository.ts` 的迴圈呼叫
 *
 * 總覽要九個資料集的答案。逐一呼叫單一資料集那支查詢會是九次資料庫往返
 * ——後端規範 §4.5 禁止的正是這種形狀（一頁 20 筆資料各查一次關聯主檔）。這裡改成
 * **一次查詢涵蓋全部資料集代碼**，`ORDER BY dataset_code, effective_from DESC, id DESC`
 * 之後在記憶體裡對已排序好的結果做一次濾重（每個 `dataset_code` 只留第一次出現的那一列）。
 * SQL 沒有跨資料庫都通用的「每組取一筆」語法，這個「排序 ＋ 濾重」的組合是**單一查詢**，
 * 不是逐筆查詢的另一種寫法。
 *
 * **`ORDER BY` 的次要鍵與 `find-effective-version.repository.ts` 逐字相同**（計畫 §3.2 (d)：
 * 「同日生效時，後寫入的版本優先」）：兩者必須挑出同一版，否則總覽顯示的版本會與
 * `resolve` 實際會用到的版本不一致——使用者在總覽看到一個版本代碼，點進去卻解析出另一版。
 *
 * 本表禁止 `SELECT *`（計畫 §3.2 (c)），因此逐欄列出，`rawData` 一個字都沒出現，
 * 理由與 `find-effective-version.repository.ts`、`list-versions.repository.ts` 相同。
 */
import { and, asc, desc, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions } from '../../../../db/schema/index.ts'
import { toDatasetVersionDetail, type DatasetVersionDetail } from '../domain/regulatory-dataset-model.ts'

export const listEffectiveVersionsAsOf = async (
  runner: QueryRunner,
  datasetCodes: readonly number[],
  asOfDate: string,
): Promise<readonly DatasetVersionDetail[]> => {
  // 空清單不必打資料庫：理由與 `regulatory-sync.list-latest-status.repository.ts` 相同。
  if (datasetCodes.length === 0) return []

  const rows = await runner
    .select({
      id: regulatoryDatasetVersions.id,
      datasetCode: regulatoryDatasetVersions.datasetCode,
      versionCode: regulatoryDatasetVersions.versionCode,
      effectiveFrom: regulatoryDatasetVersions.effectiveFrom,
      effectiveTo: regulatoryDatasetVersions.effectiveTo,
      governmentResourceId: regulatoryDatasetVersions.governmentResourceId,
      sourceModifiedAt: regulatoryDatasetVersions.sourceModifiedAt,
      syncedAt: regulatoryDatasetVersions.syncedAt,
      checksum: regulatoryDatasetVersions.checksum,
      recordCount: regulatoryDatasetVersions.recordCount,
      rawFormatCode: regulatoryDatasetVersions.rawFormatCode,
      createdAt: regulatoryDatasetVersions.createdAt,
    })
    .from(regulatoryDatasetVersions)
    .where(
      and(
        inArray(regulatoryDatasetVersions.datasetCode, datasetCodes),
        // 生效日當天就適用（含當日），理由與單一資料集那支查詢相同。
        lte(regulatoryDatasetVersions.effectiveFrom, asOfDate),
        or(isNull(regulatoryDatasetVersions.effectiveTo), gte(regulatoryDatasetVersions.effectiveTo, asOfDate)),
      ),
    )
    .orderBy(
      asc(regulatoryDatasetVersions.datasetCode),
      desc(regulatoryDatasetVersions.effectiveFrom),
      desc(regulatoryDatasetVersions.id),
    )

  const seen = new Set<number>()
  const result: DatasetVersionDetail[] = []
  for (const row of rows) {
    // 已排序成「同一資料集的適用版本先出現」，因此每個 `dataset_code` 只需要收下第一次遇到的那一列。
    if (seen.has(row.datasetCode)) continue
    seen.add(row.datasetCode)
    // `toDatasetVersionDetail` 內部已經處理 `dataset_code` 對不上清單時的系統錯誤（§3.1.2），
    // 這裡不必重複那段判斷。
    result.push(toDatasetVersionDetail(row))
  }
  return result
}
