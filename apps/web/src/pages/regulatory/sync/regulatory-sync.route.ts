/**
 * 法規資料同步歷程的路由宣告（前端規範 §0.12）。
 *
 * `path` 必須以本檔所在的兩層目錄推導出的 `/regulatory/sync` 開頭（§0.2）——
 * 目錄的兩層語意就是 URL 路徑段，不是導覽分組；選單怎麼分組寫在 `menu/`，改選單不搬檔案。
 *
 * 沒有 `meta.isPublic`，因此守衛視它為需要登入。這一頁的內容雖然不分公司（計畫 §2.1），
 * 但**存取仍然要分**：權限碼掛在公司成員身上，「誰能看系統設定」是各公司自己決定的事，
 * 資料不敏感不等於入口要敞開。後端也把這支端點掛在已登入群組（見 handler 的
 * `requireAuthenticatedRequest`），前端這裡少寫一行不會讓資料外流，只會讓使用者
 * 先看到一個空畫面再被 `900` 導走。
 *
 * ⚠️ **這裡沒有宣告 `meta.permission`。** 計畫 §6 要求 `regulatory.sync.list` 這個權限碼
 * 由路由守衛判斷，但**目前沒有任何端點回得出「登入者有哪些權限碼」**（登入回應只有
 * user 與 company 兩節，見 `shared/api/sessions.ts` 的 `SignedInIdentity`）。
 * 在沒有來源的情況下寫一個守衛，只會得到兩種都更糟的結果：一律放行（一條永遠是綠的規則，
 * 通用規範 §7.1），或一律擋下（有權限的人也進不來）。因此這一輪由**後端**把關：
 * 無權限時端點回 `901`，頁面顯示「無權限」而不導登入頁（§3.6）。缺口記在回報裡。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/regulatory/sync',
  name: 'regulatory-sync',
  // 只能用動態 import，且字面量必須指向**同目錄**的 `.page.vue`（§0.12）：
  // 靜態 import 會讓 registry 的 eager glob 把全站頁面拉進入口 chunk，而沒有任何檢查會紅。
  component: () => import('./regulatory-sync.page.vue'),
}
