/**
 * 資料集代碼 → 畫面上的名稱（§1.3 的第 (1) 類；依 §0.7 從 `.view.ts` 按主題拆出來的兄弟檔）。
 *
 * ## 為什麼名稱在前端這一份
 *
 * `regulatory.sync.list` 的回應**只有 `datasetCode` 這個數字**，沒有資料集名稱；而端點又
 * **必填 `datasetCode`**（一次只查一個資料集），所以畫面上一定要有一個「選哪一個資料集」的
 * 下拉，那個下拉的選項只能由前端自己列。
 *
 * ⚠️ **這是「代碼 ↔ 名稱」的第三份副本**（計畫 §3.1 的表格一份、後端 `REGULATORY_DATASETS`
 * 一份，`bun run check:dataset-code` 逐項比對那兩份），而這一份**不在那支掃描器的守備範圍內**。
 * 對調兩個名稱在這裡不會有任何地方變紅，使用者會看到一個標著「勞保」的健保同步歷程。
 * 因此下面的字**必須與後端常數逐字相同**，改動時要同時看那兩份。
 * 真正的解法是後端在回應裡帶上名稱（或計畫 §3 的 `overview` 端點回出資料集清單），
 * 那時這一份就該整個刪掉——這件事記在回報裡。
 *
 * 名稱不寫在這裡而是走語系檔 key（§9.2 禁止 `.vue` 與顯示邏輯寫死中文），
 * 值在 `shared/i18n/locales/zh-TW.ts`。
 */
import type { MessageKey } from '../../../shared/i18n/messages.ts'
import type { SyncDatasetCode } from './regulatory-sync.payload.ts'

/**
 * 代碼 → 語系 key。
 *
 * `satisfies Record<SyncDatasetCode, MessageKey>` 是這一份唯一的自動檢查：
 * **後端新增一個資料集時，這裡少一個鍵就編譯錯誤**。少了它，新資料集會安靜地不出現在下拉裡，
 * 而「選單少一項」不會有任何症狀——沒有人知道那個資料集的同步歷程看不到。
 *
 * `7` 不在這裡：那是永久空號，不是漏打（後端 `regulatory-dataset-code.ts` 檔頭）。
 */
const DATASET_LABEL_KEYS = {
  1: 'regulatory-sync.dataset.1',
  2: 'regulatory-sync.dataset.2',
  3: 'regulatory-sync.dataset.3',
  4: 'regulatory-sync.dataset.4',
  5: 'regulatory-sync.dataset.5',
  6: 'regulatory-sync.dataset.6',
  8: 'regulatory-sync.dataset.8',
  9: 'regulatory-sync.dataset.9',
  10: 'regulatory-sync.dataset.10',
} as const satisfies Record<SyncDatasetCode, MessageKey>

/**
 * 下拉的顯示順序＝代碼順序（與計畫 §3.1 的表格一致，讓兩邊可以逐列對照）。
 *
 * 這個陣列與上面那個物件看起來重複，**兩者互為對方的檢查**：物件擋「後端加了一個代碼、
 * 這裡沒跟上」，陣列擋「後端拿掉一個代碼、這裡還留著」（`satisfies` 會讓不存在的代碼編譯錯誤）。
 * 少了任一邊，其中一個方向就會靜靜地過。
 */
const DATASET_ORDER = [1, 2, 3, 4, 5, 6, 8, 9, 10] as const satisfies readonly SyncDatasetCode[]

/** 預設選的資料集：勞保投保薪資分級表。它是薪資結算最常被回頭核對的一份。 */
export const DEFAULT_DATASET_CODE: SyncDatasetCode = 1

export type DatasetOption = {
  readonly code: SyncDatasetCode
  readonly labelKey: MessageKey
}

/** 資料集下拉的選項。 */
export const DATASET_OPTIONS: readonly DatasetOption[] = DATASET_ORDER.map((code) => ({
  code,
  labelKey: DATASET_LABEL_KEYS[code],
}))

/** 表格「資料集」欄要顯示的語系 key。 */
export const datasetLabelKey = (code: SyncDatasetCode): MessageKey => DATASET_LABEL_KEYS[code]
