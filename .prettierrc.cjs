// Prettier 設定：對齊既有程式碼的實際風格，不是反過來把既有檔案重排。
// 寫這份設定前先抽查了 apps/api/src 與 apps/web/src 的既有檔案（employees、sessions、
// http、db 等模組），確認現況已經穩定收斂在下列風格，這份設定只是把現況寫下來。
module.exports = {
  // 現況一律單引號（import 路徑、字串字面值皆然），沒有例外。
  singleQuote: true,

  // 現況一律無分號（ASI 依賴的寫法），與 ESLint 端不重複管分號規則
  // （通用規範 §4.1：格式一律交給 Prettier，ESLint 只管邏輯）。
  semi: false,

  // 現況多數程式碼行落在 120 字元內；長行集中在中文說明性註解與長型別聯集，
  // Prettier 本來就不會重排 prose 註解，因此把 printWidth 訂在「程式碼」這個
  // 語意單位的實際上限即可，不必因為少數註解行而調高，調高只會讓其餘 99% 的
  // 程式碼跟著變寬、變難一眼看完。
  printWidth: 120,

  // 多行的物件／陣列／引數列表結尾加逗號（Prettier 3 預設值，現況已如此）：
  // 新增一個成員時只改一行，不會連動改到上一行讓 diff 多一行「純加逗號」的雜訊。
  trailingComma: 'all',
}
