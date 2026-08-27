/**
 * Router 實體與登入守衛。
 *
 * 與 registry.ts 分開的理由：registry 的職責是「把檔案系統上的路由蒐集起來」，
 * 它的產出要能被獨立數（§0.12 的自我檢查要求 registry 的路由數與檔案系統掃到的
 * `.route.ts` 數相等，且兩個數字必須由兩種不同機制產生）。把守衛與根路徑轉址混進去，
 * 那個數字就不再等於「檔案系統上有幾支 `.route.ts`」，比對從此比不出東西。
 */
import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './registry.ts'
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
 * 未登入存取需登入的頁面 → 導向登入頁，並把原本要去的網址帶著。
 *
 * 帶回跳網址的理由很實際：使用者多半是從書籤或別人貼的連結進來的，
 * 少了它，他登入完會落在首頁，然後得自己再找一次剛剛那一頁。
 */
router.beforeEach((to) => {
  if (to.meta.isPublic === true) return true

  const auth = useAuthStore()
  if (auth.isSignedIn) return true

  return { name: LOGIN_ROUTE_NAME, query: { redirect: to.fullPath } }
})
