/**
 * 新增員工的路由宣告（前端規範 §0.12）。
 *
 * `path` 以本檔所在的兩層目錄推導出的 `/employees/onboarding` 開頭（§0.2）——目錄名刻意對齊後端
 * 模組 `modules/employees/onboarding/`，因為這一頁**只做一件事**：呼叫
 * `POST /employees/onboarding/create`（單一交易，一次建立員工、任職、部門、職稱、職務、扣繳、
 * 帳號與角色，UI 定案 `docs/ui/20-employee-list.md` §2）。
 *
 * **沒有獨立選單項**（見 `menu/main-menu.ts` 的註解）：入口只有員工清單頁的「新增員工」按鈕，
 * 但仍然掛 `meta.permission`——擋直接貼網址與過期的書籤，理由與其餘頁面相同。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/employees/onboarding',
  name: 'employees-onboarding',
  component: () => import('./employees-onboarding.page.vue'),
  meta: { permission: 'employees.onboarding.create' },
}
