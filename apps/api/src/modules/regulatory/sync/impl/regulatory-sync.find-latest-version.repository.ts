/**
 * 資料存取：某個資料集**目前最新的**那一版（只取 checksum 比對需要的幾欄）。
 *
 * ## 為什麼不是 `SELECT *`
 *
 * 本表禁止 `SELECT *`（計畫 §3.2 (c)）：`raw_data` 是 LONGTEXT，而 MariaDB 把它存在頁外、
 * 不選就不讀。這裡只要三欄，卻是每次同步都會跑一次的查詢——選了 `raw_data` 的話，
 * 每天都會把上一版的完整 Snapshot 從磁碟拉一次出來丟掉，而症狀只是「同步有點慢」。
 *
 * ## 「最新」的定義與 `resolve` 同一套
 *
 * `ORDER BY effective_from DESC, id DESC`，與 `datasets` 那一側挑適用版本的排序規則逐字相同
 * （計畫 §3.2 (d)：同日生效時，後寫入的版本優先）。用同一套定義，是為了讓
 * 「同步認為現行的那一版」與「Payroll 實際會拿到的那一版」不可能是不同的兩列。
 *
 * ⚠️ 已知的取捨：日後若補錄歷史版本（計畫 §7.0 提到 `2`、`5`、`9` 可以一次回補十幾年），
 * 這支查詢仍然回**生效日最新**的那一版，因此拿一份舊年度的資料來比 checksum 一定不相同、
 * 一定會走到寫入。那是對的行為——補錄本來就要寫入新版本；`UNIQUE(dataset_code, version_code)`
 * 會擋掉真正重複的那一種（見 run 切片對撞鍵的處置）。
 */
import { desc, eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions } from '../../../../db/schema/index.ts'

export type LatestDatasetVersion = {
  readonly id: number
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly checksum: string
}

export const findLatestDatasetVersion = async (
  runner: QueryRunner,
  datasetCode: number,
): Promise<LatestDatasetVersion | null> => {
  const rows = await runner
    .select({
      id: regulatoryDatasetVersions.id,
      versionCode: regulatoryDatasetVersions.versionCode,
      effectiveFrom: regulatoryDatasetVersions.effectiveFrom,
      checksum: regulatoryDatasetVersions.checksum,
    })
    .from(regulatoryDatasetVersions)
    .where(eq(regulatoryDatasetVersions.datasetCode, datasetCode))
    .orderBy(desc(regulatoryDatasetVersions.effectiveFrom), desc(regulatoryDatasetVersions.id))
    .limit(1)

  return rows[0] ?? null
}
