/**
 * 前端 i18n 的組裝點（前端規範 §9.2）。
 *
 * **介面語言 zh-TW，使用者可見字串一律走 key，禁止在 `.vue` 內寫死中文**（`aria-label` 亦同）。
 * 這條之所以現在就要做，而不是「等真的要多語系再說」：裸中文字串散進模板之後，
 * 要找出「畫面上到底有哪些字」就只剩全文檢索，而檢索找不到被拼接出來的字串；
 * 屆時補這件事的成本是逐頁重讀，不是加一個檔案。
 *
 * 字在 `locales/`，界線的說明也在那裡（**來自後端的訊息由後端翻譯，前端不再準備第二份文案**）。
 * 本檔只做三件事：建立 i18n 實例、把扁平 key 的解析方式接上、把 key 的型別釘死。
 *
 * ---
 *
 * **為什麼用 vue-i18n，而不是繼續用一支查表的 `t()`。** 手寫版有一件事做不到：
 * `const MESSAGES = {...}` 的查表結果不是響應式的，**語系一換，已經渲染出來的畫面不會重畫**。
 * 那不是「多語系上線那天再處理」的問題——它會讓語系切換這個功能在畫面上看起來像壞掉
 * （選單改了、字沒改），而且沒有任何錯誤可查。`$t()` 是響應式的，切換 `locale` 就重新渲染。
 *
 * **套件只負責解析、回落與響應式，key 的型別聯集仍然由我們自己維護。** 這件事要靠兩段東西
 * 一起才成立，缺一半就只剩自動完成、擋不住任何寫錯：
 *
 * 1. 檔尾的 `declare module` 把語系檔的形狀灌進 vue-i18n 的 `DefineLocaleMessage`。
 *    這是 key 清單的來源，也是編輯器自動完成的來源。
 * 2. 元件端把 `useI18n()` 拿到的 `t` **以 {@link TranslateMessage} 標註後再用**（見下）。
 *
 * 為什麼第二段不能省：vue-i18n 的 `t()` 簽章長成 `<Key extends string>(key: Key | ResourceKeys)`
 * ——那個 `Key extends string` 是為了相容舊版留下的逃生口，**任何字串都推導得出來**，
 * 於是 `t('login.headnig')` 型別上完全合法，一路過關到執行期，畫面上出現一行 `login.headnig`。
 * 它看起來像一句還沒翻譯的訊息，不像一個 bug，所以不會有人回報。
 * 把 `t` 指派給一個 key 只收 {@link MessageKey} 的函式型別，就把那個逃生口關掉了
 * （寬鬆的函式可以指派給嚴格的函式型別，這一步不需要任何 `as`）。
 */
import { createI18n } from 'vue-i18n'
import type { MessageResolver } from 'vue-i18n'
import { ZH_TW } from './locales/zh-TW.ts'

/**
 * 預設語系，同時是回落語系：查不到的 key 與尚未翻完的語系都落回這裡（見下面的 `fallbackLocale`）。
 *
 * 新增語系＝`locales/` 多一個檔案 ＋ 下面 `messages` 多一列。這裡不另外維護一份「支援哪些語系」
 * 的清單——`messages` 的 key 就是那份清單，多維護一份的下場是兩邊會少一邊。
 */
const DEFAULT_LOCALE = 'zh-TW'

/**
 * 介面文字的 key（字面值聯集，由語系檔推導）。
 *
 * 由**預設語系**推導而不是聯集所有語系：其他語系可以只翻一部分（缺的回落預設語系），
 * 但「畫面上有哪些字」這份清單只能有一個來源，否則新語系少翻一則就會讓那個 key 從型別上消失，
 * 而症狀是一個完全無關的頁面突然編譯不過。
 */
export type MessageKey = keyof typeof ZH_TW

/**
 * 語系檔的形狀。
 *
 * 值刻意放寬成 `string` 而不是沿用 `as const` 的字面值：這個型別是用來約束**其他**語系檔的，
 * 而「zh-TW 說『登入』，所以 en-US 也必須說『登入』」顯然不是我們要的約束。
 */
export type LocaleMessageSchema = Record<MessageKey, string>

/**
 * 元件裡實際使用的翻譯函式型別：**key 只收 {@link MessageKey}**。
 *
 * 用法固定是這兩行（`$t` 這個名字是刻意的，見下）：
 *
 * ```ts
 * const { t } = useI18n()
 * const $t: TranslateMessage = t
 * ```
 *
 * 為什麼叫 `$t` 而不是留著 `t`：模板裡寫 `$t(...)` 是 vue-i18n 的慣用寫法，而**同名的區域變數會
 * 遮蔽掉套件注入的那個全域 `$t`**——於是模板裡那一行 `$t('...')` 檢查的是這個嚴格型別，
 * 不是套件那個什麼字串都收的版本。改名成別的（`msg`、`tr`）就得同時要求所有人記得別用 `$t`，
 * 而那條規則沒有任何檢查擋得住。
 *
 * 回傳值仍然是響應式的：`t` 在渲染期間讀 `locale`，語系一換，用到它的元件就重畫
 * ——那正是換掉手寫查表版的理由（見檔頭）。
 */
export type TranslateMessage = (key: MessageKey) => string

/**
 * 讓 vue-i18n 用**扁平 key**查訊息。
 *
 * vue-i18n 預設把 `.` 當巢狀路徑分隔，`t('login.field.company-code')` 會去找
 * `messages['login']['field']['company-code']`——而我們的語系檔是一層扁平物件，
 * 於是每一個 key 都查不到，畫面上全部變成 key 本身。
 *
 * **不用套件內建的 `flatJson` 選項**：那個選項會在載入時把扁平 key 攤成巢狀結構，
 * 於是「語系檔長什麼樣」與「執行期實際查的是什麼」變成兩件事，而 devtools 裡看到的
 * 是攤開後的樣子。自己解析只有這三行，換來的是兩邊永遠一致。
 *
 * 查不到時回 `null`（而不是 `undefined` 或 key 本身）：那是 vue-i18n 內部對「沒有這一則」的
 * 表示法，回它才會走到套件的回落與 missing 警告，回別的東西會被當成一則內容是它的訊息。
 */
const isMessageRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const resolveFlatKey: MessageResolver = (obj, path) => {
  if (!isMessageRecord(obj)) return null
  const message = obj[path]
  return typeof message === 'string' ? message : null
}

/**
 * i18n 實例。由 `main.ts` 掛上 app（`app.use(i18n)`）。
 *
 * `legacy: false` = Composition API 模式：`<script setup>` 用 `useI18n()`，
 * 元件內不再有 `this.$i18n`。留在 legacy 模式的話，`useI18n()` 直接不能用，
 * 而 §2 的 `<script setup>` 是全站唯一的元件寫法。
 *
 * **`globalInjection: false` 是刻意的。** 開著的話，套件會在每個元件上注入一個什麼字串都收的
 * 全域 `$t`，於是「忘了寫 `const $t: TranslateMessage = t`」的元件照樣渲染得出來、
 * 型別也照樣過——那支元件從此不受 key 檢查保護，而沒有任何方式看得出是哪幾支。
 * 關掉之後，漏寫的元件在第一次渲染就當場炸開（`$t is not a function`），
 * 而不是安靜地少掉一層保護。
 */
export const i18n = createI18n({
  legacy: false,
  globalInjection: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: { 'zh-TW': ZH_TW },
  messageResolver: resolveFlatKey,
})

/**
 * 把語系檔的形狀灌進 vue-i18n 的型別（檔頭列的第 1 段）。
 *
 * 這段擴充是**key 清單的來源**：編輯器的自動完成、以及 vue-i18n 自己的 `ResourceKeys` 都讀它。
 * 但光有它擋不住任何寫錯——真正把 key 收窄成編譯錯誤的是 {@link TranslateMessage}
 * 那一行標註（檔頭列的第 2 段）。兩段缺一，`$t('login.headnig')` 就會一路過關到執行期。
 */
declare module 'vue-i18n' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 介面擴充的唯一寫法：型別別名不能被 `declare module` 合併。
  export interface DefineLocaleMessage extends LocaleMessageSchema {}
}
