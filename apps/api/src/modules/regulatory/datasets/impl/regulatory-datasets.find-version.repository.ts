/**
 * 資料存取：以主鍵取單一版本的 metadata。
 *
 * **不含 `raw_data`**（計畫 §4.2：`/get` 不含 Snapshot；§3.2 (c)：本表禁止 `SELECT *`）。
 * 看原始 Snapshot 的 `/regulatory/datasets/raw` 是**刻意不開**的端點（計畫 D3）：
 * 觸發全平台同步、查看政府原始資料不該由某一家公司的管理者做，而平台管理員這個角色還不存在。
 * 因此這裡不是「暫時沒選這一欄」，而是這一層根本沒有讀出它的理由。
 */
import { eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions } from '../../../../db/schema/index.ts'
import { toDatasetVersionDetail, type DatasetVersionDetail } from '../domain/regulatory-dataset-model.ts'

/**
 * 查一個版本；查不到回 `null`。
 *
 * 回 `null` 而不是拋例外：`/get` 是**查詢類**端點，查無此筆是一個正常且有效的答案（§3.1.3），
 * 由上層回 HTTP 200 ＋ `code='200'` ＋ `data: null`。錯誤字典裡刻意沒有 `version-not-found`
 * （計畫 §4.4），多開一個 not-found 碼會讓這支端點的「查無資料」跟全站其他查詢端點長得不一樣。
 */
export const findDatasetVersion = async (
  runner: QueryRunner,
  versionId: number,
): Promise<DatasetVersionDetail | null> => {
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
    .where(eq(regulatoryDatasetVersions.id, versionId))
    .limit(1)

  const [row] = rows
  return row === undefined ? null : toDatasetVersionDetail(row)
}
