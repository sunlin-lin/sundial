/**
 * 資料存取：某個資料集**已經有哪些版本代碼**（只有 `version_code` 一欄）。
 *
 * ## 這是多版本同步的幂等判定材料（`dataset_code=2`、`5`）
 *
 * 一次同步要對十幾個資源各回答一次「這一版我們有了沒有」。用 `findDatasetVersionByCode` 逐一去問
 * 是十幾次往返，而答案的集合在同一次同步裡不會變（這個資料集的寫入被心跳那把鎖擋住了，
 * 見 `regulatory-sync.run.service.ts`）——一次撈完是同一個答案、一次往返。
 *
 * ## 為什麼不是 `SELECT *`，也不是連 `checksum` 一起撈
 *
 * 本表禁止 `SELECT *`（計畫 §3.2 (c)）：`raw_data` 是 LONGTEXT，一次撈十幾列等於把十幾份完整
 * Snapshot 從磁碟拉出來丟掉。而 `checksum` 也刻意不撈——多版本流程對「已存在的版本」的處置是
 * **不下載、直接跳過**，手上根本不會有可以比對的內容（理由見 run 切片對 checksum 語意的說明）。
 * 撈一欄用不到的資料，下一個人會以為它有用。
 */
import { eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions } from '../../../../db/schema/index.ts'

export const listDatasetVersionCodes = async (
  runner: QueryRunner,
  datasetCode: number,
): Promise<readonly string[]> => {
  const rows = await runner
    .select({ versionCode: regulatoryDatasetVersions.versionCode })
    .from(regulatoryDatasetVersions)
    .where(eq(regulatoryDatasetVersions.datasetCode, datasetCode))

  return rows.map((row) => row.versionCode)
}
