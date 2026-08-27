/**
 * 路由 registry（前端規範 §0.1、§0.12）。
 *
 * **這是全站唯一可以 import `pages/` 的地方**（§0.11）。頁面之間互不 import，
 * 也沒有第三方能 import 頁面——所以「刪一個頁面目錄」永遠只影響那一頁。
 *
 * 蒐集方式是 glob 而不是一份手寫清單：手寫清單漏收一支新頁面時，
 * **沒有任何檢查會紅**，而它在使用者眼中就是「這個功能不存在」。
 */
import type { RouteRecordRaw } from 'vue-router'

/**
 * `eager: true` 的是 `.route.ts`（一支只有幾行的路由宣告），**不是** `.page.vue`。
 *
 * 頁面元件由各自的 `.route.ts` 以 `() => import('./<段1>-<段2>.page.vue')` 惰性載入（§0.12）。
 * 那條規則是本節最大的單一風險：改成靜態 import 之後，這個 eager glob 會把**全站每一支
 * `.page.vue` 拉進入口 chunk**，而型別對、測試綠、畫面一切正常——唯一的症狀是 bundle
 * 從幾百 KB 變成幾 MB，而那個數字沒有人在每次 PR 上看。
 */
const routeModules = import.meta.glob<{ readonly route: RouteRecordRaw }>(
  '../pages/*/*/*.route.ts',
  { eager: true },
)

export const routes: readonly RouteRecordRaw[] = Object.values(routeModules).map(
  (module) => module.route,
)

// 掃描器／registry 的自我檢查（通用規範 §7.2、前端規範 §0.12）。
// 蒐集結果為 0 時必須直接失敗：glob 命不中的時候不會有任何東西報錯，
// 應用程式只會安靜地變成一片空白，而「一條路由都沒有」與「glob 寫錯了」在畫面上長得一樣。
if (routes.length === 0) {
  throw new Error(
    'router/registry.ts 沒有蒐集到任何 *.route.ts。' +
      '檢查 pages/ 底下是否為固定兩層目錄，以及檔名是否為 <段1>-<段2>.route.ts（前端規範 §0.2、§0.3）。',
  )
}
