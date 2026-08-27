/**
 * 讀取資料庫驅動回傳的影響列數（零 IO 純函式）。
 *
 * §4.4 的條件式 UPDATE 靠「影響 0 列」判斷併發衝突，因此這個數字是一條**業務規則的依據**，
 * 不是除錯資訊。取不到就必須當場中止：把取不到當成 0 會讓每一次正常的狀態變更都被回報成
 * 「資料已被別人改過」，取不到當成 1 則會讓真正的併發衝突靜靜通過，而狀態變更的副作用被套用兩次。
 *
 * 之所以放在 `domain/` 而不是各 repository 切片內：切片之間不得互相 import（§0.4），
 * 而需要它的切片不只一個——留在切片裡就得複製，改一處漏一處。它不碰 IO，符合本目錄的條件。
 */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? { ...value } : null

/**
 * 從驅動的巢狀結果中取出 `affectedRows`。
 *
 * 刻意以 `unknown` 逐層收窄而不相依 mysql2／drizzle 的結果型別：那些型別在版本之間會改名，
 * 而這裡真正需要的只是「第一層可能是陣列，裡面有一個帶 `affectedRows` 的物件」這個事實。
 *
 * @throws 結果形狀不符時拋出。這是**系統錯誤**（§3.1.2）——驅動回了預期外的東西是意外，
 *   不是業務拒絕，必須帶著堆疊進告警，而不是被包成一句給使用者看的訊息。
 */
export const readAffectedRows = (result: unknown): number => {
  const header = asRecord(Array.isArray(result) ? result[0] : result)
  const affectedRows = header?.['affectedRows']
  if (typeof affectedRows !== 'number') {
    throw new Error('資料庫驅動未回傳 affectedRows，無法判斷條件式 UPDATE 是否命中（§4.4）')
  }
  return affectedRows
}
