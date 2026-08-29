/**
 * 每日全員打卡明細的路由宣告（前端規範 §0.12）。
 *
 * 計畫 06 §4.7、Stage 6；畫面定案見 `docs/ui/23-ui-daily-attendance-records.md`。
 *
 * `<段1>` 用 `attendance`：這是本站第一支掛在這個路徑段下的頁面（Dashboard 的打卡在
 * `pages/dashboard/main/`，那裡是「登入後的首頁」這個身分，不是「出勤模組」這個身分）；
 * `<段2>` 用 `daily-records`，對應 UI 定案文件名稱「每日全員打卡明細」，與 09（全體出勤，
 * 之後會用 `attendance/all` 之類的路徑）刻意分開——兩頁資料來源、粒度、操作性質都不同
 * （UI 23「與『全體出勤』的分工」一節），路徑不合併不是巧合。
 *
 * 只能用動態 import，字面量必須指向同目錄的 `.page.vue`（§0.12）。
 *
 * `meta.permission` 用 `attendance.records.list-by-date`，**不是** UI 定案文字裡舉例的
 * `attendance.records.view-all`——理由與 `menu/main-menu.ts` 那一項的檔頭註解相同：`view-all`
 * 是計畫 §4.2 定案的細粒度旗標，不對應任何端點（`0039_seed_permission_codes_attendance_
 * records.sql` 檔頭明講），加進 `shared/permission/permission-code.ts` 的清單會被
 * `satisfies readonly ApiCommand[]` 擋下來編譯不過；`list-by-date` 才是這一頁進來就會呼叫、
 * 也真正是端點權限碼的那一支，計畫 §4.7 本身也只把 `view-all` 當作「例如」，明講這是可以視
 * 情況調整的實作細節。與 `menu/main-menu.ts` 對應項目的 `permissionCode` 必須是同一個值。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/attendance/daily-records',
  name: 'attendance-daily-records',
  component: () => import('./attendance-daily-records.page.vue'),
  meta: { permission: 'attendance.records.list-by-date' },
}
