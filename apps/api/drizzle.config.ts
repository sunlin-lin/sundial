import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit 設定。
 *
 * 這裡刻意直接讀 `process.env` 而不是走 `src/shared/config.ts`：drizzle-kit 是獨立於應用程式
 * 執行的 CLI，載入應用設定會把整條相依鏈（連線池、啟動自檢）拖進一個只需要連線字串的工具裡。
 *
 * 環境變數由 `package.json` 的 `bun --env-file=../../.env` 載入。drizzle-kit 自己不讀 `.env`，
 * 而 `bun run --filter` 是以套件目錄為 cwd 執行的——`.env` 在 repo 根目錄，不明確指定就讀不到。
 */

/**
 * 讀取必填的連線參數；缺值一律中止。
 *
 * **不給預設值**是這裡最重要的一件事。原本 host 預設 `127.0.0.1`、port 預設 `3306`，
 * 於是 `.env` 沒被載入時 drizzle-kit 不會報錯，而是拿著空帳密去敲 `127.0.0.1:3306`
 * ——那個位址上很可能是開發機的**另一個**專案的資料庫。migration 工具連錯資料庫的後果，
 * 是 DDL 跑進別人的 schema，而它會成功。
 */
const requireEnv = (key: string): string => {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(`環境變數 ${key} 未設定，drizzle-kit 拒絕執行（不猜預設連線參數）`)
  }
  return value
}

const requirePortEnv = (key: string): number => {
  const raw = requireEnv(key)
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`環境變數 ${key} 必須是正整數，實際為 ${raw}`)
  }
  return value
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    host: requireEnv('DB_HOST'),
    port: requirePortEnv('DB_PORT'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
  },
  // migration 的檔案順序即套用順序，禁止修改已套用的檔案（§4.1），
  // 因此這裡不開任何會改寫既有檔案的選項。
  strict: true,
  verbose: true,
})
