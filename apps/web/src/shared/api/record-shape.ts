/**
 * 把 HTTP 回應這種外部邊界的 `unknown` 收斂成具體形狀的最小工具（通用規範 §2.2）。
 *
 * 存在的理由只有一個：**不要用 `as` 硬轉**。`as` 不做任何執行期轉換，只是叫編譯器閉嘴——
 * `payload as LoginData` 之後所有欄位存取都被視為安全，後端少回一個欄位時錯誤會在好幾層之外
 * 以 `Cannot read property of undefined` 爆出來，堆疊追蹤指向的位置與真正成因無關。
 *
 * 這裡的函式都回 `null` 而不丟例外：呼叫端（統一 client）要把「形狀不符」統一轉成系統錯誤，
 * 而不是讓一個型別問題偽裝成業務錯誤顯示給使用者。
 */

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 取一個非空字串欄位；不存在、型別不對或空字串一律回 `null`。 */
export const readNonEmptyString = (
  source: Readonly<Record<string, unknown>>,
  key: string,
): string | null => {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : null
}
