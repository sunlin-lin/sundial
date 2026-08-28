/**
 * 法規資料同步歷程的路由宣告（前端規範 §0.12）。
 *
 * `path` 必須以本檔所在的兩層目錄推導出的 `/regulatory/sync` 開頭（§0.2）——
 * 目錄的兩層語意就是 URL 路徑段，不是導覽分組；選單怎麼分組寫在 `menu/`，改選單不搬檔案。
 *
 * 沒有 `meta.isPublic`，因此守衛視它為需要登入。這一頁的內容雖然不分公司（計畫 §2.1），
 * 但**存取仍然要分**：權限碼掛在公司成員身上，「誰能看系統設定」是各公司自己決定的事，
 * 資料不敏感不等於入口要敞開。
 *
 * ## `meta.permission` 現在有來源了
 *
 * 這裡以前沒有宣告權限碼，理由是「沒有任何端點回得出登入者有哪些權限碼」——在沒有來源的情況下
 * 寫守衛只會得到兩種都更糟的結果：一律放行（一條永遠是綠的規則），或一律擋下（有權限的人也進不來）。
 *
 * `POST /sessions/main/context` 補上了那個來源：它回這個成員在這家公司**實際擁有**的權限碼，
 * 而 `stores/auth.ts` 在登入時與重整後各取一次。於是計畫 §6 要求的那一件事現在做得到了——
 * 前端**真的判斷**，而不是「後端擋、前端裝作看不見」。
 *
 * 前後端仍然是兩道各自獨立的關（§4.2）：這一行擋的是「點進來看到一個空畫面」的體驗問題，
 * 真正的授權在後端每一支端點上（無權限回 `901`），前端 bundle 是公開的，這裡改不動任何事。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/regulatory/sync',
  name: 'regulatory-sync',
  // 只能用動態 import，且字面量必須指向**同目錄**的 `.page.vue`（§0.12）：
  // 靜態 import 會讓 registry 的 eager glob 把全站頁面拉進入口 chunk，而沒有任何檢查會紅。
  component: () => import('./regulatory-sync.page.vue'),
  // 與 `menu/main-menu.ts` 裡那一項的 `permissionCode` 必須是同一個值：
  // 選單負責藏入口，這裡負責擋直接貼網址與過期的書籤。
  meta: { permission: 'regulatory.sync.list' },
}
