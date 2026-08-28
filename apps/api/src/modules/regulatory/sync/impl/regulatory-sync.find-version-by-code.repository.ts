/**
 * 資料存取：某個資料集底下某個 `version_code` 的版本（`UNIQUE(dataset_code, version_code)` 那一組）。
 *
 * ## 它不是用來「檢查唯一性」的（§4.3 明文禁止先 SELECT 再 INSERT）
 *
 * 唯一性由資料庫的唯一鍵保證，這支查詢不承擔那個職責——併發下它本來就擋不住。
 * 它的用途是**產生一句看得懂的失敗原因**：撞鍵的情境有明確的業務意義
 * （「政府改了內容，但生效日還在同一個月」），而 MariaDB 拋出來的
 * `Duplicate entry '1-2026-01' for key 'uq_...'` 對看同步歷程的人沒有任何幫助。
 *
 * 因此 run 切片的處置是：先查、查到就以 `status=3` 失敗並在 `error_message` 裡寫清楚兩邊的
 * checksum；**同時**唯一鍵仍然在那裡擋真正的併發。兩者不重複，是一個負責訊息、一個負責正確性。
 */
import { and, eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions } from '../../../../db/schema/index.ts'

export type DatasetVersionIdentity = {
  readonly id: number
  readonly effectiveFrom: string
  readonly checksum: string
}

export const findDatasetVersionByCode = async (
  runner: QueryRunner,
  datasetCode: number,
  versionCode: string,
): Promise<DatasetVersionIdentity | null> => {
  const rows = await runner
    .select({
      id: regulatoryDatasetVersions.id,
      effectiveFrom: regulatoryDatasetVersions.effectiveFrom,
      checksum: regulatoryDatasetVersions.checksum,
    })
    .from(regulatoryDatasetVersions)
    .where(
      and(
        eq(regulatoryDatasetVersions.datasetCode, datasetCode),
        eq(regulatoryDatasetVersions.versionCode, versionCode),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}
