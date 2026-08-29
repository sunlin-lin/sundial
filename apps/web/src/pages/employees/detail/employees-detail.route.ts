/**
 * 修改員工頁的路由宣告（前端規範 §0.12）。
 *
 * `path` 以本檔所在的兩層目錄推導出的 `/employees/detail` 開頭（§0.2），後面接一個路由參數段
 * `:id`——規範 §0.2 明文允許 `.route.ts` 的 `path` 在兩層之後接參數段（瀏覽器網址必須能被書籤與
 * 分享，這跟後端 API 路徑不帶參數是兩回事），對應 UI 定案 `docs/ui/20-employee-list.md` §3
 * 「修改員工」（計畫 05 Stage 6 第二段）。
 *
 * **沒有獨立選單項**：入口只有員工清單頁「操作」欄的連結，理由與 `employees/onboarding` 相同
 * （不是每一個路由都要有選單項）。
 *
 * `meta.permission` 對到 `employees.main.get`——查看這一頁的明細至少要有查詢單一員工的權限；
 * 頁面內每個分頁各自的動作（改基本資料、辦理離職……）再各自檢查各自的權限碼。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/employees/detail/:id',
  name: 'employees-detail',
  component: () => import('./employees-detail.page.vue'),
  meta: { permission: 'employees.main.get' },
}
