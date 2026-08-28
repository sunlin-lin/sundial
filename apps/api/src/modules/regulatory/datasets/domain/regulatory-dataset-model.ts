/**
 * 法規資料集查詢層的跨層型別、執行相依與列表條件收斂（零 IO，§0.1、§1.4）。
 *
 * ## 為什麼這些東西放在 `domain/`
 *
 * §0.2 的檔名白名單只允許 `routes`／`handler`／`service`／`repository`／`errors`／`impl/`／
 * `domain/`／`__tests__/`，**沒有一個「模組共用型別」的位置**。放進 service 入口檔會讓
 * `impl/` 的切片回頭 import 入口檔（循環相依），放進 repository 入口檔則要把非資料存取的東西
 * 塞進一個資料存取的型別裡。`domain/` 是唯一剩下的位置，而本檔只有型別與純函式，
 * 編譯後幾乎完全消失，仍然符合「零 IO」。（與 `employees/main/domain/employee-context.ts`
 * 及 `roles/main/domain/role-context.ts` 的處置相同。）
 *
 * ## 這三張表沒有 `company_id`，因此本模組不存在「公司範圍」
 *
 * 法規是全國法定值，全平台共用一份（計畫 §3.1.1、§3.2 (b)）：三張表刻意不在
 * `CompanyScopedTable` 聯集裡，走的是裸 db client 那條路（§4.2），與 `users`、`permissions` 同一類。
 * 因此下面的 context 裡**沒有 `companyId`**——不是漏了，是這個模組根本沒有那個維度。
 */
import type { Database } from '../../../../db/client.ts'
import type { RegulatoryRawFormatValue, RegulatorySyncStatusValue } from '../../../../db/schema/index.ts'
import {
  REGULATORY_DATASETS,
  type RegulatoryDatasetCode,
  type RegulatoryDatasetMaintenance,
} from './regulatory-dataset-code.ts'
import type { RegulatoryRecordData } from './regulatory-record-shape.ts'

/**
 * service 的執行相依。
 *
 * **刻意沒有 `clock`**（§6.2 的反面）：本模組所有查詢的時間維度都是呼叫端傳進來的
 * `asOfDate`，一個「現在」都用不到。而把 clock 放進來的代價是實的——它會讓
 * 「`asOfDate` 沒帶就用今天」變成一個寫得出來、而且看起來很體貼的兩行程式碼，
 * 那正是計畫 §4.2 明文要防的事：補算去年 12 月的薪資會抓到今年的費率，
 * 算出一個**完全合理**的數字，沒有任何一層會發現不對。拿不到 clock，就寫不出那個預設值。
 */
export type RegulatoryDatasetsContext = {
  /** 資料庫連線。本模組全部是唯讀查詢，沒有交易邊界要劃（§4.4）。 */
  readonly db: Database
}

/**
 * 這個數字是不是一個合法的 `dataset_code`。
 *
 * **為什麼不放在 `regulatory-dataset-code.ts`**：那個檔案是 `check:dataset-code` 掃描器的對象
 * （計畫 §3.1.2），掃描器讀的是它的 AST 結構；在裡面多加函式雖然不影響目前的實作，
 * 但那份清單的唯一職責就是「代碼 ↔ 名稱」，混進行為會讓「這個檔案還能不能被機械比對」
 * 變成每次改動都要重新確認的事。
 *
 * 用途只有一個：`regulatory_dataset_versions.dataset_code` 在資料庫層是 `int`
 * （schema 刻意不掛 `$type`，否則相依方向會倒過來），讀出來是一個普通數字。
 * 對不上清單代表資料庫裡有一列指向不存在的資料集——那是系統錯誤，不是使用者做錯了什麼。
 */
export const isRegulatoryDatasetCode = (value: number): value is RegulatoryDatasetCode =>
  Object.hasOwn(REGULATORY_DATASETS, value)

/**
 * 版本清單允許排序的欄位白名單（API 對外欄位名，camelCase）。
 *
 * 白名單是必要的，不是保守：把 `sort.field` 的字串直接接進 SQL 等於同時開放 SQL injection
 * 與全表掃描（§1.4）。這份常數同時餵給路由的 schema（擋在驗證層）與 repository 的欄位對照
 * （擋在查詢層），兩邊用同一份來源才不會出現「schema 允許但查詢不認得」的欄位。
 *
 * **`rawData` 不在也不可能在這裡**：它是 LONGTEXT，依它排序等於把每一版的完整 Snapshot
 * 拖進排序緩衝區（計畫 §3.2 (c)）。
 */
export const DATASET_VERSION_SORT_FIELDS = ['effectiveFrom', 'versionCode', 'syncedAt', 'createdAt'] as const

export type DatasetVersionSortField = (typeof DATASET_VERSION_SORT_FIELDS)[number]

export type DatasetVersionSortOption = {
  readonly field: DatasetVersionSortField
  readonly order: 'asc' | 'desc'
}

/**
 * 未指定排序時的預設：生效日由新到舊。
 *
 * 選 `effectiveFrom desc` 而不是 `createdAt`：使用者打開版本清單要問的問題是「現在適用哪一版」，
 * 而那一版就在生效日最新的那一端。依建立時間排序會讓一次歷史回補（計畫 §7.0 提到
 * `2`、`5`、`9` 可以一次補十幾年）把最舊的資料排到最前面。
 */
export const DEFAULT_DATASET_VERSION_SORT: DatasetVersionSortOption = { field: 'effectiveFrom', order: 'desc' }

/**
 * 補上預設排序。
 *
 * 回傳值同時用於查詢與**回聲**（§1.4）：回聲的必須是「實際生效的排序」而不是「使用者送來的」，
 * 否則前端拿回一個空的 `sort`，無從比對這包回應是不是自己現在畫面上這組條件的結果。
 */
export const resolveDatasetVersionSort = (sort: DatasetVersionSortOption | undefined): DatasetVersionSortOption =>
  sort ?? DEFAULT_DATASET_VERSION_SORT

export type DatasetVersionListQuery = {
  readonly datasetCode: RegulatoryDatasetCode
  readonly perPage: number
  readonly currentPage: number
  readonly sort: DatasetVersionSortOption
}

/**
 * 版本清單的單筆。
 *
 * **沒有 `rawData`，也沒有 `checksum`／`governmentResourceId`**：清單要回答的是
 * 「這個資料集有哪幾版、各自從哪天開始、有幾筆資料」。
 * `rawData` 更是本表禁止 `SELECT *` 的理由本身（計畫 §3.2 (c)）。
 */
export type DatasetVersionSummary = {
  readonly id: number
  readonly datasetCode: RegulatoryDatasetCode
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  /** 解析後筆數；`null` = 同步失敗或尚未解析。 */
  readonly recordCount: number | null
  readonly syncedAt: string
  readonly createdAt: string
}

/**
 * 單一版本的完整 metadata。**依然不含 `rawData`**（計畫 §4.2：`/get` 不含 `raw_data`；
 * 看原始 Snapshot 的 `/regulatory/datasets/raw` 刻意不開，理由見計畫 D3）。
 */
export type DatasetVersionDetail = DatasetVersionSummary & {
  /** 本次取得的政府資源識別碼。**不是永久固定 URL**，只供事後追查（計畫 §7.0）。 */
  readonly governmentResourceId: string | null
  /** 政府來源標示的修改時間（台北牆鐘，已在解析階段換算，計畫 §3.2）。 */
  readonly sourceModifiedAt: string | null
  readonly checksum: string
  /**
   * `rawData` 那串位元組原本是什麼格式。
   *
   * 型別直接引用 `db/schema` 的聯集而不是在這裡重寫一份：重寫的那一份哪天少一個值，
   * 兩邊不一致不會有任何地方變紅（型別是 `number` 對 `number`）。
   */
  readonly rawFormatCode: RegulatoryRawFormatValue
}

export type DatasetVersionPage = {
  readonly items: readonly DatasetVersionSummary[]
  readonly totalCount: number
}

/**
 * 資料庫讀出來的版本列：與 {@link DatasetVersionSummary} 只差在 `datasetCode` 還是普通 `number`。
 *
 * `regulatory_dataset_versions.dataset_code` 在 schema 上**刻意沒有 `$type`**
 * （合法值的唯一來源在 `modules/` 底下，而 `db/schema` 是它的下層），因此驅動回來的就是一個整數。
 */
export type DatasetVersionRow = Omit<DatasetVersionSummary, 'datasetCode'> & { readonly datasetCode: number }

export type DatasetVersionDetailRow = Omit<DatasetVersionDetail, 'datasetCode'> & { readonly datasetCode: number }

/**
 * 收斂 `dataset_code`。
 *
 * 抽成 `domain/` 的純函式而不是在各個 repository 切片裡各寫一次：§0.4 禁止實作切片互相 import，
 * 而三支查詢（清單、單筆、適用版本）都要做同一件事——複製三份的話，日後多一個資料集代碼時
 * 改一處漏兩處，而且不會有任何地方變紅。
 *
 * **對不上清單時拋例外**：這是系統錯誤而不是業務拒絕（§3.1.2）。資料庫裡出現一列指向
 * 不存在的資料集，代表有人手動寫入或某支 migration 寫錯，使用者沒有做錯任何事；
 * 回一筆業務錯誤會讓它看起來像一次普通的操作失敗，而它其實是資料損壞。
 */
const toRegulatoryDatasetCode = (datasetCode: number, versionId: number): RegulatoryDatasetCode => {
  if (!isRegulatoryDatasetCode(datasetCode)) {
    throw new Error(
      `regulatory_dataset_versions.id=${versionId} 的 dataset_code=${datasetCode} 不在資料集清單內（計畫 §3.1）`,
    )
  }
  return datasetCode
}

export const toDatasetVersionSummary = (row: DatasetVersionRow): DatasetVersionSummary => ({
  id: row.id,
  datasetCode: toRegulatoryDatasetCode(row.datasetCode, row.id),
  versionCode: row.versionCode,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo,
  recordCount: row.recordCount,
  syncedAt: row.syncedAt,
  createdAt: row.createdAt,
})

export const toDatasetVersionDetail = (row: DatasetVersionDetailRow): DatasetVersionDetail => ({
  ...toDatasetVersionSummary(row),
  governmentResourceId: row.governmentResourceId,
  sourceModifiedAt: row.sourceModifiedAt,
  checksum: row.checksum,
  rawFormatCode: row.rawFormatCode,
})

/** `/get` 的輸入。`id` 是 `regulatory_dataset_versions.id`（BIGINT，計畫 §3.2 (a)）。 */
export type DatasetVersionTargetInput = {
  readonly id: number
}

/**
 * `resolve` 的輸入。
 *
 * **`TCode` 就是這一串泛型的起點**：呼叫端寫 `{ datasetCode: 1, ... }` 時 `TCode` 被推導成 `1`，
 * 於是 {@link EffectiveRegulatoryDataset} 與 {@link RegulatoryRecordView} 的 `data`
 * 一路收斂到那一個資料集的形狀。呼叫端傳的是一個 `RegulatoryDatasetCode` 型別的變數
 * （HTTP handler 就是這樣，代碼要到執行期才知道）時，`TCode` 推導成整個聯集
 * ——那也是對的，理由見 `regulatory-datasets.service.ts` 檔頭那段「兩側為什麼不對稱」。
 */
export type ResolveEffectiveDatasetInput<TCode extends RegulatoryDatasetCode = RegulatoryDatasetCode> = {
  readonly datasetCode: TCode
  /**
   * 法規適用基準日 `YYYY-MM-DD`。**必填，不預設今天**（計畫 §4.2）。
   *
   * `docs/schema/05` 明講「版本依各法規適用基準日選擇，不依系統當天日期」。
   */
  readonly asOfDate: string
}

/**
 * 解析後的一筆 record。
 *
 * **四個數值欄位都是 decimal 字串，禁止 `Number(...)` 後再計算**（§4.7、計畫 §6.1）：
 * 級距比對是「這個投保薪資落在 `rangeFrom` 與 `rangeTo` 之間嗎」，邊界值正好等於級距上限時，
 * 浮點誤差會讓它掉到下一級——保費差幾百塊，而薪資單上完全看不出異常。
 *
 * `TCode` 只影響 {@link data} 一個欄位；其餘欄位是 `regulatory_records` 的固定欄位，
 * 每個資料集都一樣。預設參數是整個聯集，因此不指定時的意思是「任一資料集的一筆」。
 */
export type RegulatoryRecordView<TCode extends RegulatoryDatasetCode = RegulatoryDatasetCode> = {
  readonly id: number
  /** 同一版本內穩定且唯一的資料鍵（例如級數、行業別代碼）。 */
  readonly recordKey: string
  readonly code: string | null
  readonly name: string | null
  readonly rangeFrom: string | null
  readonly rangeTo: string | null
  readonly amount: string | null
  readonly rate: string | null
  /**
   * 已依 `dataset_code` 驗證過形狀的完整內容（計畫 §6）。
   *
   * `TCode` 是單一代碼時，這裡就是**那一個資料集**的形狀，呼叫端不必再收窄；
   * 而形狀尚未定義的那幾個代碼（`Type.Never()`）在這裡自然就是 `never`
   * ——「這個資料集取不到任何值」不需要特例，它就是空型別本身的意思。
   */
  readonly data: RegulatoryRecordData<TCode>
  readonly sortOrder: number | null
}

/**
 * `resolve` 的產物：基準日 ＋ 適用版本 ＋ 該版本的全部 records。
 *
 * `datasetCode` 也跟著收斂成 `TCode`（而不是留成整個聯集）：呼叫端拿它去分派時，
 * 「我要的是 `1`、拿回來的卻宣告成任一代碼」會逼出一次多餘的比對，而那次比對永遠成立。
 */
export type EffectiveRegulatoryDataset<TCode extends RegulatoryDatasetCode = RegulatoryDatasetCode> = {
  readonly datasetCode: TCode
  readonly asOfDate: string
  readonly version: DatasetVersionDetail
  readonly records: readonly RegulatoryRecordView<TCode>[]
}

/**
 * `overview` 的輸入（實作計畫 03 §3、任務一）。
 *
 * **基準日必填，理由與 {@link ResolveEffectiveDatasetInput.asOfDate} 逐字相同**：
 * 不預設今天——補算去年 12 月的薪資會抓到今年的費率，算出一個完全合理的數字。
 */
export type DatasetOverviewInput = {
  readonly asOfDate: string
}

/**
 * 總覽一列裡「該基準日適用的版本」，只留總覽要顯示的三欄。
 *
 * **不是 {@link DatasetVersionSummary} 的別名**：總覽不回版本 id、失效日、同步完成時間這些欄位
 * ——那些要看，前端本來就有版本清單／內容可以打（計畫 03 §3「不回 records」的同一條理由，
 * 只是這裡連 metadata 也一併收窄）。
 *
 * `null`（見 {@link DatasetOverviewRow.effectiveVersion}）代表**該基準日沒有任何一版涵蓋**
 * ——這是 §3.1.3 查詢類「查無資料」的同一種語意，這個欄位只有這一種 `null` 的意思，
 * 不會與下面 `lastSync` 那個需要判別聯集的情況混在一起。
 */
export type DatasetOverviewVersion = {
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly recordCount: number | null
}

/**
 * 總覽一列裡「最近一次同步」的狀態。
 *
 * **判別聯集，不是一個可以是 `null` 的物件**——這正是任務一要求的表達方式。人工維護的資料集
 * （`dataset_code=10`）**永遠**沒有同步紀錄，那是規格不是故障；而自動同步的資料集在剛上線、
 * 排程還沒跑過第一次之前，同樣沒有紀錄。這兩種「沒有紀錄」若都回 `null`，前端只能看著一個
 * 空值猜「這是『不適用』還是『還沒跑過』」——猜錯的後果是把一個健康的新資料集當成同步壞了
 * 顯示告警，或反過來把一個真的忘了排程的資料集當成「本來就不用同步」而放著不管。
 *
 * 三個 `kind` 把這個判斷收回後端，且**判斷來源與 `null` 無關**：`not-applicable` 只由
 * {@link RegulatoryDatasetMaintenance} 決定（`maintenance === 'manual'`），不是猜的；
 * `synced` 只在真的查到紀錄時出現；介於中間、「自動同步但查無紀錄」的情況只剩
 * `never-synced` 一種可能，三者互斥又完備，前端不必再組合出第四種解讀。
 */
export type DatasetOverviewLastSync =
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'never-synced' }
  | {
      readonly kind: 'synced'
      readonly startedAt: string
      readonly finishedAt: string | null
      readonly statusCode: RegulatorySyncStatusValue
    }

/**
 * 總覽一列。
 *
 * **九個資料集固定各一列**，即使某一列在這個基準日沒有適用版本（`effectiveVersion: null`）
 * ——任務一明文：少一列會讓前端以為那個資料集不存在。`name` 與 `maintenance` 直接來自
 * {@link REGULATORY_DATASETS}，讓「代碼 → 名稱」不必在前端語系檔再維護第三份副本
 * （文件、後端常數之後的第三份——那一份 `check:dataset-code` 掃描器比對不到，見計畫任務一）。
 */
export type DatasetOverviewRow = {
  readonly datasetCode: RegulatoryDatasetCode
  readonly name: string
  readonly maintenance: RegulatoryDatasetMaintenance
  readonly effectiveVersion: DatasetOverviewVersion | null
  readonly lastSync: DatasetOverviewLastSync
}
