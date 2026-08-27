/**
 * 啟動自檢：資料庫連線的 session 時區必須是 `+08:00`，不符即拒絕啟動（§6）。
 *
 * 為什麼要擋在啟動：時區被誤設時，所有寫入的時間會**靜靜偏移**——沒有例外、沒有錯誤訊息、
 * 沒有測試會變紅，資料照樣寫得進去。等到有人察覺，已經有數個月的出勤與薪資是錯的，
 * 而且分不出哪幾筆需要修。啟動就擋下來是唯一能在事故發生**之前**攔住它的位置；
 * 讓服務起不來，遠比讓它算錯薪資便宜。
 */
import { sql } from 'drizzle-orm'
import type { Database } from './client.ts'

export const EXPECTED_SESSION_TIME_ZONE = '+08:00'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? { ...value } : null

/** 從驅動回傳的巢狀結果中取出第一列。刻意以 `unknown` 逐層收窄，不相依驅動的結果型別。 */
const readFirstRow = (result: unknown): Record<string, unknown> | null => {
  const rows = Array.isArray(result) ? result[0] : result
  const firstRow = Array.isArray(rows) ? rows[0] : rows
  return asRecord(firstRow)
}

/**
 * @throws 讀不到時區、或時區不是 `+08:00` 時拋出，並在訊息中附上**實際讀到的值**
 *   ——只說「時區不對」的話，排查的人還要自己連上去查一次。
 */
export const assertDatabaseTimeZone = async (db: Database): Promise<void> => {
  const result: unknown = await db.execute(sql`SELECT @@session.time_zone AS time_zone`)
  const actual = readFirstRow(result)?.['time_zone']

  if (typeof actual !== 'string') {
    throw new Error('無法讀取資料庫的 session 時區，拒絕啟動')
  }

  // MariaDB 會回傳 'SYSTEM' 表示沿用伺服器時區。那個值同樣不接受：它到底是不是 +08:00
  // 取決於容器的 TZ 設定，而那是另一個地方、另一個人維護的東西——「現在剛好是對的」
  // 不等於「下次重建容器還是對的」。
  if (actual !== EXPECTED_SESSION_TIME_ZONE) {
    throw new Error(
      `資料庫 session 時區必須是 ${EXPECTED_SESSION_TIME_ZONE}，實際為 ${actual}。` +
        '請檢查 MariaDB 的 --default-time-zone 與連線參數，時區不符會讓所有時間靜靜偏移。',
    )
  }
}
