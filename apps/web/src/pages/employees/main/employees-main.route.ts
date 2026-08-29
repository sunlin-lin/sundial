/**
 * 員工清單的路由宣告（前端規範 §0.12）。
 *
 * `path` 以本檔所在的兩層目錄推導出的 `/employees/main` 開頭（§0.2）——`<段1>` 與 `<段2>` 同名時
 * 第二層固定寫 `main`，理由與 `shifts/main` 相同：這個子實體就是這個領域本身
 * （對應後端 `modules/employees/main/`，UI 定案 `docs/ui/20-employee-list.md` §1）。
 *
 * `meta.permission` 對到 `employees.main.list`——與 `menu/main-menu.ts` 裡「員工清單」那一項的
 * `permissionCode` 必須是同一個值：選單負責藏入口，這裡負責擋直接貼網址與過期的書籤。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/employees/main',
  name: 'employees-main',
  // 只能用動態 import，且字面量必須指向**同目錄**的 `.page.vue`（§0.12）。
  component: () => import('./employees-main.page.vue'),
  meta: { permission: 'employees.main.list' },
}
