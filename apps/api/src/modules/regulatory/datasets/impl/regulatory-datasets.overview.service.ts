/**
 * 業務動作：`POST /regulatory/datasets/overview`（實作計畫 03 §3、任務一）。
 *
 * **九個資料集各一列，即使某一列在這個基準日沒有適用版本、或這個資料集是人工維護、
 * 或它從來沒有被同步過**——九列必須都在，少一列前端會以為那個資料集不存在（任務一）。
 *
 * **兩次資料庫往返，不是九次**：版本那一半用 {@link listEffectiveVersionsAsOf} 一次查完
 * 全部資料集（§4.5），同步狀態那一半用 `sync` 次目錄的 `listLatestSyncStatuses` 一次查完
 * 全部資料集。兩者互不依賴，用 `Promise.all` 平行送出。
 *
 * **跨次目錄呼叫 `sync` 的 service，不碰它的 repository**（§0.3）：`regulatory_sync_logs`
 * 是 `sync` 次目錄的讀寫範圍（見 `sync/regulatory-sync.repository.ts` 檔頭），`datasets`
 * 要它的資料一律經由 `sync` 的入口，這樣 `sync` 之後改了「最近一次」的定義（例如要不要把
 * 心跳逾時判死也算進去），`datasets` 這一側不必跟著改。
 */
import { REGULATORY_DATASET_CODES, REGULATORY_DATASETS } from '../domain/regulatory-dataset-code.ts'
import type {
  DatasetOverviewInput,
  DatasetOverviewLastSync,
  DatasetOverviewRow,
  RegulatoryDatasetsContext,
} from '../domain/regulatory-dataset-model.ts'
import { listEffectiveVersionsAsOf } from '../regulatory-datasets.repository.ts'
import { listLatestSyncStatuses } from '../../sync/regulatory-sync.service.ts'
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'

export const getDatasetOverview = async (
  context: RegulatoryDatasetsContext,
  input: DatasetOverviewInput,
): Promise<ServiceResult<readonly DatasetOverviewRow[]>> => {
  const [versions, syncStatuses] = await Promise.all([
    listEffectiveVersionsAsOf(context.db, REGULATORY_DATASET_CODES, input.asOfDate),
    listLatestSyncStatuses({ db: context.db }, REGULATORY_DATASET_CODES),
  ])

  const versionByCode = new Map(versions.map((version) => [version.datasetCode, version]))
  const syncByCode = new Map(syncStatuses.map((status) => [status.datasetCode, status]))

  // 依 `REGULATORY_DATASETS` 的固定清單組裝，不是依查詢結果——查詢結果可能九個都不到（全新環境
  // 還沒同步過一次），而輸出仍然必須是九列（任務一）。這個迴圈本身不是資料庫呼叫，
  // 只是把已經一次查完的兩份結果依代碼配對，不受 §4.5「禁止迴圈內查詢」規範。
  const rows: DatasetOverviewRow[] = REGULATORY_DATASET_CODES.map((datasetCode) => {
    const dataset = REGULATORY_DATASETS[datasetCode]
    const version = versionByCode.get(datasetCode)
    const sync = syncByCode.get(datasetCode)

    const lastSync: DatasetOverviewLastSync =
      dataset.maintenance === 'manual'
        ? // 人工維護的資料集永遠沒有同步紀錄，那是規格不是故障（任務一）——判斷來源是
          // `maintenance`，不是「剛好查無紀錄」，因此就算 `sync` 是 `undefined` 也不必再檢查它。
          { kind: 'not-applicable' }
        : sync === undefined
          ? { kind: 'never-synced' }
          : { kind: 'synced', startedAt: sync.startedAt, finishedAt: sync.finishedAt, statusCode: sync.statusCode }

    return {
      datasetCode,
      name: dataset.name,
      maintenance: dataset.maintenance,
      effectiveVersion:
        version === undefined
          ? null
          : {
              versionCode: version.versionCode,
              effectiveFrom: version.effectiveFrom,
              recordCount: version.recordCount,
            },
      lastSync,
    }
  })

  // 查詢類，沒有業務規則可以不成立：九列一定組得出來，因此恆為成功（§3.1.3）。
  return succeed(rows)
}
