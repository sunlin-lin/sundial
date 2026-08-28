/**
 * 資料存取：某個資料集在某一個基準日適用的那一版（計畫 §3.2 (d)）。
 *
 * **這支查詢的形狀是計畫寫死的，一個字都不能改：**
 *
 * ```sql
 * WHERE dataset_code = ?
 *   AND effective_from <= :asOfDate
 *   AND (effective_to IS NULL OR effective_to >= :asOfDate)
 * ORDER BY effective_from DESC, id DESC
 * LIMIT 1
 * ```
 *
 * `id DESC` 這個次要排序鍵**是必要的，不是保險**（語意：同日生效時後寫入的版本優先）。
 * `UNIQUE(dataset_code, version_code)` 只保證版本代碼不重複，完全不保證 `effective_from`
 * 不重複——版本補錄、或 checksum 誤判導致同一份資料重新寫成新版本，都會產生兩筆同日生效的紀錄。
 * 少了它，挑到哪一筆由實體儲存順序與執行計畫決定：這次跑出版本 A，重建索引或升級 MariaDB 之後
 * 跑出版本 B。**兩版的費率都是正常數字，沒有錯誤訊息，而且不可重現。**
 *
 * ## 這條規則刻意只有這一份實作，不另外抽一支 `domain/` 的純函式
 *
 * 「挑版本的規則抽成純函式比較好測」是打開這個檔案的人幾乎一定會有的念頭，所以理由寫在這裡。
 *
 * 抽出來之後會有兩份寫法，而**只有 SQL 這一份在正式路徑上**（純函式沒有任何呼叫端）。
 * 於是：有人把下面的 `orderBy` 改掉、或把 `effective_to IS NULL` 那一段寫錯，
 * **純函式的測試仍然全綠**——它測的是那支函式，不是這段 SQL。那份純函式因此守不住任何東西，
 * 它只是一份等著和真正的實作漂移的副本，而漂移的那天不會有任何地方變紅。
 * 這與 §0.4 禁止實作切片互相 import（避免長出沒有名字的隱性介面）、
 * §1.8.2 讓訊息 key 與錯誤碼刻意是同一個字串（就沒有「只加一邊」這個選項）是同一條理由。
 *
 * SQL 也不是為了效能才選的第二好方案：這支查詢吃 `ix_regulatory_dataset_versions_effective`
 * 索引、只回一列，而 Payroll **每算一個人的每一種保險**都會打一次它；
 * 把全部版本撈進記憶體再挑，是一個隨版本數成長而變慢、且沒有任何理由的作法。
 *
 * **守這條規則的是整合測試：`__tests__/regulatory-datasets.endpoints.test.ts`**，
 * 它打真正的 HTTP 進真正的資料庫，至少涵蓋兩種情境——
 * 「兩筆 `effective_from` 相同時結果穩定」（計畫 §3.2 (d) 明文要求的那一條）
 * 與「跨版邊界日：`effective_from` 當天換版、前一天仍是舊版」。改動下面這段查詢請先跑它。
 */
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryDatasetVersions } from '../../../../db/schema/index.ts'
import { toDatasetVersionDetail, type DatasetVersionDetail } from '../domain/regulatory-dataset-model.ts'
import type { RegulatoryDatasetCode } from '../domain/regulatory-dataset-code.ts'

/**
 * 取適用版本；該基準日沒有任何一版涵蓋時回 `null`。
 *
 * @param asOfDate 法規適用基準日 `YYYY-MM-DD`。**這一層不會、也不能替它填預設值**（計畫 §4.2）：
 *   它是必填參數，連 clock 都拿不到（見 `domain/regulatory-dataset-model.ts` 的 context）。
 *
 * 日期比較直接把字串交給 MariaDB 的 DATE 欄位，不在程式端解析：`effective_from`／`effective_to`
 * 都是 `date` 欄位、`mode: 'string'`（§6），轉成 `Date` 再比較會憑空引進時區，
 * 而錯的形式是「日期差一天」——對法規版本而言就是「跨年那一天用錯版本」。
 */
export const findEffectiveDatasetVersion = async (
  runner: QueryRunner,
  datasetCode: RegulatoryDatasetCode,
  asOfDate: string,
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
    .where(
      and(
        eq(regulatoryDatasetVersions.datasetCode, datasetCode),
        // 生效日當天就適用（含當日）。
        lte(regulatoryDatasetVersions.effectiveFrom, asOfDate),
        // `effective_to` 是 NULL 的列是常態，不是缺漏（計畫 §3.2 (d)）：這一欄只在政府明示
        // 失效日時才寫入，不拿來記「下一版開始日的前一天」。失效日當天仍適用（含當日）。
        or(isNull(regulatoryDatasetVersions.effectiveTo), gte(regulatoryDatasetVersions.effectiveTo, asOfDate)),
      ),
    )
    .orderBy(desc(regulatoryDatasetVersions.effectiveFrom), desc(regulatoryDatasetVersions.id))
    .limit(1)

  const [row] = rows
  return row === undefined ? null : toDatasetVersionDetail(row)
}
