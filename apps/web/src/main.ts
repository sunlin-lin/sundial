/**
 * 應用程式啟動點。
 *
 * 這裡做三件事，順序有意義：建立 app 與 pinia → 掛上 router → 把統一 client 的全域處置
 * 接到 router 與 UI 上。第三件必須在 `mount()` 之前完成——第一支請求可能在頁面掛載後
 * 立刻送出，那時候處置還沒接上的話，一個 `900` 會安靜地什麼都不做，
 * 畫面停在原地而使用者不知道自己已經沒有身分了。
 */
import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { ElMessage, localeContextKey } from 'element-plus'
import type { Language } from 'element-plus/es/locale/index.mjs'
import zhTw from 'element-plus/es/locale/lang/zh-tw.mjs'

// Element Plus 的樣式在前，設計 token 在後：後面那份要能覆寫 Element Plus 的 CSS 變數
// （§5.3 允許的覆寫方式），順序反過來的話覆寫會被它自己的 `:root` 蓋掉。
import 'element-plus/dist/index.css'
import './shared/design/tokens.css'

import App from './App.vue'
import { router, LOGIN_ROUTE_NAME } from './router/router.ts'
import { setAuthRequiredHandler, setPermissionDeniedHandler, setSystemFailureHandler } from './shared/api/client.ts'
import { i18n, type TranslateMessage } from './shared/i18n/messages.ts'
import { useAuthStore } from './stores/auth.ts'

const app = createApp(App)
const pinia = createPinia()

/**
 * 元件之外要用的翻譯函式。
 *
 * 這裡沒有 `useI18n()` 可用（那支只能在 setup 期間呼叫），因此走全域 composer。
 * 型別標註的作用與元件內那一行完全相同：把 key 收窄回 `MessageKey`
 * （vue-i18n 自己的 `t` 收任意字串，理由見語系檔檔頭）。
 */
const translate: TranslateMessage = i18n.global.t

app.use(pinia)
app.use(i18n)
app.use(router)

/**
 * Element Plus **自己的**文案語系（分頁的「共 N 條」、表格的「暫無數據」、日期選擇器的月份與星期、
 * 彈窗的預設按鈕字）。
 *
 * 那些字串在套件內部，`shared/i18n/` 管不到它們——沒有設定 locale 時它們一律是英文，
 * 於是一個 zh-TW 的畫面上會夾雜英文字，而**沒有任何檢查會紅**
 *（§9.2 的「禁止裸中文字串」掃的是我們自己的原始碼，套件內部的英文不在定義域裡）。
 *
 * ## 為什麼是 `app.provide(localeContextKey, …)` 而不是 `<ElConfigProvider>` 或 `provideGlobalConfig`
 *
 * 三者最終做的是同一件事（`ElConfigProvider` 內部呼叫 `provideGlobalConfig`，
 * 後者再 provide 語系），但**前兩種在目前這組版本下型別對不起來**：
 * element-plus 2.14 的 `ConfigProviderProps` 是 `ExtractPropTypes<typeof configProviderProps>`，
 * 而在本專案的 vue-tsc 下它沒有被展開——`locale` 的型別停在 prop 描述物件
 *（`{ type: PropType<Language>; required: false; __epPropKey: true }`）而不是 `Language`，
 * 於是傳一份真的語系檔進去會編譯失敗。唯一能讓它過的辦法是 `as`，
 * 而那是 §3.2 明文禁止的——它不做任何執行期轉換，只是叫編譯器閉嘴。
 *
 * `localeContextKey` 的型別是乾淨的 `InjectionKey<Ref<Language | undefined>>`，
 * 而 EP 每一支元件取語系的路徑（`useLocale()`）就是 inject 它。因此這一行涵蓋了元件樹裡的全部
 * 元件（分頁、表格、日期選擇器…）。`ElMessage` 那種用函式呼叫、不在元件樹裡的東西取不到它，
 * 但它本身沒有任何內建文案——顯示的是我們傳進去的字串。
 *
 * 語系選 `zh-tw` 而不是 `zh-cn`：兩者的差別不只是簡繁（「確定/確認」、「暫無數據/暫無資料」），
 * 而介面語言是 zh-TW（§9.2）。
 */
app.provide(localeContextKey, ref<Language | undefined>(zhTw))

/**
 * `900`：沒有有效身分 → 清掉 store 並導向登入頁，帶著原本的網址。
 *
 * 這裡不重複清 access token——client 在呼叫這個處置之前已經清掉了。
 */
setAuthRequiredHandler(() => {
  const auth = useAuthStore(pinia)
  auth.reset()

  /**
   * **啟動時的身分探測收到 `900` 是預期結果，不是「操作到一半掉線」。**
   *
   * 那一次探測（`stores/auth.ts` 的 `restoreOnce`，由路由守衛在第一次導航時 await）本來就是在問
   * 「瀏覽器手上還有沒有可用的 refresh 票」，答案是「沒有」時，該做的事**守衛已經在做**——
   * 而且只有守衛知道使用者原本要去哪一頁。
   *
   * 這裡若也導一次，會同時得到兩個壞結果：
   *
   * - **雙重導向**：初始導航還在守衛裡等待，這一行的 `replace` 會把它中止，接著守衛回傳的
   *   導向再跑一次。使用者看得到畫面閃一下，而 vue-router 會記下一次 navigation aborted。
   * - **`redirect` 被污染**：初始導航尚未完成，`router.currentRoute` 還是 `START_LOCATION`，
   *   `fullPath` 是 `/`。於是使用者貼了 `/regulatory/datasets` 進來、登入完卻落在首頁——
   *   而回跳網址存在的唯一理由就是不要發生這件事。
   */
  if (auth.isRestoringIdentity) return

  const current = router.currentRoute.value
  // 已經在登入頁時不要把 `redirect` 指回登入頁自己，否則登入成功會原地不動。
  const query = current.name === LOGIN_ROUTE_NAME ? {} : { redirect: current.fullPath }
  void router.replace({ name: LOGIN_ROUTE_NAME, query })
})

/**
 * `901`：有身分但沒有權限 → **只提示，絕對不導登入頁**（§3.6）。
 *
 * 把 403 當 401 處理會讓使用者進入「登入 → 點到沒權限的功能 → 被踢回登入頁」的無限迴圈，
 * 而且他重登幾次就遇到幾次，看起來像整個系統壞掉。
 *
 * 顯示的是**後端回來的那句話**，不是前端自己的文案（見語系檔檔頭）：後端已經依 `locale` 翻好，
 * 前端再備一份只會多出一個會漂移的副本。`901` 的細節（是哪一個權限碼）後端一律不揭露，
 * 所以這句話本來就是一句一般化的訊息（後端規範 §3.1.1）。
 */
setPermissionDeniedHandler((message) => {
  ElMessage.error(message)
})

/**
 * `100`／`400`／回應不是 envelope：一律當系統錯誤。
 *
 * **細節不對使用者顯示**——`100` 代表呼叫端沒照契約送資料，那是我們的 bug，
 * 使用者對著一個他改不動的欄位反覆嘗試沒有任何幫助。
 *
 * TODO(接上錯誤回報服務時): 這裡目前只寫 console，應改為送進錯誤回報並附上後端的
 * `X-Trace-Id`（後端規範 §1.3）。`expForLog` 也是在這條路徑上使用——那是它唯一的用途。
 */
setSystemFailureHandler((failure) => {
  ElMessage.error(translate('error.system'))
  // 見上方 TODO：接上正式錯誤回報服務前的暫代做法，不是遺留的除錯輸出。
  // eslint-disable-next-line no-console
  console.error('[api] 系統錯誤', {
    diagnosticCode: failure.diagnosticCode,
    exp: failure.expForLog,
    message: failure.message,
  })
})

app.mount('#app')
