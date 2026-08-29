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

  // --- 今日打卡（計畫 06 Stage 5，UI 定案 `docs/ui/10-ui-dashboard-attendance.md`） ----------
  'dashboard.attendance.heading': '今日打卡',
  'dashboard.attendance.retry': '重新載入',

  'dashboard.attendance.status.not-started': '尚未上班',
  'dashboard.attendance.status.clocked-in': '上班中',
  'dashboard.attendance.status.clocked-out': '今日打卡完成',

  'dashboard.attendance.field.clock-in-at': '上班時間',
  'dashboard.attendance.field.clock-out-at': '下班時間',
  'dashboard.attendance.field.worked-hours': '今日工時',
  'dashboard.attendance.unit.hours': '小時',

  'dashboard.attendance.action.clock-in': '上班打卡',
  'dashboard.attendance.action.clock-out': '下班打卡',
  'dashboard.attendance.action.revoke': '撤銷',
  'dashboard.attendance.completed': '今天的上下班卡都已完成。',

  /** 拒絕授權後瀏覽器不會再跳出詢問視窗，因此這裡明講要去哪裡改，不能只說「無法取得定位」。 */
  'dashboard.attendance.gps.denied-required':
    '無法取得定位：瀏覽器的定位權限已被封鎖，而公司的出勤設定要求打卡時需要定位。請在瀏覽器網址列旁的權限設定中允許定位存取，再重新整理頁面。',
  'dashboard.attendance.gps.unavailable-required': '無法取得定位，請確認裝置的定位功能已開啟後再試一次。',

  'dashboard.attendance.revoke.title-clock-in': '撤銷上班卡',
  'dashboard.attendance.revoke.title-clock-out': '撤銷下班卡',
  'dashboard.attendance.revoke.punch-time-label': '打卡時間',
  'dashboard.attendance.revoke.field.reason': '撤銷原因',
  'dashboard.attendance.revoke.cancel': '取消',
  'dashboard.attendance.revoke.submit': '撤銷',
  'dashboard.attendance.revoke.confirm': '撤銷後這筆打卡將不再計入今日出勤，確定要撤銷嗎？',
  'dashboard.attendance.revoke.confirm-title': '請再次確認',
  'dashboard.attendance.revoke.confirm-ok': '確定撤銷',
  'dashboard.attendance.revoke.confirm-cancel': '取消',
  'dashboard.attendance.revoke.hint.clock-out-first': '已有下班卡，須先撤銷下班卡才能撤銷上班卡。',

  'dashboard.attendance.toast.clocked-in': '上班打卡成功。',
  'dashboard.attendance.toast.clocked-out': '下班打卡成功。',
  'dashboard.attendance.toast.revoked': '已撤銷這筆打卡。',

  'menu.overview': '總覽',
  'menu.dashboard': '首頁',
  'menu.system-settings': '系統設定',
  'menu.regulatory-datasets': '法規資料集',
  'menu.regulatory-sync': '法規資料同步歷程',
  'menu.hr-operations': '人事作業',
  'menu.shifts-main': '班別設定',
  'menu.employees-main': '員工清單',

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
  'regulatory-sync.description': '每一次自動同步的結果。政府法規全國一份，這一頁不分公司，所有公司看到的是同一份紀錄。',
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

  // ---------------------------------------------------------------------------------
  // 班別設定（計畫 04、docs/ui/22-ui-shift-settings.md）。
  // ---------------------------------------------------------------------------------

  'shifts-main.heading': '班別設定',
  'shifts-main.description':
    '定義「一天怎麼上班」：工作時段、休息時段。應工作分鐘由系統依時段與休息計算，不能手動輸入。',

  'shifts-main.filter.keyword': '代碼或名稱',
  'shifts-main.filter.keyword-placeholder': '輸入班別代碼或名稱',
  'shifts-main.filter.work-type': '工作類型',
  'shifts-main.filter.overnight': '跨日',
  'shifts-main.filter.flexible': '彈性',
  'shifts-main.filter.status': '狀態',
  'shifts-main.filter.all': '全部',
  'shifts-main.filter.yes': '是',
  'shifts-main.filter.no': '否',
  'shifts-main.filter.status-active': '啟用',
  'shifts-main.filter.status-inactive': '停用',

  /** 工時管理方式（計畫 §5.1、§10）：值固定為 1–4，不是可以任意擴充的清單。 */
  'shifts-main.work-type.1': '一般',
  'shifts-main.work-type.2': '輪班',
  'shifts-main.work-type.3': '彈性',
  'shifts-main.work-type.4': '責任制',

  /** 日偏移的呈現（計畫 §4.2、前端規範必做事項 2）：`endDayOffset=1` 不直接顯示數字。 */
  'shifts-main.day-offset.next': '隔日',

  'shifts-main.break.paid': '有薪',
  'shifts-main.break.unpaid': '無薪',
  'shifts-main.unit.hours': '小時',

  'shifts-main.column.code': '班別代碼',
  'shifts-main.column.name': '名稱',
  'shifts-main.column.work-type': '工作類型',
  'shifts-main.column.work-periods': '工作時段',
  'shifts-main.column.breaks': '休息時段',
  'shifts-main.column.required-hours': '應工作時數',
  'shifts-main.column.overnight': '跨日',
  'shifts-main.column.flexible': '彈性',
  'shifts-main.column.status': '狀態',
  'shifts-main.column.actions': '操作',

  'shifts-main.status.active': '啟用',
  'shifts-main.status.inactive': '停用',
  'shifts-main.yes': '是',
  'shifts-main.no': '否',

  'shifts-main.action.create': '新增班別',
  'shifts-main.action.edit': '編輯',
  'shifts-main.action.copy': '複製',
  'shifts-main.action.delete': '刪除',
  'shifts-main.action.activate': '啟用',
  'shifts-main.action.deactivate': '停用',
  'shifts-main.retry': '重新載入',
  'shifts-main.empty': '目前沒有符合條件的班別。',

  'shifts-main.confirm.title': '請確認',
  'shifts-main.confirm.delete': '確定要刪除這個班別嗎？刪除後這個班別不會再出現在清單中。',
  'shifts-main.confirm.activate': '確定要啟用這個班別嗎？',
  'shifts-main.confirm.deactivate': '確定要停用這個班別嗎？停用後，這個班別預設不會出現在清單中。',
  'shifts-main.confirm.ok': '確定',
  'shifts-main.confirm.cancel': '取消',

  'shifts-main.toast.created': '班別已建立。',
  'shifts-main.toast.updated': '班別已更新。',
  'shifts-main.toast.copied': '班別已複製。',
  'shifts-main.toast.deleted': '班別已刪除。',
  'shifts-main.toast.activated': '班別已啟用。',
  'shifts-main.toast.deactivated': '班別已停用。',

  'shifts-main.dialog.create-title': '新增班別',
  'shifts-main.dialog.edit-title': '修改班別',
  'shifts-main.dialog.load-failed': '載入班別內容失敗，請關閉後重試。',

  'shifts-main.field.code': '班別代碼',
  'shifts-main.field.name': '名稱',
  'shifts-main.field.work-type': '工作類型',
  'shifts-main.field.flexible': '彈性班',
  'shifts-main.field.description': '說明',
  'shifts-main.field.description-hint':
    '這張表的規則是停用舊班別、複製建立新班別，半年後同一家公司會累積出多個相近的班別；分辨它們靠的就是這裡的說明。',
  'shifts-main.field.is-active': '啟用',
  'shifts-main.field.required-hours-preview': '應工作時數（預覽）',
  'shifts-main.field.required-hours-preview-hint': '依目前輸入的時段即時試算，僅供參考；送出後以後端計算的結果為準。',

  'shifts-main.periods.heading': '工作時段',
  'shifts-main.periods.add': '新增時段',
  'shifts-main.periods.remove': '刪除',
  'shifts-main.periods.start-time': '開始時間',
  'shifts-main.periods.end-time': '結束時間',
  'shifts-main.periods.end-day': '結束日',
  'shifts-main.periods.same-day': '當日',
  'shifts-main.periods.next-day': '隔日',
  'shifts-main.periods.empty': '至少要有一段工作時段。',

  'shifts-main.breaks.heading': '休息時段',
  'shifts-main.breaks.add': '新增休息',
  'shifts-main.breaks.remove': '刪除',
  'shifts-main.breaks.start-time': '開始時間',
  'shifts-main.breaks.end-time': '結束時間',
  'shifts-main.breaks.is-paid': '有薪',
  'shifts-main.breaks.empty': '沒有休息時段。',

  'shifts-main.form.submit': '儲存',
  'shifts-main.form.cancel': '取消',

  'shifts-main.copy.title': '複製班別',
  'shifts-main.copy.description': '工作類型、彈性、時段與休息一律取自來源班別；說明請重新填寫，不會帶入來源的說明。',
  'shifts-main.copy.field.code': '新班別代碼',
  'shifts-main.copy.field.name': '新班別名稱',
  'shifts-main.copy.field.description': '說明',
  'shifts-main.copy.field.is-active': '啟用',
  'shifts-main.copy.submit': '複製',
  'shifts-main.copy.cancel': '取消',

  /** 前端唯一的表單驗證文案：只做「必填」（§6.1，格式與長度一律交給後端的 300 錯誤）。 */
  'shifts-main.validation.required': '必填',

  /**
   * 性別。`employees.` 中性前綴（不是 `employees-main.`）：這是 `employees/main`（員工清單）與
   * `employees/onboarding`（新增員工）共用的呈現，理由與 `regulatory.` 的 sync-status 共用前綴
   * 同構（見 `shared/employees/gender.ts` 檔頭）。
   */
  'employees.gender.male': '男',
  'employees.gender.female': '女',

  // --- 員工清單（`pages/employees/main/`，UI 定案 `docs/ui/20-employee-list.md` §1） --------
  'employees-main.heading': '員工清單',
  'employees-main.description': '公司內的員工主檔，預設顯示目前在職員工。',
  'employees-main.action.create': '新增員工',
  'employees-main.filter.keyword': '員工編號或姓名',
  'employees-main.filter.keyword-placeholder': '輸入員工編號或姓名',
  'employees-main.retry': '重新載入',
  'employees-main.empty': '目前沒有員工資料。',
  'employees-main.empty-filtered': '沒有符合條件的員工，可以試著清除篩選條件。',
  'employees-main.column.employee-code': '員工編號',
  'employees-main.column.name': '姓名',
  'employees-main.column.gender': '性別',
  'employees-main.column.job-title': '職稱',
  'employees-main.column.action': '操作',
  'employees-main.action.view': '查看並修改',

  // --- 新增員工（`pages/employees/onboarding/`，UI 定案 §2） ------------------------------
  'employees-onboarding.heading': '新增員工',
  'employees-onboarding.description': '單頁輸入，一次建立員工、任職、部門、扣繳、登入帳號及角色；任一步失敗整筆取消。',
  'employees-onboarding.retry': '重新載入',
  'employees-onboarding.action.cancel': '取消',
  'employees-onboarding.action.submit': '建立員工',
  'employees-onboarding.toast.created': '員工已建立。',

  'employees-onboarding.section.basic': '基本資料',
  'employees-onboarding.section.employment': '任職與組織',
  'employees-onboarding.section.withholding': '扣繳',
  'employees-onboarding.section.account': '登入帳號與角色',

  'employees-onboarding.field.employee-code': '員工編號',
  'employees-onboarding.field.name': '姓名',
  'employees-onboarding.field.gender': '性別',
  'employees-onboarding.field.identity-number': '身分證字號',
  'employees-onboarding.field.birthday': '出生日期',
  'employees-onboarding.field.phone': '手機',
  'employees-onboarding.field.email': 'Email',
  'employees-onboarding.field.address': '地址',

  'employees-onboarding.field.employment-type': '僱用類型',
  'employees-onboarding.field.employment-nature': '任職性質',
  'employees-onboarding.field.employment-nature-hint': '選填，依公司內部代碼設定；未設定代碼可留白。',
  'employees-onboarding.field.hire-date': '到職日期',
  'employees-onboarding.field.department': '部門',
  'employees-onboarding.field.job-title': '職稱',
  'employees-onboarding.field.job-positions': '職務',

  'employees-onboarding.field.withholding-method': '薪資扣繳方式',

  'employees-onboarding.field.username': '帳號',
  'employees-onboarding.field.initial-password': '初始密碼',
  'employees-onboarding.field.roles': '角色',
  'employees-onboarding.field.roles-hint': '至少指派一個角色；員工第一次登入必須強制變更密碼。',

  /** 僱用類型代碼（1–8，值域對齊後端 `employments-main.routes.ts` 的 `EmploymentTypeCodeSchema`）。 */
  'employees-onboarding.employment-type.1': '正職',
  'employees-onboarding.employment-type.2': '兼職',
  'employees-onboarding.employment-type.3': '約聘',
  'employees-onboarding.employment-type.4': '派遣',
  'employees-onboarding.employment-type.5': '工讀',
  'employees-onboarding.employment-type.6': '臨時',
  'employees-onboarding.employment-type.7': '顧問',
  'employees-onboarding.employment-type.8': '實習',

  /** 扣繳方式代碼（值域對齊後端 `employee-withholding-settings.ts` 的 `WithholdingMethodCode`）。 */
  'employees-onboarding.withholding-method.1': '薪資所得扣繳稅額表',
  'employees-onboarding.withholding-method.2': '固定 5%',

  // --- 修改員工（`pages/employees/detail/`，UI 定案 §3，計畫 05 Stage 6 第二段） ------------
  'employees-detail.heading': '員工詳細資料',
  'employees-detail.back': '返回員工清單',
  'employees-detail.retry': '重新載入',
  'employees-detail.not-found': '找不到這位員工，可能已被刪除或不屬於目前公司。',

  'employees-detail.tab.basic': '基本資料',
  'employees-detail.tab.employment': '任職資料',
  'employees-detail.tab.organization': '組織資料',
  'employees-detail.tab.withholding': '眷屬、扣繳與勞退',
  'employees-detail.tab.account': '帳號與角色',

  'employees-detail.employment-status.active': '在職',
  'employees-detail.employment-status.left': '離職',

  // §3.1 基本資料：欄位標籤沿用 `employees-onboarding.field.*`（同一組欄位，理由見 `.view.ts` 檔頭）。
  'employees-detail.basic.current-title': '目前資料（遮罩顯示，僅供比對）',
  'employees-detail.basic.form-title': '修改',
  'employees-detail.basic.sensitive-hint':
    '身分證字號、出生日期、手機、Email、地址查詢時一律遮罩，後端也不接受遮罩值送回——修改任何欄位都必須在下方重新完整輸入這幾欄。',
  'employees-detail.basic.action.save': '儲存',
  'employees-detail.basic.toast.updated': '基本資料已更新。',

  // §3.2 任職資料
  'employees-detail.employment.column.hire-date': '到職日期',
  'employees-detail.employment.column.type': '僱用類型',
  'employees-detail.employment.column.status': '任職狀態',
  'employees-detail.employment.column.leave-date': '離職日',
  'employees-detail.employment.column.last-working-date': '最後工作日',
  'employees-detail.employment.column.leave-reason': '離職原因代碼',
  'employees-detail.employment.column.action': '操作',
  'employees-detail.employment.empty': '目前沒有任職紀錄。',
  'employees-detail.employment.action.create': '新增任職（回任）',
  'employees-detail.employment.action.leave': '辦理離職',
  'employees-detail.employment.dialog.create-title': '新增任職',
  'employees-detail.employment.dialog.create-hint': '用於員工離職後重新回任；目前有在職中的任職時無法新增。',
  'employees-detail.employment.dialog.leave-title': '辦理離職',
  'employees-detail.employment.dialog.leave-notice':
    '完成離職後，這位員工的登入帳號會被同步停用；帳號、角色與所有歷史紀錄都不會被刪除，日後回任時可以再次新增任職。',
  'employees-detail.employment.field.leave-date': '離職日',
  'employees-detail.employment.field.last-working-date': '最後工作日',
  'employees-detail.employment.field.leave-reason-code': '離職原因代碼',
  'employees-detail.employment.field.leave-reason-hint': '依公司內部代碼設定；未設定代碼時請與人資確認。',
  'employees-detail.employment.toast.created': '任職紀錄已建立。',
  'employees-detail.employment.toast.left': '離職已辦理完成，登入帳號已同步停用。',
  'employees-detail.employment.form.cancel': '取消',
  'employees-detail.employment.form.submit': '送出',

  // §3.3 組織資料：部門／職稱／職務欄位標籤沿用 `employees-onboarding.field.*`。
  'employees-detail.organization.no-active-employment': '這位員工目前沒有在職中的任職紀錄，無法維護組織資料。',
  'employees-detail.organization.section.department': '部門異動',
  'employees-detail.organization.section.job-title': '職稱異動',
  'employees-detail.organization.section.job-positions': '職務異動',
  'employees-detail.organization.column.effective-from': '生效日',
  'employees-detail.organization.column.effective-to': '結束日',
  'employees-detail.organization.column.current': '目前生效',
  'employees-detail.organization.column.department': '部門',
  'employees-detail.organization.column.job-title': '職稱',
  'employees-detail.organization.column.job-positions': '職務',
  'employees-detail.organization.empty': '目前沒有異動紀錄。',
  'employees-detail.organization.action.add': '新增異動',
  'employees-detail.organization.hint': '生效日通常應填未來日期；生效日之前仍會顯示目前的部門、職稱或職務。',
  'employees-detail.organization.field.effective-from': '生效日',
  'employees-detail.organization.field.effective-to': '結束日（選填）',
  'employees-detail.organization.toast.department-created': '部門異動已建立。',
  'employees-detail.organization.toast.job-title-created': '職稱異動已建立。',
  'employees-detail.organization.toast.job-position-created': '職務異動已建立。',

  // §3.4 眷屬（計畫 05 Stage 7）
  'employees-detail.dependent.section.title': '眷屬',
  'employees-detail.dependent.empty': '目前沒有眷屬紀錄。',
  'employees-detail.dependent.column.name': '姓名',
  'employees-detail.dependent.column.identity-number': '身分證字號',
  'employees-detail.dependent.column.relationship': '關係',
  'employees-detail.dependent.column.effective-date': '扶養起日',
  'employees-detail.dependent.column.end-date': '扶養迄日',
  'employees-detail.dependent.column.status': '狀態',
  'employees-detail.dependent.status.active': '扶養中',
  'employees-detail.dependent.status.terminated': '已終止',
  'employees-detail.dependent.relationship.1': '配偶',
  'employees-detail.dependent.relationship.2': '父',
  'employees-detail.dependent.relationship.3': '母',
  'employees-detail.dependent.relationship.4': '子女',
  'employees-detail.dependent.relationship.5': '兄弟姊妹',
  'employees-detail.dependent.relationship.6': '祖父母',
  'employees-detail.dependent.relationship.7': '孫子女',
  'employees-detail.dependent.relationship.8': '其他',
  'employees-detail.dependent.field.name': '姓名',
  'employees-detail.dependent.field.identity-number': '身分證字號',
  'employees-detail.dependent.field.birthday': '出生日期',
  'employees-detail.dependent.field.relationship-code': '關係',
  'employees-detail.dependent.field.effective-date': '扶養起日',
  'employees-detail.dependent.field.end-date': '扶養迄日',
  'employees-detail.dependent.field.is-student': '在學',
  'employees-detail.dependent.field.is-disabled': '身心障礙',
  'employees-detail.dependent.field.is-unable-to-work': '無工作能力',
  'employees-detail.dependent.field.is-cohabiting': '同居扶養',
  'employees-detail.dependent.action.add': '新增眷屬',
  'employees-detail.dependent.action.terminate': '終止',
  'employees-detail.dependent.dialog.terminate-title': '終止扶養',
  'employees-detail.dependent.toast.created': '眷屬已新增。',
  'employees-detail.dependent.toast.terminated': '扶養關係已終止。',

  // §3.4 扣繳
  'employees-detail.withholding.section.title': '扣繳',
  'employees-detail.withholding.column.method': '扣繳方式',
  'employees-detail.withholding.column.effective-from': '生效日',
  'employees-detail.withholding.column.effective-to': '結束日',
  'employees-detail.withholding.column.current': '目前生效',
  'employees-detail.withholding.empty': '目前沒有扣繳設定紀錄。',
  'employees-detail.withholding.action.add': '新增扣繳設定',
  'employees-detail.withholding.field.effective-from': '生效日',
  'employees-detail.withholding.field.effective-to': '結束日（選填）',
  'employees-detail.withholding.toast.created': '扣繳設定已建立。',

  // §3.4 勞退自願提繳率（計畫 05 Stage 7）
  'employees-detail.labor-pension.section.title': '勞退自願提繳率',
  'employees-detail.labor-pension.empty': '目前沒有勞退自願提繳率設定紀錄。',
  'employees-detail.labor-pension.column.rate': '自願提繳率',
  'employees-detail.labor-pension.column.effective-from': '生效日',
  'employees-detail.labor-pension.column.effective-to': '結束日',
  'employees-detail.labor-pension.column.current': '目前生效',
  'employees-detail.labor-pension.field.rate': '自願提繳率',
  'employees-detail.labor-pension.field.rate-placeholder': '例如 0.0600（6%）',
  'employees-detail.labor-pension.field.effective-from': '生效日',
  'employees-detail.labor-pension.field.effective-to': '結束日（選填）',
  'employees-detail.labor-pension.action.add': '新增提繳率設定',
  'employees-detail.labor-pension.toast.created': '勞退自願提繳率設定已建立。',

  // §3.5 帳號與角色
  'employees-detail.account.no-active-account':
    '這位員工目前沒有有效的登入帳號（尚未建立帳號，或帳號已因離職而停用）。',

  'employees-detail.account.section.status': '帳號狀態',
  'employees-detail.account.status.active': '啟用中',
  'employees-detail.account.status.no-toggle-hint':
    '帳號停用只會在辦理員工離職時由系統自動執行；目前沒有提供管理者另外啟用或停用帳號的功能。',

  'employees-detail.account.section.reset-password': '重設密碼',
  'employees-detail.account.field.new-password': '新密碼',
  'employees-detail.account.field.new-password-hint': '長度需為 8～128 個字元；重設後不會寄送 Email、簡訊或系統通知。',
  'employees-detail.account.action.reset-password': '重設密碼',
  'employees-detail.account.toast.password-reset': '密碼已重設。',

  'employees-detail.account.section.roles': '角色指派',
  'employees-detail.account.roles-empty': '這個帳號目前沒有任何角色。',
  'employees-detail.account.column.role': '角色',
  'employees-detail.account.column.assigned-at': '指派時間',
  'employees-detail.account.column.assigned-by': '指派者',
  'employees-detail.account.action.revoke': '移除',
  'employees-detail.account.hint.last-role': '每個帳號至少要保留一個角色，無法移除最後一個。',
  'employees-detail.account.field.role-ids': '新增角色',
  'employees-detail.account.action.assign': '新增角色',
  'employees-detail.account.toast.role-assigned': '角色已新增。',
  'employees-detail.account.toast.role-revoked': '角色已移除。',

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
