/**
 * Session 到期判斷（前端規範 §3.7）。
 *
 * **只用 `expiresIn` 換算，永遠不用 `exp`。** 兩者的差別在於比較的兩端來源：
 * `exp` 是伺服器算出的截止點，要拿去跟**裝置**的現在時刻比——使用者的筆電慢 10 分鐘，
 * 判斷就錯 10 分鐘，而伺服器端完全看不出來也重現不了。`deadline` 由 `Date.now()` 算出、
 * 又拿 `Date.now()` 去比，裝置時鐘的偏移在相減時抵銷，準不準都不影響結果。
 *
 * **這是滑動視窗，不是固定到期時間。** 每一次通過身分驗證的請求都會續期，後端在**每個回應**
 * 都帶回續期後的剩餘秒數，因此收到就**無條件覆寫**——不保留第一次的值、不取較小值、
 * 也不自己每秒遞減。這不是防禦性寫法，是唯一正確的寫法：只認第一次的 deadline 會讓使用者
 * 明明一直在操作卻在登入後固定時間被登出；自己遞減則症狀相同但更難查，
 * 因為後端 log 上那個 session 根本還沒過期。
 *
 * 本檔是 §9.2「format 模組以外禁止 `Date.now(`」的兩個白名單例外之一
 *（另一個是統一 client 產生 `rqTS`）。
 */
let deadline: number | null = null

/**
 * 收到回應時無條件覆寫 deadline。
 *
 * `expiresIn === null` 表示本次請求未經 Session 授權（公開端點、`900`、登出成功），
 * **不得**據此判定 session 已失效——那會把登入頁打的每一支公開請求都誤判成登出。
 * 所以這裡只是原封不動地不動它，處置一律照 `code` 走。
 */
export const renewSessionDeadline = (expiresIn: number | null): void => {
  if (expiresIn === null) return
  deadline = Date.now() + expiresIn * 1000
}

/** 登出、或確定 token 已不可用時呼叫。 */
export const clearSessionDeadline = (): void => {
  deadline = null
}

/**
 * deadline 是否已經過了。
 *
 * 用途是「送出請求前就知道手上的票過期了」，讓整批請求收斂成一次 refresh
 *（見 client 的 single-flight）。沒有這道判斷也不會壞——過期的請求會拿到 `900` 再走 refresh——
 * 只是那條路上每一支請求都得先浪費一次往返。
 */
export const isSessionDeadlinePassed = (): boolean => deadline !== null && Date.now() >= deadline
