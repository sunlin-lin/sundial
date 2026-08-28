/**
 * 語系檔：zh-TW（前端規範 §9.2）。
 *
 * **本檔只有「字」，沒有任何邏輯。** vue-i18n 怎麼掛、key 的型別怎麼收斂、界線在哪裡，
 * 全部在 `../messages.ts`——一支語系檔要能被翻譯的人單獨打開來改，而不必先讀懂前面那一頁。
 * 新增語系＝在 `locales/` 多一個檔案，本檔一行都不用動。
 *
 * ---
 *
 * **本檔只放前端自己的介面文字：標題、欄位標籤、按鈕、以及前端自己決定要說的話。**
 *
 * **來自後端的訊息由後端翻譯，前端不再為它們準備第二份文案。** 後端有自己的訊息目錄
 * （`apps/api/src/shared/i18n/`），出口層依 request 的 `locale` 把 `msg` 與 `errors[].msg`
 * 翻好才送出來；業務錯誤（`code='300'`）與無權限（`901`）一律**直接顯示後端回來的那句話**。
 *
 * 為什麼這條界線要寫出來：同一件事準備兩套說法，兩套就會漂移，而漂移不會有任何錯誤——
 * 只會變成「後端的錯誤碼註解上寫著一句話、使用者看到的是另一句」。更實際的例子是登入失敗：
 * 那句話刻意含糊是**後端的規格**（後端規範 §3.2：分辨「帳號不存在」與「密碼錯誤」等於把登入頁
 * 變成帳號列舉工具）。前端自己留一份文案的話，那份副本不受那條規格約束，
 * 下一個人「順手」把它寫精確一點時，沒有任何一個檢查會擋。
 *
 * 唯一的例外是系統錯誤（`error.system`）：`100`／`400`／回應根本不是 envelope 這三種情況，
 * 前端**刻意不顯示後端細節**（§3.6），連後端有沒有回訊息都不一定（網路斷線時沒有回應可言），
 * 所以那句話本來就是前端自己要說的。
 *
 * ---
 *
 * **key 一律扁平（`login.field.company-code` 是一個完整的 key，不是三層巢狀）。** 巢狀寫法
 * 在檔案上看起來整齊，代價是全文檢索一個畫面上的 key 會找不到——而「這句話是從哪裡來的」
 * 正是讀這份檔案最常見的理由。解析扁平 key 的設定在 `../messages.ts`。
 */
export const ZH_TW = {
  'app.name': 'Sundial',

  'login.heading': '登入',
  'login.subheading': '請輸入公司代號與帳號密碼',
  'login.field.company-code': '公司代號',
  'login.field.username': '帳號',
  'login.field.password': '密碼',
  'login.submit': '登入',

  'dashboard.heading': '總覽',
  'dashboard.signed-in-as': '登入者',
  'dashboard.company': '所屬公司',
  'dashboard.sign-out': '登出',

  'menu.overview': '總覽',
  'menu.dashboard': '首頁',
  'menu.system-settings': '系統設定',
  'menu.regulatory-sync': '法規資料同步歷程',

  'regulatory-sync.heading': '法規資料同步歷程',
  'regulatory-sync.description':
    '每一次自動同步的結果。政府法規全國一份，這一頁不分公司，所有公司看到的是同一份紀錄。',
  'regulatory-sync.filter.dataset': '資料集',
  'regulatory-sync.column.dataset': '資料集',
  'regulatory-sync.column.started-at': '開始時間',
  'regulatory-sync.column.finished-at': '結束時間',
  'regulatory-sync.column.status': '狀態',
  'regulatory-sync.column.records-received': '收到筆數',
  'regulatory-sync.column.error-message': '失敗原因',

  /** 四種狀態，值取自後端的 `RegulatorySyncStatus`（1/2/3/4）。 */
  'regulatory-sync.status.running': '執行中',
  'regulatory-sync.status.succeeded': '更新成功',
  'regulatory-sync.status.failed': '失敗',
  'regulatory-sync.status.no-change': '無異動',

  /**
   * 空結果。**這一頁的篩選條件不能清除**（後端的 `datasetCode` 是必填，一次只查一個資料集），
   * 所以 §7.2 的「提示可清除篩選」在這裡的對應動作是「換一個資料集」——旁邊那個下拉就是。
   * 空白畫面在 HR 系統特別危險：該處理的清單顯示空白，使用者就真的不去處理了。
   */
  'regulatory-sync.empty': '這個資料集還沒有同步紀錄。可以在上方換一個資料集看看。',
  'regulatory-sync.retry': '重新載入',

  /**
   * 資料集名稱。**必須與後端 `REGULATORY_DATASETS` 的 `name` 逐字相同**——那一份與計畫 §3.1
   * 的表格由 `bun run check:dataset-code` 互相比對，但**這一份不在它的守備範圍內**
   * （理由與代價完整寫在 `pages/regulatory/sync/regulatory-sync.dataset.view.ts` 檔頭）。
   * `7` 是永久空號，不是漏打。
   */
  'regulatory-sync.dataset.1': '勞工保險投保薪資分級表',
  'regulatory-sync.dataset.2': '全民健康保險投保金額分級表',
  'regulatory-sync.dataset.3': '勞工退休金月提繳工資分級表',
  'regulatory-sync.dataset.4': '勞就保保險費分擔金額表',
  'regulatory-sync.dataset.5': '健保費負擔金額表（有一定雇主之受僱者）',
  'regulatory-sync.dataset.6': '職業災害保險行業別費率',
  'regulatory-sync.dataset.8': '最低工資（月薪與時薪）',
  'regulatory-sync.dataset.9': '薪資所得扣繳稅額表',
  'regulatory-sync.dataset.10': '健保補充保險費（費率與計費門檻）',

  /** 前端自己要說的話，見檔頭的「唯一的例外」。 */
  'error.system': '系統發生錯誤，請稍後再試。',
} as const
