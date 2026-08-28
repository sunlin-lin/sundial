/**
 * 導覽選單（前端規範 §0.2）。
 *
 * **選單是一份資料結構，不是目錄結構。** 分組、排序、層級全部寫在這裡；
 * 選單改版只改這個檔案，**不得造成任何檔案搬動**。
 *
 * 理由是把「便宜且可變」的東西（導覽分組是 UX 產物，改版是常態）與「昂貴且難改」的東西
 *（目錄，搬動要連帶改 import、改檔名、動到 git 歷史）分開。兩者綁在一起的話，
 * 第一次導覽改版就會面臨二選一：搬目錄（連帶改 URL 與所有角色檔的檔名），
 * 或不搬（目錄從此與選單矛盾，而且矛盾只會愈積愈多）。
 *
 * 項目指向的是**路由名稱**而不是路徑，理由同 router.ts：交換字串，不建立 import 方向。
 */
import type { MessageKey } from '../shared/i18n/messages.ts'

export type MenuItem = {
  readonly labelKey: MessageKey
  readonly routeName: string
}

export type MenuGroup = {
  readonly labelKey: MessageKey
  readonly items: readonly MenuItem[]
}

export const MAIN_MENU: readonly MenuGroup[] = [
  {
    labelKey: 'menu.overview',
    items: [{ labelKey: 'menu.dashboard', routeName: 'dashboard-main' }],
  },
  /**
   * 系統設定。分組依資料字典 `docs/schema/05` 的分層（計畫 03 §6）：
   *「系統設定：角色、權限、帳號；法規設定：政府資料與公司投保設定」，兩者並列。
   * 法規目前只有這一頁，還撐不起一個獨立分組，先掛在系統設定底下。
   *
   * ⚠️ 這一項**目前對每個登入者都看得到**。計畫 §6 要求沒有 `regulatory.sync.list` 的人看不到它，
   * 但前端拿不到登入者的權限碼（沒有任何端點回得出來，見 `pages/regulatory/sync/*.route.ts`），
   * 因此這裡刻意**不加一個沒有人讀得懂的 `permissionCode` 欄位**——一個沒有消費者的欄位
   * 會讓人以為權限已經接上了，而它一行都沒被執行（通用規範 §7.1）。
   * 無權限的人點進去會看到後端回的「無權限」，不會被導去登入頁（§3.6）。
   */
  {
    labelKey: 'menu.system-settings',
    items: [{ labelKey: 'menu.regulatory-sync', routeName: 'regulatory-sync' }],
  },
]
