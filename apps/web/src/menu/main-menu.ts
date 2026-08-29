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
 *
 * ## 過濾為什麼是這裡的一支純函式
 *
 * §4.3：使用者永遠不會有的權限 → **隱藏**，選單裡看不到那一項。但這個檔案不能自己去讀
 * 「目前是誰」——那需要 `stores/`，而選單資料只是資料。因此 {@link visibleMenuGroups} 把
 * 判斷函式收成參數：它是純函式，可以逐格測（§8.1），而「目前使用者有哪些權限碼」由 store 持有。
 *
 * 渲染側（`layouts/AppShell.vue`）同樣不碰 store：它收一個 `can` prop 再呼叫這一支。
 * 那個邊界是 `AppShell` 檔頭寫死的（它不呼叫 API、不碰 store），而過濾選單沒有理由打破它。
 */
import type { MessageKey } from '../shared/i18n/messages.ts'
import type { PermissionCode } from '../shared/permission/permission-code.ts'

export type MenuItem = {
  readonly labelKey: MessageKey
  readonly routeName: string
  /**
   * 看得到這一項所需的權限碼。
   *
   * **必須與該頁 `.route.ts` 的 `meta.permission` 是同一個值**：兩邊不一致的後果不對稱——
   * 選單這裡填錯會讓有權限的人看不到入口（功能等於不存在），路由那裡填錯才會擋錯人。
   * 沒有這個欄位＝登入了就看得到（例如首頁）。
   */
  readonly permissionCode?: PermissionCode
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
   * 法規目前只有這兩頁，還撐不起一個獨立分組，先掛在系統設定底下。
   *
   * 兩項各自帶著自己的權限碼（計畫 §6）：沒有 `regulatory.datasets.overview` 的人看不到總覽，
   * 沒有 `regulatory.sync.list` 的人看不到同步歷程，兩件事互不影響。
   * 這些值與各自 `.route.ts` 的 `meta.permission` 相同——選單負責藏入口，守衛負責擋直接貼網址。
   */
  {
    labelKey: 'menu.system-settings',
    items: [
      {
        labelKey: 'menu.regulatory-datasets',
        routeName: 'regulatory-datasets',
        permissionCode: 'regulatory.datasets.overview',
      },
      {
        labelKey: 'menu.regulatory-sync',
        routeName: 'regulatory-sync',
        permissionCode: 'regulatory.sync.list',
      },
    ],
  },
  /**
   * 人事作業。UI 定案（`docs/ui/22-ui-shift-settings.md`）明寫選單位置是「人事作業 → 班別設定」，
   * 這個分組先前不存在——**新增分組不搬動任何檔案**（§0.2 的整段理由），只在這裡多一筆。
   *
   * 班別只回答「一天怎麼上班」，與「誰上這個班」（排班）無關（計畫 04 §1），因此不掛在系統設定
   * 底下：系統設定是角色／權限／帳號／法規那一類平台管理事項，班別是人資日常會維護的業務資料。
   */
  {
    labelKey: 'menu.hr-operations',
    items: [
      {
        labelKey: 'menu.shifts-main',
        routeName: 'shifts-main',
        permissionCode: 'shifts.main.list',
      },
    ],
  },
]

/**
 * 這個使用者看得到的選單。
 *
 * @param can 有沒有某個權限碼。由呼叫端注入（實際來源是 `stores/auth.ts` 的 `can`）。
 *
 * **整組項目都被藏掉的分組，連分組標題一起不顯示。** 少了這一步，畫面上會出現一個標題底下
 * 一項都沒有的空分組——那看起來像載入失敗，而它其實是正常結果。
 */
export const visibleMenuGroups = (can: (code: PermissionCode) => boolean): readonly MenuGroup[] =>
  MAIN_MENU.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.permissionCode === undefined || can(item.permissionCode)),
  })).filter((group) => group.items.length > 0)
