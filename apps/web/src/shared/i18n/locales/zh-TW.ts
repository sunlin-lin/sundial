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
  'menu.regulatory-datasets': '法規資料集',
  'menu.regulatory-sync': '法規資料同步歷程',

  /**
   * 四種同步狀態，值取自後端的 `RegulatorySyncStatus`（1/2/3/4）。
   *
   * key 的前綴是 `regulatory.` 而不是某一頁的前綴：兩個頁面共用同一組呈現
   *（`shared/regulatory/sync-status.ts`），掛在其中一頁的命名空間下會讓另一頁看起來像在借用。
   */
  'regulatory.sync-status.running': '執行中',
  'regulatory.sync-status.succeeded': '更新成功',
  'regulatory.sync-status.failed': '失敗',
  'regulatory.sync-status.no-change': '無異動',

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

  /**
   * 空結果。**這一頁的篩選條件不能清除**（後端的 `datasetCode` 是必填，一次只查一個資料集），
   * 所以 §7.2 的「提示可清除篩選」在這裡的對應動作是「換一個資料集」——旁邊那個下拉就是。
   * 空白畫面在 HR 系統特別危險：該處理的清單顯示空白，使用者就真的不去處理了。
   */
  'regulatory-sync.empty': '這個資料集還沒有同步紀錄。可以在上方換一個資料集看看。',
  'regulatory-sync.retry': '重新載入',

  // ⚠️ 這裡以前有九筆 `regulatory-sync.dataset.<代碼>`（資料集名稱）。**已經整批刪掉**：
  // 那是「代碼 ↔ 名稱」的第三份副本，而且不在 `bun run check:dataset-code` 的守備範圍內
  // ——對調兩個名稱不會有任何地方變紅，使用者會看到一個標著「勞保」的健保同步歷程。
  // 名稱現在一律來自 `regulatory.datasets.overview` 回應的 `name`。
  // 新的資料集名稱**不得**再寫回這個檔案。

  'regulatory-datasets.heading': '法規資料集',
  'regulatory-datasets.description':
    '每一份政府法規資料目前是哪一版、最後同步是什麼時候。政府法規全國一份，這一頁不分公司，所有公司看到的是同一份資料。',
  'regulatory-datasets.retry': '重新載入',
  'regulatory-datasets.empty': '目前沒有任何法規資料集。',

  /**
   * 基準日。**這一頁最重要的一個控制項**（計畫 §4.2）：補算去年 12 月的薪資時，
   * 要核對的是「當時的費率」，而不是今天適用的那一版。提示文字要說出這件事，
   * 否則使用者只會把它當成一個可以忽略的預設值。
   */
  'regulatory-datasets.filter.as-of-date': '法規適用基準日',
  'regulatory-datasets.filter.as-of-date-hint': '要核對過去某個期間的法規時，把日期改成那一天。',

  'regulatory-datasets.column.dataset': '資料集',
  'regulatory-datasets.column.maintenance': '維護方式',
  'regulatory-datasets.column.effective-version': '適用版本',
  'regulatory-datasets.column.effective-from': '生效日',
  'regulatory-datasets.column.effective-to': '失效日',
  'regulatory-datasets.column.record-count': '筆數',
  'regulatory-datasets.column.last-sync': '最後同步',
  'regulatory-datasets.column.version-code': '版本代碼',
  'regulatory-datasets.column.synced-at': '同步時間',
  'regulatory-datasets.column.effective-now': '基準日適用',
  'regulatory-datasets.column.actions': '操作',

  /** 值取自後端的 `maintenance`（`'sync'` / `'manual'`），不是 `'auto'`。 */
  'regulatory-datasets.maintenance.sync': '自動同步',
  'regulatory-datasets.maintenance.manual': '人工維護',

  /** 這一天沒有任何一版適用。**是一個結果，不是缺資料**，所以有自己的一句話而不是「—」。 */
  'regulatory-datasets.no-effective-version': '無適用版本',

  /**
   * 「最後同步」的兩種非時間狀態。**兩者不得顯示成同一個東西**（計畫 §4.1）：
   * 「不適用」是規格（人工維護的資料集永遠不會有同步紀錄），「從未同步」是還沒發生過。
   * 空白會被讀成「同步壞了」，所以兩者都必須是明確的文字。
   */
  'regulatory-datasets.last-sync.not-applicable': '不適用',
  'regulatory-datasets.last-sync.never-synced': '從未同步',

  'regulatory-datasets.action.versions': '版本清單',
  'regulatory-datasets.action.versions-shown': '收合',
  'regulatory-datasets.action.content': '查看內容',
  'regulatory-datasets.effective-at-as-of-date': '本基準日適用',

  'regulatory-datasets.versions-heading': '版本清單',
  'regulatory-datasets.versions-empty': '這個資料集還沒有任何版本。',
  'regulatory-datasets.content-heading': '版本內容',
  'regulatory-datasets.content-as-of': '法規適用基準日：',
  'regulatory-datasets.content-version': '適用版本：',
  'regulatory-datasets.content-no-version': '這一天沒有任何一版適用。可以把上方的基準日往後調。',

  /**
   * 版本內容的欄位標題（計畫 §5.3 的欄位定義表）。
   *
   * **名稱盡量沿用政府那一份的欄位名**（`月薪資總額`、`月投保薪資`、`行業別費率`…）：
   * 這一頁的用途就是拿來對公告，改寫欄位名會讓對帳的人多一次心算。
   * 對照關係逐一寫在後端的 `regulatory-record-shape.ts`。
   */
  'regulatory-datasets.field.insured-category': '身分別',
  'regulatory-datasets.field.grade': '等級',
  'regulatory-datasets.field.monthly-salary-range': '月薪資總額',
  'regulatory-datasets.field.range-from': '下限',
  'regulatory-datasets.field.range-to': '上限',
  'regulatory-datasets.field.monthly-insured-salary': '月投保薪資',
  'regulatory-datasets.field.group-range': '組別級距',
  'regulatory-datasets.field.monthly-insured-amount': '月投保金額',
  'regulatory-datasets.field.actual-salary-range': '實際薪資月額',
  'regulatory-datasets.field.actual-wage-range': '實際工資',
  'regulatory-datasets.field.monthly-contribution-wage': '月提繳工資',
  'regulatory-datasets.field.remark': '備註',
  'regulatory-datasets.field.insured-salary': '投保薪資',
  'regulatory-datasets.field.labor-insurance-rate': '勞保普通費率',
  'regulatory-datasets.field.employment-insurance-rate': '就保費率',
  'regulatory-datasets.field.employee-share': '勞工負擔',
  'regulatory-datasets.field.employer-share': '單位負擔',
  'regulatory-datasets.field.insured-share': '本人負擔',
  'regulatory-datasets.field.insured-with-1': '本人＋1 眷口',
  'regulatory-datasets.field.insured-with-2': '本人＋2 眷口',
  'regulatory-datasets.field.insured-with-3': '本人＋3 眷口',
  'regulatory-datasets.field.government-subsidy': '政府補助',
  'regulatory-datasets.field.major-category': '大分類',
  'regulatory-datasets.field.rate-code': '費率編號',
  'regulatory-datasets.field.industry-name': '行業類別',
  'regulatory-datasets.field.industry-rate': '行業別費率',
  'regulatory-datasets.field.commuting-rate': '上下班費率',
  'regulatory-datasets.field.occupational-accident-rate': '災保費率',
  'regulatory-datasets.field.item': '項目',
  'regulatory-datasets.field.amount': '金額',
  'regulatory-datasets.field.rate': '費率',
  'regulatory-datasets.field.announced-on': '發布日',
  'regulatory-datasets.field.announcement-text': '公告原文',

  /**
   * 扣繳稅額表的 12 個扶養人數欄。上限 11 人是政府那張表自己的上限，不是我們訂的
   * （後端 `WITHHOLDING_TAX_DEPENDENT_COUNTS`）。
   */
  'regulatory-datasets.field.tax-0': '0 人',
  'regulatory-datasets.field.tax-1': '1 人',
  'regulatory-datasets.field.tax-2': '2 人',
  'regulatory-datasets.field.tax-3': '3 人',
  'regulatory-datasets.field.tax-4': '4 人',
  'regulatory-datasets.field.tax-5': '5 人',
  'regulatory-datasets.field.tax-6': '6 人',
  'regulatory-datasets.field.tax-7': '7 人',
  'regulatory-datasets.field.tax-8': '8 人',
  'regulatory-datasets.field.tax-9': '9 人',
  'regulatory-datasets.field.tax-10': '10 人',
  'regulatory-datasets.field.tax-11': '11 人',

  /** `dataset_code=8` 的 `item`：一則公告拆成月薪與時薪兩筆。 */
  'regulatory-datasets.minimum-wage.monthly': '每月最低工資',
  'regulatory-datasets.minimum-wage.hourly': '每小時最低工資',

  /** `dataset_code=10` 的 `item`：費率與兩個計費門檻，同一次公告的三筆。 */
  'regulatory-datasets.supplementary.rate': '補充保險費率',
  'regulatory-datasets.supplementary.charge-lower-bound': '單次給付計費下限',
  'regulatory-datasets.supplementary.single-payment-upper-limit': '單次給付計費上限',

  /** 前端自己要說的話，見檔頭的「唯一的例外」。 */
  'error.system': '系統發生錯誤，請稍後再試。',

  /**
   * 沒有權限進入某一頁（§4.3）。
   *
   * 這一句同樣是前端自己要說的：路由守衛是在**送出任何請求之前**就擋下來的，
   * 手上沒有後端訊息可顯示。內容刻意不說是缺哪一個權限碼——那與後端 `901` 一律不揭露細節
   * 是同一個決定（後端規範 §3.1.1）。
   */
  'error.no-permission': '你沒有權限使用這個功能。',
} as const
