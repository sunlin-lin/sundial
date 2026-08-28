/**
 * 業務動作：依資料集與**法規適用基準日**取適用版本及其 records（計畫 §3.2 (d)、§4.1）。
 *
 * ## 這一支才是本模組存在的理由
 *
 * Payroll 結算時要依基準日取得**當時**的費率與級距，而政府事後更新不得改寫已結算的結果
 * （`docs/schema/05`「Payroll 邊界」）。它的呼叫者有兩種，而**對 Payroll 的介面不是 HTTP，
 * 是 `modules/regulatory/index.ts`**（計畫 §4.1）：Payroll 直接呼叫本函式，不打
 * `/regulatory/datasets/resolve`。HTTP 端點的存在是給前端顯示用的，兩者共用這一支 service。
 *
 * ## 失敗一律回 `ServiceResult` 的失敗分支，不拋例外（§3.1.1、計畫 §4.4）
 *
 * 拋例外的話 Payroll 必須 `catch` 才能繼續，而用 `catch` 表達業務流程正是該節禁止的事。
 * 回 `null` 更糟：呼叫端很容易寫成「單人查不到就 log 並 continue」，於是 300 人的批次結算裡
 * 那一個人的薪資單直接消失，而批次跑完看起來是成功的。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { RegulatoryDatasetCode } from '../domain/regulatory-dataset-code.ts'
import type {
  EffectiveRegulatoryDataset,
  RegulatoryDatasetsContext,
  ResolveEffectiveDatasetInput,
} from '../domain/regulatory-dataset-model.ts'
import { regulatoryNoEffectiveVersion } from '../regulatory-datasets.errors.ts'
import { findEffectiveDatasetVersion, listDatasetVersionRecords } from '../regulatory-datasets.repository.ts'

/**
 * 取適用版本與它的全部 records。
 *
 * @param input `asOfDate` **必填，本層不會替它填今天**（計畫 §4.2）：預設今天之後，
 *   補算去年 12 月的薪資會抓到今年的費率，算出一個**完全合理**的數字，沒有任何一層會發現不對。
 *   這不是靠自律——context 裡根本沒有 clock（見 `domain/regulatory-dataset-model.ts`）。
 *
 * 兩次查詢分先後而不是一次 join：先確定是哪一版，才知道要撈哪一批 records。
 * join 起來的話，「沒有適用版本」與「有版本但沒有 records」會變成同一種結果（零列），
 * 而前者是業務拒絕、後者是資料異常，兩者的處置完全不同。
 *
 * 沒有交易：兩次都是唯讀查詢，而版本與 records 都是 append-only 的（不會有人在這兩行之間
 * 改掉它們）。§4.4 要求同一交易的是「一個業務操作寫入多張表」，這裡一個字都沒寫。
 *
 * `TCode` 只是把 repository 那一層已經做完的收斂原樣帶到呼叫端，本層沒有多做任何事
 * ——它一個 `as` 都沒有，因此「收斂」與「檢查」不會分家（形狀是 `parseRegulatoryRecordData`
 * 真的驗過的那一個）。為什麼 HTTP 那一側不跟著收斂，見 `regulatory-datasets.service.ts` 檔頭。
 */
export const resolveEffectiveDataset = async <TCode extends RegulatoryDatasetCode>(
  context: RegulatoryDatasetsContext,
  input: ResolveEffectiveDatasetInput<TCode>,
): Promise<ServiceResult<EffectiveRegulatoryDataset<TCode>>> => {
  const version = await findEffectiveDatasetVersion(context.db, input.datasetCode, input.asOfDate)
  if (version === null) {
    // 錯誤集合只會有這一筆：本動作只有一條業務規則要檢查（「這一天有沒有版本」），
    // 沒有第二條可以一起收集。§3.1.1 要求的是「不要在第一筆就中斷」，不是「一定要湊多筆」。
    return fail([regulatoryNoEffectiveVersion(input.datasetCode, input.asOfDate)])
  }

  const records = await listDatasetVersionRecords(context.db, input.datasetCode, version.id)

  return succeed({
    datasetCode: input.datasetCode,
    // 基準日原樣帶回：呼叫端（尤其是把它記進已結算 Payroll 的那一方）要能證明
    // 「這一版是用哪一天解析出來的」，而那個日期只有呼叫端自己送過來的那一個。
    asOfDate: input.asOfDate,
    version,
    records,
  })
}
