/**
 * 後端訊息目錄的查詢入口：`訊息 key` → 該語系的字串（§1.3、§1.8.2）。
 *
 * **「哪一則訊息」與「哪一種語言」是兩個決定，分屬兩層。** service 與各模組的 `*.errors.ts` 決定前者
 * （產出 key，不是字串）；**只有出口層決定後者**——它是整條鏈上唯一讀得到 `locale` 的一層（§1.8.2）。
 * 因此本檔只提供 {@link translate} 與 {@link resolveLocale}，**自己不決定任何一次翻譯發生在哪裡**：
 * 業務層一旦拿得到翻譯後的字串，同一段業務規則被第二種入口（設備、對外 API）呼叫時，
 * 那個入口的語系就再也蓋不掉業務層當初挑的那一種（§1.0.1）。
 *
 * **後端做語系檔，而不是「只回 code 讓前端自己翻」**：非 Web 前端的入口也拿得到翻譯過的訊息，
 * 不必每種入口各自維護一份文案——那正是同一件事會有兩套說法的來源。
 *
 * ---
 *
 * **為什麼用 i18next，而不是繼續手寫一張對照表。** 手寫版做不到插值：`role.in-use` 的
 * `errors[].data` 早就帶著 `assignedUserCount`，訊息卻只能說一句沒有數字的「仍有成員使用此角色」，
 * 因為對照表裡放的是一個死字串。自己補一個 `replace('{{x}}', ...)` 等於自己寫一個會愈長愈大的
 * 樣板引擎（複數、日期、巢狀變數、跳脫），而那已經是套件在做的事。
 *
 * **套件只負責解析、插值與回落，key 的型別聯集仍然由我們自己維護。** i18next 的 `t()` 收 `string`，
 * 直接用它等於把「錯誤碼打錯一個字母」從編譯錯誤降級成執行期回一句查不到的訊息。因此
 * {@link translate} 的 `key` 參數型別是 {@link MessageKey}（下面由語系檔推導出來的字面值聯集），
 * 呼叫端拿不到 `string` 這條路。
 *
 * **本檔同時是 §1.3 要求的「錯誤碼集中聯集」，而不是第二份對照表。** 錯誤碼與訊息 key 刻意是
 * 同一個字串（`auth.invalid-credentials`），於是「有哪些錯誤碼」與「每個錯誤碼講哪句話」
 * 必然是同一份清單——不可能一邊加了、另一邊忘了。各模組的 `*.errors.ts` 以
 * `satisfies Record<string, ErrorCode>` 釘住自己那組碼，因此模組新增一個沒寫進語系檔的碼時，
 * **模組當場編譯不過**，而不是等到執行期回一句空訊息給使用者。
 *
 * ⚠️ 字面中文全部在 `locales/`，且**有好幾則是刻意含糊的**（§3.2）。改字之前請先讀該錯誤碼
 * 在 `*.errors.ts` 上的說明——規格在那裡，字在語系檔。
 */
import i18next from 'i18next'
import { logger, LogCategory } from '../logger.ts'
import { ZH_TW_ERRORS, ZH_TW_PLATFORM } from './locales/zh-TW.ts'

/**
 * 支援的語系。
 *
 * 新增語系是相容變更（§1.6）：加值、不刪值。加進來之後 {@link CATALOGS} 要多一份目錄，
 * 而 §2 的 `Locale` schema 會自動跟著放行（`field-schemas.ts` 由本清單推導，不另寫一份）。
 */
export const SUPPORTED_LOCALES = ['zh-TW'] as const

export type LocaleValue = (typeof SUPPORTED_LOCALES)[number]

/**
 * 回落語系。
 *
 * 兩種情況會用到它：請求沒帶 `locale`（例如錯誤發生在 body 解析之前），以及帶了一個我們不支援的
 * 語系。兩者都不該讓使用者看到空字串或一個 `role.not-found` 這樣的 key——**key 上畫面比沒有訊息更糟**：
 * 使用者看不懂，客服也看不懂，而它看起來像一句正常的訊息，不會有人回報。
 */
export const DEFAULT_LOCALE = 'zh-TW'

/**
 * 業務錯誤碼（§1.3）。格式 `<領域>.<原因>`，禁止編碼式命名（`E4012` 這種）。
 *
 * 這是**真正的聯集型別**而不是 `` `${string}.${string}` `` 樣板字面值：後者只擋得住「格式不對」，
 * 擋不住 `role.not-fond` 這種拼錯——那會一路過關到執行期，變成一句查不到訊息的錯誤。
 */
export type ErrorCode = keyof typeof ZH_TW_ERRORS

export type PlatformMessageKey = keyof typeof ZH_TW_PLATFORM

/** 訊息目錄的所有 key。業務錯誤碼與平台訊息共用同一個查詢入口。 */
export type MessageKey = ErrorCode | PlatformMessageKey

/**
 * 需要插值的訊息，各自宣告它吃哪些變數。**沒列在這裡的 key 一個變數都收不了。**
 *
 * 為什麼要有這一份宣告，而不是讓 `translate()` 收一包 `Record<string, unknown>`：
 * 那樣的話「少傳一個變數」與「變數名打錯」都只會讓使用者看到訊息裡留著一串 `{{assignedUserCount}}`
 * ——一個沒有任何錯誤、也沒有任何人會發現的結果（畫面照樣渲染，log 照樣乾淨）。
 * 宣告成型別之後，`DomainError` 就能在**建構那一筆錯誤的地方**要求把變數填齊（見 `service-result.ts`），
 * 那正是唯一知道數字從哪來的地方。
 *
 * ⚠️ 這份宣告與語系檔裡的 `{{...}}` 是兩份東西，型別擋不住「宣告了變數但句子裡沒用到」。
 * 反過來的那半——句子用了變數卻沒人傳——會在建構錯誤的地方被擋下，而那是會害到使用者的那一半。
 */
type MessageParamsMap = {
  readonly 'role.in-use': { readonly assignedUserCount: number }
}

/** 需要插值的訊息 key。 */
export type ParameterizedMessageKey = keyof MessageParamsMap

/**
 * 任何一則訊息可能帶的插值參數（聯集，不是 `Record<string, unknown>`）。
 *
 * 用在「只是把參數原樣搬運過去」的那幾層（`ErrorView`、envelope 前半段）：它們不知道也不該知道
 * 手上這一筆是哪一個 key，但仍然不該讓任何形狀的物件塞得進來。
 */
export type MessageParams = MessageParamsMap[ParameterizedMessageKey]

/**
 * 某個 key 對應的插值參數；該 key 不需插值時是 `never`（於是第三個引數傳什麼都不合法）。
 *
 * 以 `Extract` 而非條件型別的真分支索引，是為了讓 `TKey` 是**聯集**時也算得出來：
 * 出口層拿到的 `msg` 型別就是整個 {@link MessageKey} 聯集，那裡需要的答案是
 * 「這些 key 之中有人要參數嗎」，而不是逐個 key 各算一次。
 */
export type MessageParamsOf<TKey extends MessageKey> = MessageParamsMap[Extract<TKey, ParameterizedMessageKey>]

/** 完整目錄：預設語系必須每一則都有，缺一則就是編譯錯誤。 */
type MessageCatalog = Readonly<Record<MessageKey, string>>

/**
 * 非預設語系的目錄。
 *
 * **刻意允許不完整**：新語系是逐批翻譯進來的，要求「一次翻完才能上」的結果是永遠上不了。
 * 缺的那幾則由 i18next 依 `fallbackLng` 回落到預設語系，並由 {@link translate} 記一筆 log
 * ——回空字串或回 key 本身都不行，前者讓使用者看到一個沒有內容的錯誤，
 * 後者讓他看到一句沒人看得懂、也沒人會回報的假訊息。
 */
type PartialMessageCatalog = Readonly<Partial<Record<MessageKey, string>>>

const ZH_TW: MessageCatalog = { ...ZH_TW_ERRORS, ...ZH_TW_PLATFORM }

/**
 * 各語系的目錄。
 *
 * 新增語系時在這裡多一列（型別是 {@link PartialMessageCatalog}，可以只翻一部分），
 * 並在 {@link SUPPORTED_LOCALES} 加值——兩處都改到了，`Record<LocaleValue, ...>` 才會過。
 *
 * **這份物件同時是 i18next 的資源來源與「這一則在這個語系有沒有」的判斷依據**（見 {@link translate}）：
 * 只有一份資料，就不會有「餵給套件的目錄」與「我們以為的目錄」對不起來的可能。
 */
const CATALOGS: Readonly<Record<LocaleValue, PartialMessageCatalog>> = {
  'zh-TW': ZH_TW,
}

/** i18next 的預設命名空間名稱。本專案只有一個 namespace，key 自己已經帶著領域前綴（§1.3）。 */
const NAMESPACE = 'translation'

/**
 * 把 {@link CATALOGS} 轉成 i18next 要的資源形狀（多包一層 namespace）。
 *
 * **由 {@link CATALOGS} 推導而不是各寫一份。** 手寫一份餵給套件的話，新增語系時「目錄多了一列」
 * 與「套件那邊也多了一列」是兩件要分別記得的事，漏掉後者的症狀是那個語系整包回落成中文
 * ——而 {@link translate} 的缺翻譯 log 一行都不會印，因為在我們這邊它明明有翻。
 */
const toResources = (): Record<string, Record<string, PartialMessageCatalog>> =>
  Object.fromEntries(Object.entries(CATALOGS).map(([locale, catalog]) => [locale, { [NAMESPACE]: catalog }]))

/**
 * 本專案專用的 i18next 實例。
 *
 * **用 `createInstance()` 而不是那顆匯出的全域單例**：全域單例是整個 process 共用的，
 * 任何一個相依套件也 `init()` 一次就會把設定蓋掉（尤其是下面這幾個非預設值），
 * 而症狀是訊息突然全部查不到——沒有錯誤，只有空字串。
 */
const i18n = i18next.createInstance()

void i18n.init({
  lng: DEFAULT_LOCALE,
  // 缺翻譯時回落到預設語系。這是 {@link PartialMessageCatalog} 之所以能存在的前提。
  fallbackLng: DEFAULT_LOCALE,
  // 展開成可變陣列：i18next 的選項型別要的是 `string[]`，唯讀的 `as const` 陣列進不去。
  supportedLngs: [...SUPPORTED_LOCALES],
  resources: toResources(),

  // **必須關掉這兩個分隔符號。** i18next 預設把 `.` 當巢狀路徑、`:` 當 namespace 前綴，
  // 而我們的 key 本來就長成 `auth.invalid-credentials`——不關掉的話，它會去找一個
  // 名為 `auth` 的子物件底下的 `invalid-credentials`，然後找不到，然後回傳 key 本身。
  keySeparator: false,
  nsSeparator: false,

  // 輸出進的是 JSON 回應，不是 HTML。開著跳脫會把中文標點與引號變成 HTML entity，
  // 而前端拿到的是一句夾雜 `&#39;` 的訊息（§1.3：`msg` 是給人看的字串，不是 markup）。
  interpolation: { escapeValue: false },

  // 同步完成初始化。預設值會把資源載入推遲到下一個 tick（那是給非同步 backend 用的），
  // 而我們的資源是行內物件——推遲之後，啟動後最早的那幾次 {@link translate} 會查到空目錄，
  // 回一句 key 給使用者，而且只在冷啟動的頭幾毫秒發生，測不出來。
  initAsync: false,
})

/**
 * 把請求回聲來的 `locale` 收斂成支援的語系。
 *
 * @param requested 原始 request body 上的 `locale`；`null` 代表這次請求沒帶（例如錯誤發生在
 *   body 解析完成之前）。**這種情況不記 log**：它是預期中的，記了只會在每一支基礎設施端點
 *   與每一次 PARSE 失敗上多印一行噪音。
 */
export const resolveLocale = (requested: string | null): LocaleValue => {
  if (requested === null) return DEFAULT_LOCALE

  const supported = SUPPORTED_LOCALES.find((locale) => locale === requested)
  if (supported === undefined) {
    // 正常路徑上進不來：`locale` 有 schema 約束（§2 的 `Locale`），不支援的值在 body 驗證就被擋下。
    // 走得到這裡代表請求在驗證之前就失敗了，或者有人繞過前端直接打——兩種都值得留一筆。
    logger.warn(LogCategory.UnhandledException, '不支援的 locale，改用預設語系', {
      requested,
      fallback: DEFAULT_LOCALE,
    })
    return DEFAULT_LOCALE
  }
  return supported
}

/**
 * 取訊息。**唯一的呼叫者應該是出口層**（§1.8.2）：service、handler、邊界層一律只碰 key。
 *
 * @param key 訊息 key，業務錯誤碼也是一種 key（見檔頭）。**型別是我們自己的聯集**，不是 `string`。
 * @param locale 已收斂過的語系，見 {@link resolveLocale}。
 * @param params 該則訊息宣告的插值參數（見 `MessageParamsMap`）。不需插值的 key 這裡是 `never`，
 *   傳任何東西都不合法。
 */
export const translate = <TKey extends MessageKey>(
  key: TKey,
  locale: LocaleValue,
  params?: MessageParamsOf<TKey>,
): string => {
  if (CATALOGS[locale][key] === undefined) {
    // 這一則在該語系還沒翻，下面 i18next 會回落到預設語系。留下記錄是必要的——
    // 沒有這行 log 的話，「某幾則訊息永遠是中文」不會有任何人發現，因為畫面看起來是好的。
    logger.warn(LogCategory.UnhandledException, '訊息在該語系缺翻譯，回落預設語系', {
      key,
      locale,
      fallback: DEFAULT_LOCALE,
    })
  }

  // 插值變數走 `replace` 而不是攤平在 options 上：攤平的話，變數名一旦撞到 i18next 自己的
  // 選項名（`count`、`context`、`lng`…）就會被當成控制參數解讀，而那是靜靜換一則訊息出來。
  return i18n.t(key, { lng: locale, replace: params })
}
