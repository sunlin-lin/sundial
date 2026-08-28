/**
 * Router 實體與導航守衛。
 *
 * 與 registry.ts 分開的理由：registry 的職責是「把檔案系統上的路由蒐集起來」，
 * 它的產出要能被獨立數（§0.12 的自我檢查要求 registry 的路由數與檔案系統掃到的
 * `.route.ts` 數相等，且兩個數字必須由兩種不同機制產生）。把守衛與根路徑轉址混進去，
 * 那個數字就不再等於「檔案系統上有幾支 `.route.ts`」，比對從此比不出東西。
 */
import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { routes } from './registry.ts'
import { i18n, type TranslateMessage } from '../shared/i18n/messages.ts'
import { useAuthStore } from '../stores/auth.ts'

/**
 * 路由**名稱**是頁面之間唯一的相互指涉方式。
 *
 * 為什麼不用路徑常數：常數要放在某個共用檔，而頁面 import 那個共用檔、router 也 import 它，
 * 看起來沒問題——但頁面若直接 import router 就會形成 `router → registry → page → router`
 * 的循環相依（§0.11 全樹禁止）。循環相依在 Vite 底下大多不報錯，症狀是「某個模組在初始化時
 * 是 undefined」，只在特定進入順序下發作：直接開某一頁會壞、從別頁導過去就正常。
 * 用名稱的話，頁面之間只交換字串，沒有任何 import 方向被建立。
 */
export const LOGIN_ROUTE_NAME = 'sessions-login'
export const HOME_ROUTE_NAME = 'dashboard-main'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // 根路徑不是一個頁面，所以它不在 pages/ 底下、也沒有 `.route.ts`（§0.4 的白名單）。
    { path: '/', redirect: { name: HOME_ROUTE_NAME } },
    ...routes,
  ],
})

/**
 * 元件之外要用的翻譯函式（§9.2 禁止寫死中文，`.vue` 以外同樣適用）。
 *
 * 這裡沒有 `useI18n()` 可用（那支只能在 setup 期間呼叫），因此走全域 composer；
 * 型別標註的作用與元件內那一行相同：把 key 收窄回 `MessageKey`。
 */
const translate: TranslateMessage = i18n.global.t

/**
 * 每一次導航都要回答的三個問題，順序固定：**這一頁公開嗎 → 有身分嗎 → 有權限嗎。**
 *
 * ## 為什麼守衛是 async
 *
 * access token 只存在記憶體，重整之後 store 是空的。守衛若同步判斷 `auth.isSignedIn`，
 * 它會在任何一支 API 有機會完成之前就把人導去登入頁——症狀是「按 F5 就掉線」，
 * 而使用者手上明明還有一張有效的 refresh 票。
 *
 * 因此第一次導航先 await 一次身分探測（`restoreOnce` 內部 memoized，第二次之後是同一個已完成的
 * promise，不會多打任何請求，也不會多等一個 tick 以上）。探測失敗時它**安靜地**回來，
 * 下面的既有邏輯照常判定「沒有身分」。
 *
 * ## 為什麼探測失敗不會造成雙重導向
 *
 * 探測那一支請求收到 `900` 時，統一 client 會呼叫全域的 `authRequiredHandler`，而那個處置本身
 * 也會導向登入頁。兩邊同時導的話會發生兩件事：同一個 tick 內兩次導航（其中一次被中止），
 * 以及 `redirect` 參數指向**啟動當下的位置**（初始導航還沒完成，`router.currentRoute` 是
 * `START_LOCATION`，`fullPath` 是 `/`）而不是使用者真正要去的網址。
 * 處理方式寫在 `main.ts`：探測期間的 `900` 由這裡負責導向，全域處置退開。
 */
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.restoreOnce()

  if (to.meta.isPublic === true) return true

  // 帶回跳網址的理由很實際：使用者多半是從書籤或別人貼的連結進來的，
  // 少了它，他登入完會落在首頁，然後得自己再找一次剛剛那一頁。
  if (!auth.isSignedIn) return { name: LOGIN_ROUTE_NAME, query: { redirect: to.fullPath } }

  const required = to.meta.permission
  if (required !== undefined && !auth.can(required)) {
    // §4.3：「使用者永遠不會有此權限」→ **隱藏 ＋ 導向**，不是停用、更不是讓他進去看一個空畫面。
    // 選單那一側已經把入口藏起來（`menu/main-menu.ts`），走到這裡的只剩直接貼網址與過期的書籤，
    // 所以必須說一句話——靜靜地把人送回首頁，他會以為是自己點錯了，然後再點一次。
    //
    // 導向的是首頁而不是一支 403 頁：那支頁面不會出現在任何選單、不會被任何一頁連過去，
    // 唯一的入口是這一行，也就是 §8.2 的路由可達性掃描會判定為孤兒的形狀。
    // 一句訊息 ＋ 回首頁能回答的問題（「我沒有這個權限」）與一整頁一樣多。
    ElMessage.error(translate('error.no-permission'))
    return { name: HOME_ROUTE_NAME }
  }

  return true
})
