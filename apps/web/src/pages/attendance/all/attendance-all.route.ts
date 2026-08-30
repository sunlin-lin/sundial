/**
 * 全體出勤的路由宣告（前端規範 §0.12）。
 *
 * 計畫 06 §5 Stage 7；畫面定案見 `docs/ui/09-ui-all-attendance.md`。
 *
 * `<段1>` 沿用既有的 `attendance`；`<段2>` 用 `all`——`pages/attendance/daily-records/
 * attendance-daily-records.route.ts` 的檔頭已經預告「09（全體出勤，之後會用 `attendance/all`
 * 之類的路徑）」，這裡照那個預告命名。與 `daily-records`（看的是原始打卡事實，一位員工一天可能
 * 多筆）刻意分開：本頁看的是 `attendance_results` 判定結果，一位員工一天一列。
 *
 * 只能用動態 import，字面量必須指向同目錄的 `.page.vue`（§0.12）。
 *
 * `meta.permission` 用 `attendance.results.list`——公司範圍的查詢動作，與
 * `menu/main-menu.ts` 對應項目的 `permissionCode` 必須是同一個值。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/attendance/all',
  name: 'attendance-all',
  component: () => import('./attendance-all.page.vue'),
  meta: { permission: 'attendance.results.list' },
}
