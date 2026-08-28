/**
 * `drizzle/*.sql` ↔ `drizzle/meta/_journal.json` 雙向比對，外加 journal 本身的兩項完整性檢查。
 *
 * ## 為什麼需要這一支：`db:migrate` 讀的是 journal，不是資料夾
 *
 * drizzle-kit 的 `migrate` **不是照 `drizzle/*.sql` 的檔案清單跑，是照
 * `drizzle/meta/_journal.json` 的 `entries` 跑**。手寫一支 migration SQL 而忘了同步補上
 * `_journal.json`（與對應的 `meta/NNNN_snapshot.json`）時：
 *
 * - `bun run db:migrate` 照樣印出 `migrations applied successfully`
 * - 實際上**零個動作**，表沒有建立
 *
 * 這不是理論上的風險——開發部門模組的過程中真的踩到了：第一次跑完顯示成功，
 * `departments` 表卻不存在。在正式環境這叫「部署回報遷移完成，但表不在」，
 * 而且**沒有任何錯誤訊息**、沒有非零結束碼、沒有 log 裡的任何異狀。唯一能擋住這件事的
 * 時間點是寫下這支 migration 的當下，而那正是這支腳本要做的事。
 *
 * ## 兩個方向的失敗模式不同，分開報
 *
 * - **`drizzle/*.sql` 有、`_journal.json` 沒有**：這支 migration **永遠不會被執行**，
 *   而 `db:migrate` 回報成功——這是上面踩到的那一種，也是比較危險的一種，因為它不會有
 *   任何症狀，直到有人發現表不存在。
 * - **`_journal.json` 有、`drizzle/*.sql` 沒有**：`db:migrate` 執行到那一筆時會找不到檔案，
 *   直接拋錯中止。這一種比較沒那麼危險——它會炸，不會靜靜地什麼都不做——但仍然要擋，
 *   因為兩者的修法完全不同：前者是「把 entry 補回 journal」，後者是「把檔案救回來或砍掉那個
 *   entry」，把兩種訊息合併成一句「兩份清單不一致」只會讓人拿錯修法去試另一種問題。
 *
 * ## 順帶檢查的兩項，同樣各自獨立報告
 *
 * - **`entries` 必須依 `idx` 嚴格遞增且不跳號**（從 0 開始，逐一 +1）。跳號本身不會讓
 *   `db:migrate` 壞掉——drizzle-kit 只在乎陣列順序，不會回頭驗證 `idx` 的數列——但它是
 *   「有人手動編輯過這份檔案」的訊號，而手動編輯正是上面那個靜默失敗的來源。與其等真正
 *   的漏補發生，不如在「有人在改這份本該由 CLI 產生的檔案」的當下就先吵一次。
 * - **每一筆 entry 的 `idx` 必須對得上一個實際存在的 `meta/<idx 補零 4 位>_snapshot.json`**。
 *   缺 snapshot 時 `drizzle-kit generate` 產出下一支 migration 會以錯誤的基準做 diff——
 *   產出的 SQL 可能重複建立既有欄位，或漏掉這一版真正要做的變更，而那份 SQL 在寫下的當下
 *   看起來完全正常，要等套用到一個「基準版本」的資料庫上才會炸。
 *
 * ## 掃描器自我檢查（通用規範 §7.2）
 *
 * `drizzle/*.sql` 命中 0 個檔案時必須**失敗**而不是通過：目錄搬家、`drizzle.config`
 * 改了 `out` 路徑之後，這支腳本會照跑、照綠、零命中，而上面兩個方向的規則等於整條消失，
 * 消失的方式還是「看起來在跑」。只斷言 `> 0`，不寫死「至少 N 支」這種下限——那種下限
 * 每新增一支 migration 就要有人回來改一次數字，改久了不會再有人真的去看那個數字對不對，
 * 它只是一個每次都要跟著調高、沒人記得為什麼存在的儀式。`_journal.json` 的 entries 與
 * `meta/*_snapshot.json` 兩個數字比照辦理。
 *
 * 執行：`bun run check:migration-journal`（已串進 `bun run ci`，排在 `check:audit-transaction`
 * 之後——理由與那支腳本相同：兩者都是純靜態掃描，放在一起讓「規範掃描」這一段在 ci 裡連續）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：從哪個目錄呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

const DRIZZLE_DIR = join(API_ROOT, 'drizzle')
const META_DIR = join(DRIZZLE_DIR, 'meta')
const JOURNAL_FILE = join(META_DIR, '_journal.json')

/**
 * 直接把整支腳本判為不可信並中止：journal 讀不到、格式不是預期形狀這類「掃描前提不成立」的情形。
 *
 * 寫成 function 宣告而不是 const 箭頭函式，是為了讓 TypeScript 的控制流分析認得 `never`
 * ——箭頭函式要另外標注變數型別才有同樣效果，那是更容易在重構時掉的一種寫法。
 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 掃描前提：journal 檔必須存在且是預期的形狀
// ---------------------------------------------------------------------------

if (!existsSync(JOURNAL_FILE)) {
  abort([
    '找不到 drizzle/meta/_journal.json，這次掃描等於沒跑：',
    `  ✗ ${JOURNAL_FILE}`,
    '    這個檔案由 drizzle-kit 產生（`bun run db:generate`）。若它已經搬家或改名，',
    '    請一併修正本腳本的 JOURNAL_FILE，不要把這個檢查停掉。',
  ])
}

let journalRaw: unknown
try {
  journalRaw = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8'))
} catch (error) {
  abort([
    '_journal.json 不是合法的 JSON，掃描結果不可信：',
    `  ✗ ${JOURNAL_FILE}`,
    `    ${error instanceof Error ? error.message : String(error)}`,
  ])
}

if (typeof journalRaw !== 'object' || journalRaw === null || !('entries' in journalRaw)) {
  abort(['_journal.json 缺少 entries 欄位，不是 drizzle-kit 產生的形狀：', `  ✗ ${JOURNAL_FILE}`])
}

const rawEntries = (journalRaw as { entries: unknown }).entries
if (!Array.isArray(rawEntries)) {
  abort(['_journal.json 的 entries 不是陣列，不是 drizzle-kit 產生的形狀：', `  ✗ ${JOURNAL_FILE}`])
}

/** journal 裡的一筆 entry，只取這支腳本用得到的兩個欄位；其餘（when、version、breakpoints）不驗證。 */
type JournalEntry = { readonly idx: number; readonly tag: string }

const entries: JournalEntry[] = []
for (const [position, raw] of rawEntries.entries()) {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as { idx?: unknown }).idx !== 'number' ||
    typeof (raw as { tag?: unknown }).tag !== 'string'
  ) {
    abort([
      `_journal.json 的 entries[${String(position)}] 不是預期形狀（缺少數字 idx 或字串 tag）：`,
      `  ✗ ${JSON.stringify(raw)}`,
    ])
  }
  entries.push(raw as JournalEntry)
}

// ---------------------------------------------------------------------------
// 掃描前提：drizzle/ 與 meta/ 底下的檔案清單
// ---------------------------------------------------------------------------

const sqlFilenames = readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith('.sql'))
/** 檔名去掉副檔名就是 journal 裡對應的 `tag`（drizzle-kit 的命名規則）。 */
const sqlTags = new Set(sqlFilenames.map((name) => name.replace(/\.sql$/u, '')))

const metaFilenames = readdirSync(META_DIR)
const snapshotFilenames = new Set(metaFilenames.filter((name) => /^\d{4}_snapshot\.json$/u.test(name)))

// ---------------------------------------------------------------------------
// 掃描器自我檢查（通用規範 §7.2）：先確認真的掃到東西，再談比對結果可不可信
// ---------------------------------------------------------------------------

const selfCheckFailures: string[] = []
if (sqlFilenames.length === 0) {
  selfCheckFailures.push(
    `${DRIZZLE_DIR} 底下一支 .sql 都沒掃到：目錄搬家或改了輸出路徑？零命中不代表沒有問題，代表這支腳本沒在檢查任何東西`,
  )
}
if (entries.length === 0) {
  selfCheckFailures.push('_journal.json 的 entries 是空陣列：journal 本身是空的，比對等於沒跑')
}
if (snapshotFilenames.size === 0) {
  selfCheckFailures.push(`${META_DIR} 底下一個 NNNN_snapshot.json 都沒掃到：snapshot 的存在性檢查等於沒跑`)
}

if (selfCheckFailures.length > 0) {
  abort(['掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：', ...selfCheckFailures.map((line) => `  ✗ ${line}`)])
}

// ---------------------------------------------------------------------------
// 方向一：drizzle/*.sql 有、_journal.json 沒有 —— 這支 migration 永遠不會被執行
// ---------------------------------------------------------------------------

const journalTags = new Set(entries.map((entry) => entry.tag))
const orphanSqlFiles = sqlFilenames.filter((name) => !journalTags.has(name.replace(/\.sql$/u, '')))

// ---------------------------------------------------------------------------
// 方向二：_journal.json 有、drizzle/*.sql 沒有 —— db:migrate 執行到這裡會找不到檔案
// ---------------------------------------------------------------------------

const orphanJournalEntries = entries.filter((entry) => !sqlTags.has(entry.tag))

// ---------------------------------------------------------------------------
// 順帶檢查一：idx 必須嚴格遞增且不跳號（從 0 開始）
// ---------------------------------------------------------------------------

const idxFailures: string[] = []
entries.forEach((entry, position) => {
  if (entry.idx !== position) {
    idxFailures.push(
      `entries[${String(position)}]（tag=${entry.tag}）的 idx 是 ${String(entry.idx)}，預期 ${String(position)}`,
    )
  }
})

// ---------------------------------------------------------------------------
// 順帶檢查二：每一筆 entry 的 idx 必須對得上一個實際存在的 snapshot
// ---------------------------------------------------------------------------

const snapshotFailures: string[] = []
for (const entry of entries) {
  const expected = `${String(entry.idx).padStart(4, '0')}_snapshot.json`
  if (!snapshotFilenames.has(expected)) {
    snapshotFailures.push(`entry idx=${String(entry.idx)}（tag=${entry.tag}）缺少對應的 meta/${expected}`)
  }
}

// ---------------------------------------------------------------------------
// 彙整輸出：四類問題分開報，不合併成一句「不一致」
// ---------------------------------------------------------------------------

const sections: string[] = []

if (orphanSqlFiles.length > 0) {
  sections.push(
    [
      `drizzle/*.sql 存在、但 _journal.json 沒有對應 entry（${String(orphanSqlFiles.length)} 筆）：`,
      '這些 migration 永遠不會被 db:migrate 執行，而它會回報成功——這是最危險的一種，不會有任何症狀。',
      '修法：用 `bun run db:generate` 補產生對應的 journal entry 與 snapshot，不要手動編輯 _journal.json。',
      ...orphanSqlFiles.map((name) => `  ✗ drizzle/${name}`),
    ].join('\n'),
  )
}

if (orphanJournalEntries.length > 0) {
  sections.push(
    [
      `_journal.json 有 entry、但 drizzle/*.sql 沒有對應檔案（${String(orphanJournalEntries.length)} 筆）：`,
      'db:migrate 執行到這一筆時會找不到檔案並直接失敗。',
      '修法：把遺失的 .sql 檔案救回來，或者這筆 entry 本來就不該存在時把它從 journal 移除（連同 snapshot）。',
      ...orphanJournalEntries.map((entry) => `  ✗ idx=${String(entry.idx)} tag=${entry.tag}`),
    ].join('\n'),
  )
}

if (idxFailures.length > 0) {
  sections.push(
    [
      `_journal.json 的 entries 沒有依 idx 嚴格遞增（${String(idxFailures.length)} 筆）：`,
      '跳號本身不會讓 db:migrate 壞掉，但它是「有人手動編輯過這份檔案」的訊號——',
      '而手動編輯正是「漏補 entry 導致 migration 靜默不執行」的來源，請用 `bun run db:generate` 重新產生。',
      ...idxFailures.map((line) => `  ✗ ${line}`),
    ].join('\n'),
  )
}

if (snapshotFailures.length > 0) {
  sections.push(
    [
      `_journal.json 的 entry 缺少對應的 meta/NNNN_snapshot.json（${String(snapshotFailures.length)} 筆）：`,
      '缺 snapshot 時，下一次 `drizzle-kit generate` 會用錯誤的基準做 diff，',
      '產出的 SQL 可能重複建立既有欄位、或漏掉這一版真正要做的變更。',
      ...snapshotFailures.map((line) => `  ✗ ${line}`),
    ].join('\n'),
  )
}

if (sections.length > 0) {
  process.stderr.write([...sections, ''].join('\n\n'))
  process.exit(1)
}

process.stdout.write(
  `migration journal 檢查通過：${String(sqlFilenames.length)} 支 .sql、${String(entries.length)} 筆 journal entries、` +
    `${String(snapshotFilenames.size)} 份 snapshot，雙向一致、idx 連續、snapshot 齊全。\n`,
)
