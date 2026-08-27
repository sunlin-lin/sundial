/**
 * 應用程式啟動點。
 *
 * 這裡做三件事，順序有意義：建立 app 與 pinia → 掛上 router → 把統一 client 的全域處置
 * 接到 router 與 UI 上。第三件必須在 `mount()` 之前完成——第一支請求可能在頁面掛載後
 * 立刻送出，那時候處置還沒接上的話，一個 `900` 會安靜地什麼都不做，
 * 畫面停在原地而使用者不知道自己已經沒有身分了。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElMessage } from 'element-plus'

// Element Plus 的樣式在前，設計 token 在後：後面那份要能覆寫 Element Plus 的 CSS 變數
// （§5.3 允許的覆寫方式），順序反過來的話覆寫會被它自己的 `:root` 蓋掉。
import 'element-plus/dist/index.css'
import './shared/design/tokens.css'

import App from './App.vue'
import { router, LOGIN_ROUTE_NAME } from './router/router.ts'
import {
  setAuthRequiredHandler,
  setPermissionDeniedHandler,
  setSystemFailureHandler,
} from './shared/api/client.ts'
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
 * `900`：沒有有效身分 → 清掉 store 並導向登入頁，帶著原本的網址。
 *
 * 這裡不重複清 access token——client 在呼叫這個處置之前已經清掉了。
 */
setAuthRequiredHandler(() => {
  useAuthStore(pinia).reset()

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
  console.error('[api] 系統錯誤', {
    diagnosticCode: failure.diagnosticCode,
    exp: failure.expForLog,
    message: failure.message,
  })
})

app.mount('#app')
