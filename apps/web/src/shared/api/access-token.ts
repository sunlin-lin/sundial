/**
 * access token 的存放（後端規範 §5.4.3、前端規範 §3.1）。
 *
 * **只存模組層變數，不進 `localStorage`／`sessionStorage`／cookie。**
 * 兩張票若同時被 XSS 拿走，後端的偷用偵測也救不回來——攻擊者可以比使用者本人更早 refresh，
 * 於是被強制登出的反而是使用者。存記憶體讓 access token 不會躺在 `localStorage.getItem`
 * 一行就能撈走的地方；把它存進 localStorage 換「重整不掉線」，等於為了省一支請求
 * 把票放在 XSS 最容易讀到的位置。
 *
 * **refresh token 這個檔案（以及整個前端）完全碰不到**：它在 httpOnly cookie 裡，JS 讀不到也寫不到。
 * 全前端不應該存在任何讀寫 refresh token 的程式碼。
 *
 * 代價寫在這裡免得被當成 bug：**重新整理頁面後 access token 會消失，這是預期行為。**
 */
let accessToken: string | null = null

export const readAccessToken = (): string | null => accessToken

export const rememberAccessToken = (token: string): void => {
  accessToken = token
}

export const forgetAccessToken = (): void => {
  accessToken = null
}
