/**
 * 語系檔（前端規範 §9.2）。
 *
 * **介面語言 zh-TW，使用者可見字串一律走 key，禁止在 `.vue` 內寫死中文**（`aria-label` 亦同）。
 * 這條之所以現在就要做，而不是「等真的要多語系再說」：裸中文字串散進模板之後，
 * 要找出「畫面上到底有哪些字」就只剩全文檢索，而檢索找不到被拼接出來的字串；
 * 屆時補這件事的成本是逐頁重讀，不是加一個檔案。
 *
 * 目前只有一種語系，所以刻意**不引入 i18n 套件**：一個 key → 字串的對照表就足夠，
 * 而且 key 打錯是編譯錯誤（`MessageKey` 是字面量聯集），套件給不了這個保證。
 * 真的要多語系時，替換的是這一支 `t()` 的實作，呼叫端一行都不用改。
 */
const MESSAGES = {
  'app.name': 'Sundial',

  'login.heading': '登入',
  'login.subheading': '請輸入公司代號與帳號密碼',
  'login.field.company-code': '公司代號',
  'login.field.username': '帳號',
  'login.field.password': '密碼',
  'login.submit': '登入',
  // 刻意含糊：不得因為「帳號不存在」或「密碼錯誤」而顯示不同訊息，
  // 否則登入頁就變成一支帳號列舉工具——任何人都能逐一試出哪些帳號存在。
  'login.failed': '公司代號、帳號或密碼有誤，請確認後再試一次。',

  'dashboard.heading': '總覽',
  'dashboard.signed-in-as': '登入者',
  'dashboard.company': '所屬公司',
  'dashboard.sign-out': '登出',

  'menu.overview': '總覽',
  'menu.dashboard': '首頁',

  'error.permission-denied': '您沒有執行這項操作的權限。',
  'error.system': '系統發生錯誤，請稍後再試。',
} as const

export type MessageKey = keyof typeof MESSAGES

export const t = (key: MessageKey): string => MESSAGES[key]
