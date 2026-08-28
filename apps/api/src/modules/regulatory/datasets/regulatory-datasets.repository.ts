/**
 * 法規資料集的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體對資料庫做了哪些事、
 * 各自收什麼、回什麼，一頁看完；實作在 `impl/` 底下，一個動作一個檔。
 *
 * 這裡的「動作」是**資料存取動作，不是端點動作**（§0.4）：
 * {@link findEffectiveDatasetVersion} 與 {@link listDatasetVersionRecords} 都只被 `resolve` 用到，
 * 但它們是兩個獨立的資料存取動作（一個查版本、一個查內容），因此各自成一支——
 * 合成一支「查適用版本與它的內容」看起來省事，卻讓「只想知道哪一版」的呼叫端也得把上百列
 * records 一起撈出來。
 *
 * 本檔（含 `impl/`）是本模組唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）——要資料一律走 service。
 *
 * ## 這三張表走的是裸 db client 那條路，不經過 `TenantDatabase`
 *
 * 法規是全國法定值、全平台共用一份，三張表刻意不在 `CompanyScopedTable` 聯集裡（計畫 §3.2 (b)）。
 * §4.2「每一次查詢都必須帶 `company_id`」在本表上**沒有適用對象**——寫進來反而編譯失敗，
 * 因為 `TenantDatabase` 只接受 `CompanyScopedTable`。這與 `permissions` 模組是同一種情況。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { RegulatoryDatasetCode } from './domain/regulatory-dataset-code.ts'
import type {
  DatasetVersionDetail,
  DatasetVersionListQuery,
  DatasetVersionPage,
  RegulatoryRecordView,
} from './domain/regulatory-dataset-model.ts'
import { findDatasetVersion as findDatasetVersionImpl } from './impl/regulatory-datasets.find-version.repository.ts'
import { findEffectiveDatasetVersion as findEffectiveDatasetVersionImpl } from './impl/regulatory-datasets.find-effective-version.repository.ts'
import { listEffectiveVersionsAsOf as listEffectiveVersionsAsOfImpl } from './impl/regulatory-datasets.list-effective-versions.repository.ts'
import { listDatasetVersionPage as listDatasetVersionPageImpl } from './impl/regulatory-datasets.list-versions.repository.ts'
import { listDatasetVersionRecords as listDatasetVersionRecordsImpl } from './impl/regulatory-datasets.list-records.repository.ts'

/**
 * 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別。
 *
 * 刻意不另外宣告一份更窄的 `Pick<Database, 'select'>`：窄化擋的是「呼叫得到某個方法」，
 * 而本模組全部是唯讀查詢，少一個 `insert` 方法並不會讓它變得更難寫壞
 * （理由與 `employees-main.repository.ts` 相同）。
 */
export type { QueryRunner }

export const listDatasetVersionPage = (
  runner: QueryRunner,
  query: DatasetVersionListQuery,
): Promise<DatasetVersionPage> => listDatasetVersionPageImpl(runner, query)

export const findDatasetVersion = (runner: QueryRunner, versionId: number): Promise<DatasetVersionDetail | null> =>
  findDatasetVersionImpl(runner, versionId)

export const findEffectiveDatasetVersion = (
  runner: QueryRunner,
  datasetCode: RegulatoryDatasetCode,
  asOfDate: string,
): Promise<DatasetVersionDetail | null> => findEffectiveDatasetVersionImpl(runner, datasetCode, asOfDate)

/**
 * 全部資料集在某一基準日各自適用的版本（`overview` 動作用，任務一）。
 * 批次版本，見實作檔檔頭——不是對 {@link findEffectiveDatasetVersion} 的迴圈呼叫。
 */
export const listEffectiveVersionsAsOf = (
  runner: QueryRunner,
  datasetCodes: readonly number[],
  asOfDate: string,
): Promise<readonly DatasetVersionDetail[]> => listEffectiveVersionsAsOfImpl(runner, datasetCodes, asOfDate)

/**
 * 泛型原樣轉發（`TCode` 的意義見 `impl/regulatory-datasets.list-records.repository.ts`）：
 * 入口檔在這裡若把它收成 `RegulatoryDatasetCode`，實作那一層的收斂就在轉發的這一行被丟掉了。
 */
export const listDatasetVersionRecords = <TCode extends RegulatoryDatasetCode>(
  runner: QueryRunner,
  datasetCode: TCode,
  datasetVersionId: number,
): Promise<readonly RegulatoryRecordView<TCode>[]> =>
  listDatasetVersionRecordsImpl(runner, datasetCode, datasetVersionId)
