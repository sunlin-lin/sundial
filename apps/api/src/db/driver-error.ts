/**
 * 驅動層錯誤的取用。
 *
 * §4.3 要求唯一鍵違反必須「先寫入、攔截驅動錯誤、轉成業務錯誤」，而不是「先 SELECT 再 INSERT」
 * （後者在併發下必然漏判）。這條規則的前提是拿得到驅動錯誤的 `errno`，但 drizzle-orm 0.44
 * 會把 mysql2 的錯誤包進 `DrizzleQueryError`，`errno` 落在 `.cause` 上而不是頂層。
 *
 * 直接讀頂層 `errno` 會永遠讀到 `undefined`，於是唯一鍵違反被當成未預期的例外，
 * 回給使用者的是 500 而不是 409 ——**而且不會有任何地方報錯**，只有使用者看到系統錯誤。
 * 這個包裝層日後可能再變動，所以這裡不假設層數，沿 `cause` 鏈往下找。
 */

/**
 * 收窄成可索引的物件。
 *
 * **用型別述詞而不是物件展開**：展開只複製 own enumerable 屬性，驅動與 ORM 的錯誤物件
 * 常把欄位放在 prototype 上，展開之後會靜靜讀成 `undefined`。
 */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** 沿 `cause` 鏈往下找第一個帶 `errno` 的物件；找不到回 `null`。 */
export const findDriverError = (error: unknown): Record<string, unknown> | null => {
  // 上限純粹是防呆：cause 若被接成環，這裡不該把整個行程轉死。
  let current: unknown = error
  for (let depth = 0; depth < 8; depth += 1) {
    if (!isRecord(current)) return null
    if ('errno' in current) return current
    current = current['cause']
  }
  return null
}

/** MariaDB／MySQL 的唯一鍵違反。 */
export const DUPLICATE_ENTRY_ERRNO = 1062

/**
 * 這個錯誤是不是「撞到某個具名唯一索引」。
 *
 * 一定要比對索引名稱，不能只看 `errno`：一張表通常有多個唯一鍵，撞到哪一個對使用者的意義
 * 完全不同——有些是他改得掉的（代碼重複），有些是他改不掉的（內部識別碼碰撞）。
 * 只看 `errno` 就會把後者也回成「請換一個代碼」，而他怎麼換都不會成功。
 */
export const isUniqueViolation = (error: unknown, indexName: string): boolean => {
  const driverError = findDriverError(error)
  if (driverError?.['errno'] !== DUPLICATE_ENTRY_ERRNO) return false
  const message = driverError['sqlMessage']
  // 驅動沒帶 sqlMessage 時退回 true：這是兩害相權——拿掉唯一能用的訊號，
  // 會讓本來該回 409 的情況全部變成 500。
  return typeof message !== 'string' || message.includes(indexName)
}
