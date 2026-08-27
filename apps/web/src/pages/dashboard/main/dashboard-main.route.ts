/**
 * Dashboard 的路由宣告（前端規範 §0.12）。
 *
 * 第二層寫 `main`：`dashboard` 這個 `<段1>` 目前只有一個子頁面，但 `pages/` 一律兩層、零例外
 *（§0.2），同名時第二層固定寫 `main`（比照後端規範 §0.2，兩邊同一條規則同一種寫法）。
 *
 * 沒有 `meta.isPublic`，因此守衛視它為需要登入——預設是「要登入」，公開才要明寫。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/dashboard/main',
  name: 'dashboard-main',
  component: () => import('./dashboard-main.page.vue'),
}
