/**
 * 環境變數讀取。
 *
 * **刻意匯出函式而不是在模組層讀好的常數物件**：模組層讀取會在 import 的當下就要求環境變數齊全，
 * 而 §1.7 要求 `bun run gen:api` 必須在後端未啟動、資料庫未連線的情況下可執行——那條指令只 import
 * app 定義，不該因為少一個 `DB_PASSWORD` 就失敗。真正需要設定的只有啟動流程，由它呼叫本檔。
 */

export type DatabaseConfig = {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
  readonly database: string
}

export type SessionConfig = {
  readonly accessTokenSecret: string
  /** access token 的滑動視窗長度（§5.4.1，初始值 2 小時）。 */
  readonly accessTokenTtlSeconds: number
  /** refresh token 壽命（§5.4.1，初始值 30 天）。調整時要與上一項一起看。 */
  readonly refreshTokenTtlDays: number
}

/**
 * 欄位加密的金鑰材料（§5.1）。
 *
 * 本檔只負責「把字串從環境變數讀出來、缺值就中止」；**格式是否合法由 `db/field-encryption.ts` 驗**
 * ——base64、金鑰長度、active 代號在不在清單裡，那些是加密格式的知識，不該讓讀設定的人也要懂。
 */
export type FieldEncryptionConfig = {
  /** `<金鑰代號>:<base64 金鑰>`，逗號分隔可有多組（一把 active ＋ 若干把只用於解密的舊金鑰）。 */
  readonly keys: string
  /** 新資料一律用這個代號的金鑰加密。 */
  readonly activeKeyId: string
  /** blind index 專用金鑰（base64）。**與加密金鑰是兩把不同的金鑰**，理由見 `db/field-encryption.ts`。 */
  readonly blindIndexKey: string
}

/**
 * 法規同步排程器的設定（`scheduler/regulatory-sync-scheduler.ts`）。
 *
 * **只有「開不開」，沒有「多久跑一次」。** 頻率是一個有理由的決定（一年改一到兩次的資料、
 * 對政府端點的禮貌、法規改了多久會被發現），理由寫在排程器檔頭；做成環境變數之後，
 * 那個理由就會被一個沒有上下文的數字取代，而且每個環境可以不一樣——於是「正式環境到底多久跑一次」
 * 要去翻部署設定才答得出來。
 */
export type RegulatorySyncSchedulerConfig = {
  readonly enabled: boolean
}

export type AppConfig = {
  readonly nodeEnv: string
  readonly port: number
  readonly database: DatabaseConfig
  readonly session: SessionConfig
  readonly fieldEncryption: FieldEncryptionConfig
  readonly regulatorySyncScheduler: RegulatorySyncSchedulerConfig
}

/**
 * 讀取必填環境變數。
 *
 * 缺值一律中止而不是回退到預設：資料庫密碼、token 金鑰這類值一旦有預設，
 * 設定漏了也會「正常啟動」，然後連到錯的資料庫或用一把大家都知道的金鑰簽 token。
 */
const requireEnv = (key: string): string => {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(`環境變數 ${key} 未設定`)
  }
  return value
}

const requireIntEnv = (key: string): number => {
  const raw = requireEnv(key)
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`環境變數 ${key} 必須是正整數，實際為 ${raw}`)
  }
  return value
}

/**
 * 讀取「預設關閉」的開關。
 *
 * **本檔其餘的值一律 `requireEnv`（缺值即中止），這一支是唯一的例外，理由必須寫清楚。**
 *
 * 那條規則防的是「有預設值就會被用上」——資料庫密碼、token 金鑰一旦有預設，設定漏了也會正常啟動，
 * 然後連到錯的資料庫或用一把大家都知道的金鑰簽 token。那類值的預設**沒有一個是安全的**。
 * 開關不一樣：它的兩個值都合法，問題只在「漏設時該往哪邊倒」。
 *
 * **往「關閉」倒**，因為兩個方向的代價不對稱：
 * - 預設開啟時，漏設的後果是**每一台開發機、每一次 `bun run dev`（`--watch` 下每存一次檔）
 *   都會去打政府端點並往當下連到的資料庫寫版本**。那不是我們要的：開發機沒有理由每天對
 *   data.gov.tw 發幾百次請求，而「本機跑一跑就多了一個法規版本」會讓開發資料庫與正式環境分岔。
 * - 預設關閉時，漏設的後果是「沒有同步」。這件事本來會是無症狀的（正是計畫 §3.4 警告的那種安靜故障），
 *   因此排程器在停用時**一定會留一行啟動 log**——啟動的第一秒就看得到「排程器已停用」，
 *   而不是幾個月後才有人問「那個資料集怎麼沒有新版本」。
 *
 * 值一律嚴格比對 `true`／`false`，其餘（`1`、`yes`、`TRUE`、拼錯的字）**一律中止**：
 * 寬鬆解析的失敗模式是「設了 `1` 卻靜靜地被當成關閉」，那與漏設完全無法區分。
 */
const optionalBooleanEnv = (key: string): boolean => {
  const value = process.env[key]
  if (value === undefined || value === '') return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`環境變數 ${key} 只接受 true 或 false，實際為 ${value}`)
}

export const loadConfig = (): AppConfig => ({
  nodeEnv: requireEnv('NODE_ENV'),
  port: requireIntEnv('PORT'),
  database: {
    host: requireEnv('DB_HOST'),
    port: requireIntEnv('DB_PORT'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
  },
  session: {
    accessTokenSecret: requireEnv('ACCESS_TOKEN_SECRET'),
    accessTokenTtlSeconds: requireIntEnv('ACCESS_TOKEN_TTL_SECONDS'),
    refreshTokenTtlDays: requireIntEnv('REFRESH_TOKEN_TTL_DAYS'),
  },
  // 三個都走 requireEnv，缺一個就拒絕啟動（§5.1）：金鑰有預設值等於「設定漏了也會正常啟動」，
  // 然後整批個資用一把大家都知道的金鑰加密，而這件事沒有任何症狀。
  fieldEncryption: {
    keys: requireEnv('FIELD_ENCRYPTION_KEYS'),
    activeKeyId: requireEnv('FIELD_ENCRYPTION_ACTIVE_KEY_ID'),
    blindIndexKey: requireEnv('FIELD_BLIND_INDEX_KEY'),
  },
  // 預設關閉（理由見 {@link optionalBooleanEnv}）。正式環境要明寫 `true`，
  // 開發機保持未設定即可——`bun run dev` 不會去打政府端點。
  regulatorySyncScheduler: {
    enabled: optionalBooleanEnv('REGULATORY_SYNC_SCHEDULER_ENABLED'),
  },
})
