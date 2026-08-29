/**
 * 班別設定的路由宣告（前端規範 §0.12）。
 *
 * `path` 必須以本檔所在的兩層目錄推導出的 `/shifts/main` 開頭（§0.2）——`<段1>` 與 `<段2>` 同名時
 * 第二層固定寫 `main`，理由與後端 `modules/shifts/main/` 相同：這個子實體就是這個領域本身。
 *
 * 沒有 `meta.isPublic`，因此守衛視它為需要登入；`meta.permission` 對到 `shifts.main.list`
 * ——與 `menu/main-menu.ts` 裡「班別設定」那一項的 `permissionCode` 必須是同一個值：
 * 選單負責藏入口，這裡負責擋直接貼網址與過期的書籤。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/shifts/main',
  name: 'shifts-main',
  // 只能用動態 import，且字面量必須指向**同目錄**的 `.page.vue`（§0.12）：靜態 import 會讓
  // registry 的 eager glob 把全站頁面拉進入口 chunk，而沒有任何檢查會紅。
  component: () => import('./shifts-main.page.vue'),
  meta: { permission: 'shifts.main.list' },
}
