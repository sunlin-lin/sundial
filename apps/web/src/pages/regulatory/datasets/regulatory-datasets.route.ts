/**
 * 法規資料集總覽的路由宣告（前端規範 §0.12）。
 *
 * `path` 必須以本檔所在的兩層目錄推導出的 `/regulatory/datasets` 開頭（§0.2）——
 * 目錄的兩層語意就是 URL 路徑段，不是導覽分組；選單怎麼分組寫在 `menu/`，改選單不搬檔案。
 *
 * **三層內容全部在同一個 URL 上，不加參數段。** 展開哪一個資料集、看哪一版，都是頁面內的狀態。
 * §0.2 允許在兩段之後接參數段，而這一頁刻意不用：加上 `/:datasetCode/:versionCode` 之後，
 * 那兩段就變成必須被書籤、被分享、被重整還原的東西——而還原它們需要一個「這個版本代碼在
 * 目前基準日還存不存在」的判斷，那是一個為了網址而生的問題，不是使用者的問題。
 * 真的需要分享某一版時，要分享的其實是「資料集 ＋ 基準日」，那一天再加 query 即可。
 *
 * 沒有 `meta.isPublic`，因此守衛視它為需要登入。內容不分公司（計畫 §2.1），
 * 但**存取仍然要分**：權限碼掛在公司成員身上，「誰能看系統設定」是各公司自己決定的事。
 *
 * 前後端是兩道各自獨立的關（§4.2）：`meta.permission` 擋的是「點進來看到一個空畫面」的體驗問題，
 * 真正的授權在後端每一支端點上（無權限回 `901`），前端 bundle 是公開的，這裡改不動任何事。
 */
import type { RouteRecordRaw } from 'vue-router'

export const route: RouteRecordRaw = {
  path: '/regulatory/datasets',
  name: 'regulatory-datasets',
  // 只能用動態 import，且字面量必須指向**同目錄**的 `.page.vue`（§0.12）：
  // 靜態 import 會讓 registry 的 eager glob 把全站頁面拉進入口 chunk，而沒有任何檢查會紅。
  component: () => import('./regulatory-datasets.page.vue'),
  // 與 `menu/main-menu.ts` 裡那一項的 `permissionCode` 必須是同一個值：
  // 選單負責藏入口，這裡負責擋直接貼網址與過期的書籤。
  //
  // 這一頁會打三支端點（`overview` / `list` / `resolve`），而守衛只認一個權限碼——
  // 選 `overview` 是因為它是**進頁面就會打**的那一支：沒有它，這一頁從第一秒就是一片錯誤，
  // 另外兩支則要使用者主動展開才會用到（缺那兩個權限碼時，後端回 `901`、該區塊顯示無權限，
  // 而總覽仍然看得到——那是正確的降級，不該由守衛整頁擋掉）。
  meta: { permission: 'regulatory.datasets.overview' },
}
