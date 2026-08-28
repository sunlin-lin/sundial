/**
 * 資料存取：一個版本底下的全部 records，**並在讀出的當下驗證 `data` 的形狀**（計畫 §6）。
 *
 * ## 為什麼驗證放在這一層
 *
 * 這裡是 json 離開資料庫的那一行。再往上一層驗，`data` 就得先以 `unknown` 穿過 repository
 * 的回傳型別，而計畫 §6 明文「不能讓 `data` 以 `unknown` 流進 Payroll」。
 * 在這裡收斂，上層拿到的型別從第一手就是對的。
 *
 * ## 驗不過是系統錯誤，因此拋例外（§3.1.2）
 *
 * §3.1.1 禁止以拋例外表達**業務拒絕**，這裡拋的不是業務拒絕：使用者沒有做錯任何事，
 * 是我們幾個月前寫進去的資料與我們自己現在的形狀定義對不上（解析器改過、欄位名改過、
 * 政府格式變過）。那件事要有堆疊、要進告警、要有人去看——包成一句 `300` 給使用者看，
 * 畫面上會像是他做錯了什麼，而真正的成因沒有任何人知道。
 *
 * ## 不分頁，一次取完
 *
 * §1.4 的分頁規則管的是**對外的 list 端點**；這裡是一個版本的完整內容，Payroll 要的就是整張表
 * （投保薪資分級表幾十級、職災行業別費率上百列）。分頁反而會讓呼叫端自己在迴圈裡逐頁查詢，
 * 那正是 §4.5 要防的往返次數。
 */
import { asc } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatoryRecords } from '../../../../db/schema/index.ts'
import type { RegulatoryDatasetCode } from '../domain/regulatory-dataset-code.ts'
import type { RegulatoryRecordView } from '../domain/regulatory-dataset-model.ts'
import { parseRegulatoryRecordData } from '../domain/regulatory-record-shape.ts'

/**
 * 取一個版本的全部 records。
 *
 * @param datasetCode 這個版本所屬的資料集。**驗證形狀需要它**——`data` 的形狀是逐 `dataset_code`
 *   定義的（計畫 §6），少了它就只能退回「隨便哪一種形狀通過就好」，而那等於沒有驗證。
 * @param datasetVersionId 版本主鍵。records 一律綁在**版本**上而不是資料集上，
 *   這是「政府後續更新不得改寫已結算結果」的落點（見 `db/schema/regulatory-records.ts`）。
 *
 * 排序用 `sort_order` ＋ `id`：`sort_order` 是選填的（不是每個資料集都有原始列序），
 * 缺值時單靠它排出來的順序不穩定，而「同一支查詢兩次跑出不同順序」在級距表上看起來像資料錯亂。
 *
 * 四個 decimal 欄位（`range_from`／`range_to`／`amount`／`rate`）讀出來是**字串**
 * （連線池設了 `decimalNumbers: false`），本層原樣往上傳，**不做任何 `Number(...)`**（§4.7）。
 *
 * ## 泛型從這一層開始，不是從 service 開始
 *
 * `data` 的型別在這一行被 {@link parseRegulatoryRecordData} 決定（它本來就是泛型的），
 * 因此收斂的起點就在這裡。若只在 service 那一層加泛型、這裡仍回聯集，service 就得靠一次
 * `as` 把聯集轉成單一形狀——而那個 `as` 沒有經過任何檢查，正是 §2.2 禁止的那一種。
 */
export const listDatasetVersionRecords = async <TCode extends RegulatoryDatasetCode>(
  runner: QueryRunner,
  datasetCode: TCode,
  datasetVersionId: number,
): Promise<readonly RegulatoryRecordView<TCode>[]> => {
  const rows = await runner
    .select({
      id: regulatoryRecords.id,
      recordKey: regulatoryRecords.recordKey,
      code: regulatoryRecords.code,
      name: regulatoryRecords.name,
      rangeFrom: regulatoryRecords.rangeFrom,
      rangeTo: regulatoryRecords.rangeTo,
      amount: regulatoryRecords.amount,
      rate: regulatoryRecords.rate,
      data: regulatoryRecords.data,
      sortOrder: regulatoryRecords.sortOrder,
    })
    .from(regulatoryRecords)
    .where(eq(regulatoryRecords.datasetVersionId, datasetVersionId))
    .orderBy(asc(regulatoryRecords.sortOrder), asc(regulatoryRecords.id))

  return rows.map((row) => {
    const parsed = parseRegulatoryRecordData(datasetCode, row.data)
    if (!parsed.ok) {
      // 系統錯誤路徑（§3.1.2、計畫 §6）：訊息帶足「哪一版、哪一筆」，否則事後只知道
      // 「某個資料集的某一筆壞了」，而一個版本可能有上百列。
      throw new Error(
        `regulatory_records.id=${row.id}（version=${datasetVersionId}、record_key=${row.recordKey}）` +
          `讀出後驗證失敗：${parsed.reason}`,
      )
    }

    return {
      id: row.id,
      recordKey: row.recordKey,
      code: row.code,
      name: row.name,
      rangeFrom: row.rangeFrom,
      rangeTo: row.rangeTo,
      amount: row.amount,
      rate: row.rate,
      data: parsed.value,
      sortOrder: row.sortOrder,
    }
  })
}
