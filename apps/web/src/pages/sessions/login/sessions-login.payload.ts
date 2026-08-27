/**
 * 表單值 → 送出 payload（前端規範 §1.3 的第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * 這一類特別不能留在 `.vue` 的送出函式裡：payload 組裝的錯誤（該去掉的空白沒去掉、
 * 空字串沒轉 `null`、單位沒換算）**不會報錯**，只會讓後端收到一個形狀合法而語意錯誤的值。
 * 抽成純函式之後它才有測試（§8.1）。
 *
 * 這裡刻意**不宣告任何本地型別**：回傳型別直接用統一 client 的 `LoginInput`（§3.2 禁止
 * 前端手寫描述 API 形狀的型別）。三個欄位以獨立參數傳入，也是為了不要在 `pages/` 底下
 * 生出第二個「長得跟 request 一樣」的型別。
 */
import type { LoginInput } from '../../../shared/api/sessions.ts'

/**
 * 公司代號與帳號去掉前後空白，**密碼原樣送出**。
 *
 * 前兩者去空白的理由是實的：使用者從別的地方複製貼上帳號時很容易帶進一個尾隨空白，
 * 而後端的登入失敗訊息刻意含糊（不能透露是哪個欄位錯），他沒有任何線索可以自己發現。
 * 密碼則絕不能動——空白是合法的密碼字元，前端擅自去掉會讓一個設定過的密碼永遠登不進去，
 * 而使用者只會看到同一句含糊訊息。
 */
export const toLoginPayload = (
  companyCode: string,
  username: string,
  password: string,
): LoginInput => ({
  companyCode: companyCode.trim(),
  username: username.trim(),
  password,
})
