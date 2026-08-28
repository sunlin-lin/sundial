/**
 * 資料存取：某一個資料集的版本清單一頁 ＋ 總筆數。
 *
 * **本表禁止 `SELECT *`**（計畫 §3.2 (c)）：`raw_data` 是 LONGTEXT。MariaDB 把它存在頁外、
 * 不選就不讀，所以逐欄列出沒有任何代價；但只要有人寫了一次 `SELECT *`，列版本清單就會順手
 * 拖出每一版的完整 Snapshot，而症狀是「列表偶爾很慢」，不是錯誤——沒有任何測試會因此變紅。
 * 下面的欄位清單刻意一欄一欄寫出來，`rawData` 一個字都沒出現。
 *
 * **沒有 `company_id` 條件，這不是漏掉**（§4.2）：本表是平台全域資料，沒有那一欄
 * （見 `db/schema/regulatory-dataset-versions.ts` 檔頭與 `db/schema/index.ts` 的 `CompanyScopedTable`）。
 * 寫進來反而編譯不過——`TenantDatabase` 只接受 `CompanyScopedTable`。
 */
import { asc, count, desc, eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions } from '../../../../db/schema/index.ts'
import {
  toDatasetVersionSummary,
  type DatasetVersionListQuery,
  type DatasetVersionPage,
  type DatasetVersionSortField,
} from '../domain/regulatory-dataset-model.ts'

/**
 * 排序欄位 → 資料表欄位。
 *
 * 參數型別已經是白名單聯集（`DatasetVersionSortField`），因此這裡是一個**窮盡**的對照，
 * 沒有 `default` 分支：日後往白名單加一個欄位卻忘了在這裡對應，**當場編譯不過**
 * ——而寫一個 `default` 就會讓那種情況靜靜地退化成「依生效日排序」，前端看到的順序與它要的不同，
 * 卻沒有任何錯誤。
 */
const sortColumn = (field: DatasetVersionSortField) => {
  switch (field) {
    case 'versionCode':
      return regulatoryDatasetVersions.versionCode
    case 'syncedAt':
      return regulatoryDatasetVersions.syncedAt
    case 'createdAt':
      return regulatoryDatasetVersions.createdAt
    case 'effectiveFrom':
      return regulatoryDatasetVersions.effectiveFrom
  }
}

/**
 * 取一頁版本。
 *
 * 分頁與總筆數分成兩次查詢，不用視窗函式一次取回：兩者的 `WHERE` 完全相同，
 * 而總筆數不受 `LIMIT` 影響——寫成同一句反而要多一層子查詢，`EXPLAIN` 也跟著變得看不懂（§4.5）。
 * 兩次查詢都吃 `ix_regulatory_dataset_versions_effective`（以 `dataset_code` 開頭）。
 *
 * **第二排序鍵固定是 `id DESC`**，理由有兩層：
 * - 分頁穩定性：只依 `effective_from` 排序時，同日生效的列在不同頁的順序不保證，
 *   於是同一版會同時出現在第 1 頁與第 2 頁，而另一版一頁都沒出現。
 * - 與 `resolve` 同一條規則（計畫 §3.2 (d)：「同日生效時，後寫入的版本優先」）。
 *   兩邊用同一個 tie-break，清單上排在前面的那一版就是 `resolve` 會挑中的那一版
 *   ——反過來的話，畫面上看到的順序會與系統實際採用的版本相反，而那是最難察覺的一種不一致。
 *
 * `currentPage` 超出範圍時自然回空陣列與正確的 `pagination`，不另外判斷、也不回 404（§1.4）。
 */
export const listDatasetVersionPage = async (
  runner: QueryRunner,
  query: DatasetVersionListQuery,
): Promise<DatasetVersionPage> => {
  const condition = eq(regulatoryDatasetVersions.datasetCode, query.datasetCode)
  const direction = query.sort.order === 'desc' ? desc : asc

  const rows = await runner
    .select({
      id: regulatoryDatasetVersions.id,
      datasetCode: regulatoryDatasetVersions.datasetCode,
      versionCode: regulatoryDatasetVersions.versionCode,
      effectiveFrom: regulatoryDatasetVersions.effectiveFrom,
      effectiveTo: regulatoryDatasetVersions.effectiveTo,
      recordCount: regulatoryDatasetVersions.recordCount,
      syncedAt: regulatoryDatasetVersions.syncedAt,
      createdAt: regulatoryDatasetVersions.createdAt,
    })
    .from(regulatoryDatasetVersions)
    .where(condition)
    .orderBy(direction(sortColumn(query.sort.field)), desc(regulatoryDatasetVersions.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await runner.select({ total: count() }).from(regulatoryDatasetVersions).where(condition)
  const [totalRow] = totals

  return { items: rows.map(toDatasetVersionSummary), totalCount: totalRow?.total ?? 0 }
}
