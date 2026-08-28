/**
 * 契約產生物是否存在，以及產生的 client 是不是真的走統一 client（§1.7、前端規範 §3.1）。
 *
 * ## 為什麼需要這一支
 *
 * 產生物不進版控（§1.7），所以**剛 clone 下來的 repo 一定沒有它們**。前端的每一支
 * API 呼叫都 import 產生的 client，於是那個狀態下的 `bun run typecheck:web` 會吐出
 * 一整片 `Cannot find module '../../api/generated/api-client.ts'`——十幾行紅字，
 * 每一行都指向一個「本來就不該在版控裡」的檔案，而真正該做的事（跑一次 `bun run gen:api`）
 * 一個字都沒有出現。
 *
 * 新人第一天遇到這一片紅字時，最合理的推論是「這個 repo 壞了」或「我少裝了什麼」，
 * 而不是「有一個指令我還沒跑」。這支檢查把那一片紅字換成一句話。
 *
 * 因此它**必須排在 `typecheck:web` 前面**（見根 package.json）：晚一步就沒有意義了，
 * 型別檢查已經先把紅字印出來了。
 *
 * ## 它只檢查「在不在」，不檢查「是不是最新的」
 *
 * 「產生物有沒有跟上後端」由 CI 保證：CI 每一輪都重跑 `bun run gen:api`（§1.7 要求它在
 * 沒有 DB service 的 job 中執行），因此 CI 看到的產生物永遠是當下這份程式碼產出來的。
 * 在本機加一道「內容是否過期」的檢查，等於在每次 typecheck 前都跑一次完整產生流程，
 * 而它擋下來的情況（本機忘了重跑）本來就會在下一次 typecheck 時以型別錯誤出現。
 *
 * ## 第二件事：產生的 client 必須注入統一 client
 *
 * 前端規範 §3.1 要求「產生器的 fetcher／httpClient 必須注入本專案的統一 client，
 * **禁止使用產生器的預設 fetcher**」，並指定以「產生器設定檔掃描」來擋。本專案沒有第三方產生器
 * 的設定檔——client 是 `scripts/generate-api.ts` 自己產的，注入點是那支腳本裡寫死的一行
 *（理由見該檔檔頭）。因此這條規則在這裡的對應物是**掃描產生出來的 client**：
 * 它必須 import 統一 client，而且不得自己碰任何傳輸 API。
 *
 * 為什麼值得掃：那一行被改掉的後果**在本機開發時完全看不出來**——access token 在有效期內
 * 不會過期，refresh 那條路徑要等兩、三個小時後才走得到，那時候通常已經上線了，
 * 症狀是「某幾個畫面隔一段時間就會莫名其妙被登出或整片空白」。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：從哪個目錄呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

const REPO_ROOT = resolve(API_ROOT, '../..')

/**
 * `bun run gen:api` 應該產出的每一個檔案。
 *
 * **逐檔列出，不只檢查目錄存在**：目錄本身是進版控的（裡面有 README 說明它是什麼），
 * 只看目錄的話這支檢查永遠通過。也不只檢查其中一個檔案——產生流程中途失敗時
 * （例如型別產生成功、client 產生時拋錯）留下的正是「有一部分、缺一部分」的狀態。
 */
const REQUIRED_ARTIFACTS = [
  'openapi.json',
  'apps/web/src/api/generated/api-types.ts',
  'apps/web/src/api/generated/api-guard.ts',
  'apps/web/src/api/generated/api-client.ts',
] as const

const missing = REQUIRED_ARTIFACTS.filter((artifact) => !existsSync(join(REPO_ROOT, artifact)))

if (missing.length > 0) {
  console.error('契約產生物不存在，前端的型別檢查會失敗。')
  console.error('')
  console.error('  請先執行：bun run gen:api')
  console.error('')
  console.error('缺少的檔案：')
  for (const artifact of missing) console.error(`  ${artifact}`)
  console.error('')
  console.error(
    '這些檔案由後端路由 schema 產生，刻意不進版控（後端規範 §1.7）——' +
      '進版控後必然出現「忘了重跑」的髒 diff，review 時也分不出哪些行是人改的、哪些是機器產的。',
  )
  console.error('該指令不需要啟動後端、也不需要資料庫。')
  process.exit(1)
}

// --- 產生的 client 必須注入統一 client（前端規範 §3.1） ---------------------

const CLIENT_FILE = 'apps/web/src/api/generated/api-client.ts'

/** 統一 client 的注入點。這一行不在，就代表產生器的注入被改掉了。 */
const UNIFIED_CLIENT_IMPORT = "import { callApi } from '../../shared/api/client.ts'"

/**
 * 產生的 client 裡不得出現的傳輸 API。
 *
 * 出現其中任何一個，都代表有請求繞過了統一 client——而繞過去的那些請求會漏掉 token 附加、
 * single-flight refresh、envelope 拆解與 `code` 分支。
 */
const FORBIDDEN_TRANSPORT = ['fetch(', 'axios', 'XMLHttpRequest', 'navigator.sendBeacon'] as const

const clientSource = readFileSync(join(REPO_ROOT, CLIENT_FILE), 'utf8')

const failures: string[] = []

if (!clientSource.includes(UNIFIED_CLIENT_IMPORT)) {
  failures.push(`${CLIENT_FILE} 沒有 import 統一 client（應有：${UNIFIED_CLIENT_IMPORT}）`)
}

for (const token of FORBIDDEN_TRANSPORT) {
  if (clientSource.includes(token)) {
    failures.push(`${CLIENT_FILE} 出現了 \`${token}\`：產生的 client 不得自己送請求，傳輸一律交給統一 client`)
  }
}

/**
 * 每一支產生的端點函式都必須經過 `callApi`。
 *
 * 兩個數字由**兩種不同的方式**數出來（函式宣告 vs `callApi(` 的出現次數），
 * 不是拿同一個 regex 比自己：後者兩邊一起寫錯就一起綠。
 */
const endpointFunctions = clientSource.match(/^export const \w+ = \(input: /gmu)?.length ?? 0
const callApiUses = clientSource.match(/\bcallApi\(/gu)?.length ?? 0

// 通用規範 §7.2：掃描器必須先確認自己真的掃到東西。產生器換了樣板、函式簽章改了形狀，
// 上面兩個 regex 就會一起數到 0，而「0 === 0」是綠的。
if (endpointFunctions === 0) {
  failures.push(`${CLIENT_FILE} 裡一支端點函式都沒掃到：產生器的樣板可能已經變更，這支檢查等於沒有在檢查`)
} else if (endpointFunctions !== callApiUses) {
  failures.push(
    `${CLIENT_FILE} 有 ${String(endpointFunctions)} 支端點函式，但只用了 ${String(callApiUses)} 次 callApi：` +
      '有端點沒有走統一 client',
  )
}

if (failures.length > 0) {
  console.error('產生的 API client 沒有走統一 client（前端規範 §3.1）：')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('')
  console.error('注入點在 apps/api/scripts/generate-api.ts 的 client 樣板裡，改那裡而不是改產生物。')
  process.exit(1)
}

console.log(
  `契約產生物齊全（${String(REQUIRED_ARTIFACTS.length)} 個檔案），` +
    `${String(endpointFunctions)} 支端點函式全部經過統一 client。`,
)
