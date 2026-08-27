/**
 * 密碼雜湊與驗證（§5.1）。零 IO。
 *
 * 用 Bun 內建的 `Bun.password`，演算法固定 **Argon2id**（§5.1 允許 Argon2id 或 bcrypt cost ≥ 12）。
 * 不自己拼參數、不引第三方套件：Argon2 的參數（記憶體、迭代、並行度）寫錯不會有任何症狀
 * ——hash 算得出來、驗得回去、測試全綠，只是強度掉了一個數量級，而那件事沒有任何方式從外部看出來。
 *
 * **hash 只在這裡進出，其餘任何一層都拿不到它。** §5.1 禁止保存、log 或回傳明碼與 hash，
 * 而最容易違反的不是「有人故意印出來」，是 hash 跟著一個查詢結果物件被整包丟進 log 或錯誤訊息。
 */

/**
 * 查無帳號時用來「陪跑」的假 hash。
 *
 * **這是 §3.2「登入失敗的四種原因必須無法區分」在時間維度上的那一半。**
 * 沒有它的話，程式會長成這樣：查不到帳號就直接 return——而**回應時間會出賣答案**：
 * 帳號存在時要跑一次 Argon2id（刻意設計成慢，數十毫秒），不存在時立刻回，兩者差一個數量級。
 * 任何人都能用一支登入端點、拿一批猜測的帳號，把「這個帳號存在嗎」一個一個測出來，
 * 而**每一次探測在系統看來都是一次普通的登入失敗**，沒有任何一層會告警。
 *
 * 值本身是對一串隨機字串算出來的 Argon2id hash，**沒有任何人知道它的原文**，
 * 因此它不可能被驗證成功；它唯一的用途是讓「查無帳號」這條路徑也付出同樣的計算成本。
 * 寫死成常數而不是啟動時現算：現算要嘛在模組載入時花掉數十毫秒（`gen:api` 也會付這個成本），
 * 要嘛得放一個可變的模組層變數，而那會讓第一個請求與後續請求的時間又不一樣。
 */
const ABSENT_ACCOUNT_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$5+RAIYXxkmodFP8S8U21ykmPvAtEWtfIT2wVPWDLAcw$47ozoHmACRyUcC0r/KulYDK2OKcqiEaRIAWpvzEme6w'

/**
 * 取出要拿去驗證的 hash。
 *
 * @param storedHash 查到的帳號的 hash；查無帳號時傳 `null`。
 * @returns 查無帳號時回「陪跑」用的假 hash，讓兩條路徑跑**同一行**驗證程式碼。
 */
export const passwordHashToVerify = (storedHash: string | null): string =>
  storedHash ?? ABSENT_ACCOUNT_PASSWORD_HASH

/** 建立密碼 hash。目前只有測試與日後的 `credentials/main/*` 會用到。 */
export const hashPassword = (plainPassword: string): Promise<string> =>
  Bun.password.hash(plainPassword, { algorithm: 'argon2id' })

/**
 * 驗證密碼。
 *
 * @returns 不符即 `false`，**不拋例外**：密碼錯誤是預期中的結果，不是意外（§3.1.2）。
 *   hash 格式壞掉時 `Bun.password.verify` 會拋，那才是真的出事了——不接住，讓它走系統錯誤路徑。
 */
export const verifyPassword = (plainPassword: string, storedHash: string): Promise<boolean> =>
  Bun.password.verify(plainPassword, storedHash, 'argon2id')
