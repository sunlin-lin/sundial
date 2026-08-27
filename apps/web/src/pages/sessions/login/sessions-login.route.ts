/**
 * 登入頁的路由宣告（前端規範 §0.12）。
 *
 * `path` 必須以本檔所在的兩層目錄推導出的 `/sessions/login` 開頭（§0.2）——
 * 目錄的兩層語意就是 URL 路徑段，不是導覽分組。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/sessions/login',
  name: 'sessions-login',
  // 公開路由：使用者到得了這一頁的時候，本來就還沒有身分。
  // 守衛的預設是「需要登入」，所以公開必須明寫（見 router/route-meta.ts）。
  meta: { isPublic: true },
  // 只能用動態 import，且字面量必須指向**同目錄**的 `.page.vue`（§0.12）。
  // 靜態 import 會讓 registry 的 eager glob 把全站頁面拉進入口 chunk，而沒有任何檢查會紅；
  // 路徑寫成 `../` 指到別頁則會讓兩條路由指向同一支頁面——兩頁都「有路由」、可達性掃描也是綠的，
  // 但其中一頁的使用者永遠打不開（他點了選單、網址變了、畫面卻是另一頁）。
  component: () => import('./sessions-login.page.vue'),
}
