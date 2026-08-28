/**
 * 政府來源實地檢查：真的去打政府端點，確認「那一份還是我們認得的樣子」。
 *
 * 執行：`bun run check:live-sources`。**需要外網。**
 *
 * ## 這支指令不在 `bun run ci` 裡，這是刻意的
 *
 * CI 環境未必有外網（離線 runner、受限的出口規則），政府端點也會維護。串進 `ci` 之後，
 * 第一次紅燈的原因與那次 PR 完全無關，而那種紅燈的處置幾乎必然是「先關掉」——**關掉之後就永遠關著**。
 *
 * 因此它是一支獨立指令，**該由有外網的環境跑**：一支排程（例如每天一次、與同步排程錯開），
 * 或一個明確標成「需要外網」的專屬 job。那些環境裡它紅了就是紅了，**沒有寬容模式**
 * ——連不上失敗、HTTP 非 2xx 失敗、挑不到資源失敗、解析失敗、形狀不符也失敗。
 *
 * ## 它不是防線，排程同步才是
 *
 * **政府改格式的那一天，真正會發現的是排程同步本身**：解析失敗 → `regulatory_sync_logs`
 * 留下 `status_code=3` ＋ 一則 `error_message`（寫著哪一列的哪個欄位讀不懂）。
 * 那是有紀錄、可追查、留在資料庫裡的，而且**不需要這支腳本存在也照樣會發生**。
 *
 * 這支指令的價值只有一個：**在排程跑之前先知道**。把這件事寫出來，是為了讓下一個人在決定
 * 停掉它的時候知道自己在放棄什麼——放棄的是那段提前量（幾小時到一天，以及「不必等到隔天
 * 才發現今晚的同步會失敗」），**不是**對格式變更的偵測能力本身。
 *
 * **這句話是沒有例外的，而那是靠結構保證的：本檔一條自己的斷言都沒有。** 下面跑的每一條規則
 * 都在 `modules/regulatory` 裡、都是排程同步也會跑的同一份程式碼（見「它走的是正式流程的
 * 同一段程式碼」）。一旦有人在這裡加一條「只有這支指令做得到」的檢查，上面那句話當場就不成立了
 * ——那條檢查的正確位置是解析器或形狀定義，因為只有放在那裡，排程才擋得住它。
 *（實例：「四種投保身分別必須齊全」原本就寫在這裡，後來移進了
 * `sync/domain/regulatory-labor-insurance-salary.ts` 的完整性檢查。）
 *
 * ## 為什麼不留在 `bun run test` 裡
 *
 * 前身是 `sync/__tests__/regulatory-sync.live-source.test.ts`，它「連不上就印一行警告後通過」。
 * 那個取捨把兩個不同性質的問題混在同一次執行裡：
 *
 * - **「我們的解析邏輯對不對」** — 離線、可重現。它屬於 `bun run test`，
 *   而 `sync/__tests__/regulatory-sync-domain.test.ts` 餵固定字串測的就是同一批純函式。
 * - **「政府有沒有改格式」** — 連外、不可重現。它屬於監控。
 *
 * 混在一起之後，第二個**必須**寬容才不會弄壞第一個（否則沒有外網的 CI 會整批紅），
 * 而寬容就等於沒用：容器沒有外網時，那支測試從上線那天起一次都沒有真的跑過，
 * 而看起來一直是綠的。拆開之後兩邊都可以是嚴格的。
 *
 * ## 它走的是正式流程的同一段程式碼
 *
 * resource discovery、下載、解析、寫入前的形狀驗證四步，直接呼叫 `modules/regulatory` 的那幾支
 * （與 `sync/impl/regulatory-sync.run.service.ts` 同一份實作），只是不碰資料庫、不寫 `sync_logs`。
 * 另外寫一份「檢查專用」的解析，檢查的就會是一份沒有人在跑的程式碼。
 *
 * 直接 import 模組內部的 `domain/`（而不是走 `modules/regulatory/index.ts`）與 `seed-dev.ts` 同一種處置：
 * `index.ts` 是**跨模組**的出口，出的是 service 與 errors；這裡要的是零 IO 的來源設定與純函式，
 * 而把它們補上 `index.ts` 等於為了一支腳本擴大模組的對外面積。
 *
 * ## 位置（§7.2）
 *
 * 掃描型檢查要印出「命中位置」。本檔的檢查對象不是檔案，因此沒有 `檔名:行號` 的對應物；
 * 位置的對應物是**資料集代碼 ＋ 這一次探索到的資源網址**——後者正是事後追查時唯一有用的線索
 * （資源網址帶隨機尾碼，每次探索都可能不同，見 `regulatory-data-gov.ts`）。
 */
import { parseRegulatoryRecordData } from '../src/modules/regulatory/datasets/domain/regulatory-record-shape.ts'
import { selectDataGovResource, toDataGovMetadataUrl } from '../src/modules/regulatory/sync/domain/regulatory-data-gov.ts'
import { RESOURCE_FETCH_TIMEOUT_MS } from '../src/modules/regulatory/sync/domain/regulatory-sync-model.ts'
import {
  REGULATORY_SYNC_SOURCES,
  toVersionCode,
  type SyncableDatasetCode,
} from '../src/modules/regulatory/sync/domain/regulatory-sync-source.ts'

/**
 * 一則失敗。`datasetCode` 讓訊息指得出是哪一個資料集壞了，而不只是「某個來源對不上」。
 *
 * `resourceUrl` 在 resource discovery 之前還不知道（那一步的產物就是它），因此可以是 `null`。
 */
type Failure = {
  readonly datasetCode: SyncableDatasetCode
  readonly resourceUrl: string | null
  readonly detail: string
}

const failures: Failure[] = []

/** 完整跑完四步而且一則失敗都沒有的資料集數。只用在最後那行成功訊息上。 */
let passedDatasetCount = 0

type FetchOutcome = { readonly ok: true; readonly body: string } | { readonly ok: false; readonly reason: string }

/**
 * 打一次政府端點並取回內容。
 *
 * **連不上就是失敗，不是「跳過」。** 這一點與 `sync/impl/regulatory-sync.run.service.ts` 的
 * `fetchText` 刻意不同：那一支把連線失敗收斂成 `regulatory_sync_logs.error_message`（那是同步
 * 預期中的失敗模式，要留紀錄給人追查），而**這支指令的存在意義就是嚴格**——它跑在一個
 * 「本來就該有外網」的環境裡，連不上代表這次檢查沒有檢查到任何東西，那與「檢查通過」是兩件事。
 *
 * 逾時直接沿用正式流程的 {@link RESOURCE_FETCH_TIMEOUT_MS}：這裡量的是「政府端點在正式同步的
 * 條件下回不回得來」，另訂一個更短的值會讓這支指令在同步其實會成功的時候紅燈。
 */
const fetchText = async (url: string): Promise<FetchOutcome> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(RESOURCE_FETCH_TIMEOUT_MS) })
    if (!response.ok) return { ok: false, reason: `回應 HTTP ${String(response.status)}` }
    return { ok: true, body: await response.text() }
  } catch (error) {
    return { ok: false, reason: `連線失敗（${error instanceof Error ? error.message : String(error)}）` }
  }
}

/** 檢查一個資料集的完整流程（與正式同步的前四步相同，只是不寫資料庫）。 */
const checkDataset = async (datasetCode: SyncableDatasetCode): Promise<void> => {
  const source = REGULATORY_SYNC_SOURCES[datasetCode]

  // ① resource discovery：`government_resource_id` 不得硬編（計畫 §7.0），每次重新探索。
  const metadataUrl = toDataGovMetadataUrl(source.datasetId)
  const metadata = await fetchText(metadataUrl)
  if (!metadata.ok) {
    failures.push({ datasetCode, resourceUrl: null, detail: `metadata API ${metadata.reason}：${metadataUrl}` })
    return
  }

  const resource = selectDataGovResource(metadata.body, source.resourceFormat)
  if (!resource.ok) {
    // 連得上卻挑不到資源，這正是「政府改版了」最典型的樣子。
    failures.push({ datasetCode, resourceUrl: null, detail: `resource discovery 失敗：${resource.reason}` })
    return
  }

  const resourceUrl = resource.value.downloadUrl

  // ② 下載 raw。
  const downloaded = await fetchText(resourceUrl)
  if (!downloaded.ok) {
    failures.push({ datasetCode, resourceUrl, detail: `資源下載${downloaded.reason}` })
    return
  }

  // ③ 解析。生效日推導不出來也在這一步失敗（計畫 §7.2）。
  const parsed = source.parse(downloaded.body)
  if (!parsed.ok) {
    failures.push({ datasetCode, resourceUrl, detail: `解析失敗：${parsed.reason}` })
    return
  }

  if (parsed.records.length === 0) {
    // 解析器自己已經擋掉空來源，走到這裡代表它的「整批成功或整批失敗」被改壞了。
    failures.push({ datasetCode, resourceUrl, detail: '解析成功但一筆 record 都沒有' })
    return
  }

  // ④ 寫入前的形狀驗證（計畫 §6）。型別擋不到的那一半在這裡：decimal 字串的 pattern、
  //    字面值聯集的實際值——`2.95e4` 通得過編譯，通不過這一行。
  for (const record of parsed.records) {
    const shape = parseRegulatoryRecordData(datasetCode, record.data)
    if (!shape.ok) {
      failures.push({ datasetCode, resourceUrl, detail: `record_key=${record.recordKey} 形狀驗證失敗：${shape.reason}` })
    }
  }

  // 「這一個資料集有沒有新增失敗」而不是「整支有沒有失敗」：多個資料集時，前一個壞掉不該讓
  // 後一個看起來也壞掉。
  if (failures.every((failure) => failure.datasetCode !== datasetCode)) passedDatasetCount += 1

  process.stdout.write(
    `  ${failures.some((failure) => failure.datasetCode === datasetCode) ? '✗' : '✓'} ` +
      `[代碼 ${String(datasetCode)}] 生效日 ${parsed.effectiveFrom}（版本代碼 ${toVersionCode(parsed.effectiveFrom)}）、` +
      `${String(parsed.records.length)} 筆\n      ${resourceUrl}\n`,
  )
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const datasetCodes = Object.keys(REGULATORY_SYNC_SOURCES).map(Number) as SyncableDatasetCode[]

process.stdout.write(`政府來源實地檢查：${String(datasetCodes.length)} 個有解析器的資料集\n`)

// 逐一循序執行，不 `Promise.all`：對象是政府端點，同時開幾條連線省下的時間不值得
// 換來一個「是不是我們自己把對方打掛了」的疑問，而失敗訊息也會混在一起。
for (const datasetCode of datasetCodes) {
  await checkDataset(datasetCode)
}

// ---------------------------------------------------------------------------
// 自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * **一支什麼都沒檢查的檢查會永遠通過**，而「永遠通過」與「everything is fine」在輸出上一模一樣。
 *
 * 這裡的失效模式很具體：`REGULATORY_SYNC_SOURCES` 被清空、搬家、或某次重構讓它變成別的形狀，
 * 於是上面那個迴圈跑 0 圈、`failures` 也是空的，這支指令從此**每一次都通過**，
 * 而我們以為有人在盯著政府那一份。
 *
 * 判準是「清單裡有沒有東西可檢查」，**不是**「有幾個檢查成功」：三個資料集全部連不上時
 * 這次執行同樣什麼都沒驗到，但那是下面那組失敗要講的事（原因是連不上，不是掃描器壞了），
 * 兩者混在同一個標題底下會讓真正的成因被一句「自我檢查失敗」蓋掉。
 */
if (datasetCodes.length === 0) {
  process.stderr.write(
    [
      '政府來源實地檢查的自我檢查失敗（掃描結果不可信，一律視為失敗）：',
      '  ✗ REGULATORY_SYNC_SOURCES 一個資料集都沒讀到：這次執行等於沒跑',
      '    來源設定在 apps/api/src/modules/regulatory/sync/domain/regulatory-sync-source.ts；',
      '    若它已經搬家或改名，請一併修正本腳本的 import，不要把這個檢查停掉。',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

if (failures.length > 0) {
  process.stderr.write(
    [
      `政府來源實地檢查失敗（${String(failures.length)} 筆）——連不上，或政府那一份已經不是我們認得的樣子：`,
      ...[...failures]
        .sort((left, right) => left.datasetCode - right.datasetCode)
        .map(
          (failure) =>
            `  ✗ [代碼 ${String(failure.datasetCode)}] ${failure.detail}` +
            (failure.resourceUrl === null ? '' : `\n      本次探索到的資源：${failure.resourceUrl}`),
        ),
      '',
      '  連不上：這個環境不該連不上（本指令刻意只在有外網的環境跑，見檔頭），請先確認網路與端點狀態。',
      '  形狀對不上：下一次排程同步很可能會以 status=3 失敗（那一側會留下 error_message）。',
      '  處置一律是「改我們這一側去對上政府那一份」，不是放寬解析器或形狀定義——',
      '  放寬之後，對不上的資料會安靜地流進薪資結算（計畫 §6）。',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

process.stdout.write(`政府來源實地檢查通過：${String(passedDatasetCount)} 個資料集的來源、解析與形狀都仍然對得上。\n`)
