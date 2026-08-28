/**
 * 多版本資料集的「這一次要做什麼」（零 IO 純函式，§0.1）。網路與資料庫那一段在 `impl/` 的 run 切片。
 *
 * ## 這一步存在的理由：把「決定」與「執行」分開
 *
 * `dataset_code=2`（16 個資源）、`5`（19 個）、`8`（勞動部公告頁上的每一則公告）、
 * `9`（財政部下載專區的每一個年度）的同步都是「一個資料集 → N 個版本」。
 * 對每一個資源要回答的問題只有一個——**它對應哪一個版本代碼，那個版本我們有了沒有**——
 * 而那個問題的材料全部來自資源自己的名字與資料庫裡已有的版本代碼清單，
 * 沒有一項需要下載。抽成純函式之後：
 *
 * - **不必下載就知道要跳過**。穩定狀態下（十幾個版本都已經在庫裡）一次同步只打一次探索網址，
 *   一份資源都不必抓。合成一條「先下載再說」的路的話，那是一年七千多次請求換零個新版本。
 * - 四種結局（新建／跳過／排除／失敗）與它們的判準是**看得到、測得到**的一張表，
 *   而不是散在一個帶著 `await` 的迴圈裡的幾個 `continue`。
 *
 * ## 幂等的落點就在這裡
 *
 * 「已經存在的版本跳過」以 **`version_code`** 判定（＝生效日的 `YYYY-MM`），不是以資源網址判定：
 * 資源網址帶隨機尾碼、政府隨時可能重新編號（見 `regulatory-data-gov.ts`），而版本代碼是我們自己
 * 由生效日推導出來的，且它正是 `UNIQUE(dataset_code, version_code)` 的一半。
 * 用網址判定的話，政府換一次尾碼就會讓十幾個版本全部被當成「新的」，然後在唯一鍵上整批撞。
 *
 * ⚠️ `dataset_code=8` 的每一則公告共用同一個網址（它們在同一頁上），
 * 那條路在網址判定下根本不可能成立——又一個「幂等只能靠版本代碼」的實例。
 *
 * ## 「推導不出來」與「不是候選」是兩件事（計畫 §7.1.2）
 *
 * 這是本檔最重要的一個區分，而它曾經不存在：原本任何推導不出生效日的資源都算失敗，
 * 於是 `20251` 那九個只有年度標示的歷史資源讓 `dataset_code=2` **在穩定狀態下永遠是 `status=3`**。
 * 一個永遠紅的告警，三個月後就沒有人會看——而那時真正的失敗（政府改了格式）跟著被忽略。
 *
 * | 結局 | 語意 | 判準在哪 |
 * |---|---|---|
 * | `fail` | 我們**不知道**它是哪一天生效 | `deriveEffectiveFrom` 回 `excluded: false` |
 * | `exclude` | 我們**決定不同步**它 | `deriveEffectiveFrom` 回 `excluded: true` |
 *
 * **判準一律機械可判定，而且只有一份**（§7.6）：它就在各資料集的 `deriveEffectiveFrom` 裡，
 * 本檔只負責把兩種結局分開排。**這裡不會有「跳過看不懂的資源」這條路**——跳過的後果是靜默的：
 * 政府哪天把最新那一份的說明從「115年1月…」改成別的寫法，同步會回報「無異動」
 * 而我們永遠拿不到新版本，那正是 §7.2 整條規則要防的東西。
 *
 * ⚠️ **排除也不得靜默**：`exclude` 的數量必須進同步摘要（`impl/` 的 run 切片負責），
 * 否則「政府哪天把新資源也只標年份」會變成看不見的資料缺口。
 */
import type { DeriveEffectiveFrom } from './regulatory-sync-model.ts'
import type { RegulatorySourceResource } from './regulatory-source-resource.ts'
import { toVersionCode } from './regulatory-sync-source.ts'

/**
 * 一個資源這一次的結局。
 *
 * `skip` 與 `create` 都帶著推導出來的生效日與版本代碼：`skip` 用不到它們，但同步歷程的摘要要印
 * 「跳過了哪幾版」，而那句話是給看 `error_message` 的人分辨「這一版早就有了」與「這一版沒進來」用的。
 */
export type MultiVersionPlanEntry =
  | {
      readonly action: 'create'
      readonly resource: RegulatorySourceResource
      readonly effectiveFrom: string
      /** 政府明示的失效日；絕大多數是 `null`（計畫 §3.2 (d)）。 */
      readonly effectiveTo: string | null
      readonly versionCode: string
    }
  | {
      readonly action: 'skip'
      readonly resource: RegulatorySourceResource
      readonly effectiveFrom: string
      readonly effectiveTo: string | null
      readonly versionCode: string
    }
  /** 不是候選：我們決定不同步它。**不算失敗，但要計數**（計畫 §7.1.2）。 */
  | { readonly action: 'exclude'; readonly resource: RegulatorySourceResource; readonly reason: string }
  /** 是候選，但推導不出生效日或撞了版本代碼：那個版本失敗（§7.2）。 */
  | { readonly action: 'fail'; readonly resource: RegulatorySourceResource; readonly reason: string }

/** 推導得出生效日的那兩種（`create`／`skip`）。由聯集推導而不是另外寫一份，兩者才不會分岔。 */
export type DatedMultiVersionPlanEntry = Extract<MultiVersionPlanEntry, { readonly effectiveFrom: string }>

/**
 * 排出這一次要做的事。
 *
 * @param resources 本次 resource discovery 探索到的**全部**資源（依來源的原順序）。
 * @param deriveEffectiveFrom 該資料集的生效日推導**與候選判準**（來源設定上的那一支，
 *   計畫 §7.2 與 §7.1.2 的共同落點）。
 * @param existingVersionCodes 這個資料集在資料庫裡已經有的版本代碼。
 *
 * ## 產物依生效日由舊到新排序，排除與失敗的排在最後
 *
 * 回補歷史時這個順序有實際意義：版本會**由舊到新**寫入，於是 `id` 的順序與生效日的順序一致。
 * 計畫 §3.2 (d) 的 `ORDER BY effective_from DESC, id DESC` 在「兩筆同日生效」時取後寫入的那一筆，
 * 而亂序寫入會讓「後寫入」與「較新」脫鉤——同日生效在補錄時是真的會發生的
 * （同一份資料被重新寫成新版本）。
 *
 * 排除與失敗的排在最後而且保持原順序：它們沒有生效日可以排，而原順序是政府那一份的順序，
 * 看紀錄的人拿它去對照政府的頁面最直接。**排除排在失敗之前**，於是摘要裡「哪幾個沒進來」
 * 讀起來是先讀完不該進來的、再讀該進來卻沒進來的。
 */
export const planMultiVersionSync = (
  resources: readonly RegulatorySourceResource[],
  deriveEffectiveFrom: DeriveEffectiveFrom,
  existingVersionCodes: readonly string[],
): readonly MultiVersionPlanEntry[] => {
  const existing = new Set(existingVersionCodes)
  /** 本批已經排定要新建的版本代碼。用來擋「兩個資源推導出同一個版本代碼」，見下。 */
  const plannedCodes = new Set<string>()

  const dated: DatedMultiVersionPlanEntry[] = []
  const excluded: MultiVersionPlanEntry[] = []
  const failed: MultiVersionPlanEntry[] = []

  for (const resource of resources) {
    const effective = deriveEffectiveFrom(resource.resourceDescription)
    if (!effective.ok) {
      // 這一行就是 §7.1.2 那條線：判準在 `deriveEffectiveFrom` 裡，本檔只負責把兩種結局分開。
      ;(effective.excluded ? excluded : failed).push({
        action: effective.excluded ? 'exclude' : 'fail',
        resource,
        reason: effective.reason,
      })
      continue
    }

    const versionCode = toVersionCode(effective.effectiveFrom)
    if (existing.has(versionCode)) {
      dated.push({
        action: 'skip',
        resource,
        effectiveFrom: effective.effectiveFrom,
        effectiveTo: effective.effectiveTo,
        versionCode,
      })
      continue
    }

    if (plannedCodes.has(versionCode)) {
      // 兩個資源指向同一個版本代碼。**失敗而不是取其中一個**：兩份內容一定不同（否則政府不會發兩份），
      // 而挑一份就是推測值；放行則會在寫第二份時撞 `UNIQUE(dataset_code, version_code)`，
      // 那時的錯誤訊息是一句 SQL 唯一鍵違反，看不出是哪兩個資源撞在一起。
      failed.push({
        action: 'fail',
        resource,
        reason:
          `與本次另一個資源推導出同一個版本代碼 ${versionCode}（生效日 ${effective.effectiveFrom}）：` +
          '同一個生效月份只能有一個版本，需要人工確認政府為什麼發了兩份',
      })
      continue
    }

    plannedCodes.add(versionCode)
    dated.push({
      action: 'create',
      resource,
      effectiveFrom: effective.effectiveFrom,
      effectiveTo: effective.effectiveTo,
      versionCode,
    })
  }

  // `localeCompare` 用不上：`YYYY-MM-DD` 是固定寬度、由大到小的格式，字典序即時間序
  //（同 `isHeartbeatStale` 對 `heartbeat_at` 的處置）。
  dated.sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? -1 : left.effectiveFrom > right.effectiveFrom ? 1 : 0))

  return [...dated, ...excluded, ...failed]
}
