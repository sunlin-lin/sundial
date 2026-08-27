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

export type AppConfig = {
  readonly nodeEnv: string
  readonly port: number
  readonly database: DatabaseConfig
  readonly session: SessionConfig
  readonly fieldEncryption: FieldEncryptionConfig
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
})
