/**
 * 我的出勤的路由宣告（前端規範 §0.12）。
 *
 * 計畫 06 §5 Stage 7；畫面定案見 `docs/ui/12-ui-my-attendance.md`。
 *
 * `<段1>` 沿用既有的 `attendance`；`<段2>` 用 `mine`——範圍固定為呼叫者本人（`attendance/results/
 * list-own`，不接受 `employeeId`），與全體出勤（`attendance/all`，公司範圍）用不同路徑段區分，
 * 理由與那一頁的 `.route.ts` 檔頭相同：兩頁資料範圍、權限模型都不同，路徑不合併不是巧合。
 *
 * 只能用動態 import，字面量必須指向同目錄的 `.page.vue`（§0.12）。
 *
 * `meta.permission` 用 `attendance.results.list-own`——本人範圍的查詢動作，每一位員工都會有
 * 這個權限碼（`0043_seed_permission_codes_attendance_results_list.sql` 檔頭），與
 * `menu/main-menu.ts` 對應項目的 `permissionCode` 必須是同一個值。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/attendance/mine',
  name: 'attendance-mine',
  component: () => import('./attendance-mine.page.vue'),
  meta: { permission: 'attendance.results.list-own' },
}
