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
      /**
       * 員工清單（計畫 05 Stage 6 第一段，UI 定案 `docs/ui/20-employee-list.md` §1）。
       * 新增員工頁（`employees/onboarding`）刻意不在選單上：它只透過清單頁的「新增員工」按鈕進入，
       * 沒有獨立入口——理由與 `regulatory/datasets` 的版本內容頁相同（不是每一個路由都要有選單項）。
       */
      {
        labelKey: 'menu.employees-main',
        routeName: 'employees-main',
        permissionCode: 'employees.main.list',
      },
      /**
       * 每日全員打卡明細（計畫 06 §4.7、Stage 6，UI 定案
       * `docs/ui/23-ui-daily-attendance-records.md`）。
       *
       * `permissionCode` 用 `attendance.records.list-by-date`，與同目錄 `.route.ts` 的
       * `meta.permission` 同一個值——這裡的檔頭與該檔一致地記著：UI 定案文字裡舉例的
       * `attendance.records.view-all` 不對應任何端點，加進 `permission-code.ts` 的清單會被
       * `satisfies readonly ApiCommand[]` 擋下來編譯不過，`list-by-date` 才是這一頁真正會呼叫
       * 的查詢動作。
       */
      {
        labelKey: 'menu.attendance-daily-records',
        routeName: 'attendance-daily-records',
        permissionCode: 'attendance.records.list-by-date',
      },
      /**
       * 全體出勤（計畫 06 §5 Stage 7，UI 定案 `docs/ui/09-ui-all-attendance.md` §「導覽結構」：
       * 「人事作業 → 全體出勤」）。`permissionCode` 用 `attendance.results.list`——公司範圍的
       * 查詢動作，與同目錄 `.route.ts` 的 `meta.permission` 同一個值。
       */
      {
        labelKey: 'menu.attendance-all',
        routeName: 'attendance-all',
        permissionCode: 'attendance.results.list',
      },
    ],
  },
  /**
   * 我的資料（計畫 06 §5 Stage 7，UI 定案 `docs/ui/12-ui-my-attendance.md` §「導覽結構」：
   * 「我的資料 → 個資／出勤紀錄」）。這個分組先前不存在——**新增分組不搬動任何檔案**
   * （§0.2 的整段理由），只在這裡多一筆。
   *
   * **只有「出勤紀錄」一項**：UI 12 的導覽結構同時列了「個資」，但那一頁不在本輪（計畫 06 Stage 7
   * 的交付範圍是全體出勤／我的出勤兩頁）實作範圍內，因此這裡不虛列一個沒有對應路由的選單項——
   * 等「個資」頁真的做出來，再補這一筆，不預先佔位（同 §1.5「先放共用區以備不時之需」的相同理由：
   * 沒有對應路由的選單項一旦點下去無處可去，比少一個入口更糟）。
   */
  {
    labelKey: 'menu.my-data',
    items: [
      {
        labelKey: 'menu.attendance-mine',
        routeName: 'attendance-mine',
        permissionCode: 'attendance.results.list-own',
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
