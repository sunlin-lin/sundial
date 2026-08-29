/**
 * 稽核欄位政策：每一張會被稽核的表，逐欄宣告它能進稽核到什麼程度（計畫 §4.3、§4.5）。
 *
 * ## 白名單，不是黑名單
 *
 * 未被分類的欄位一律被視為**漏了**，執行期拋例外（見 `audit-change-set.ts`）、掃描階段變紅
 * （`check:audit-policy`，計畫 §6.1）。反過來的黑名單寫法失敗模式差很多：
 * 半年後有人在 `employees` 加一欄護照號碼，黑名單沒人記得補，那一欄就**自動**被記進稽核，
 * 不會有任何地方報錯。**黑名單漏了 → 敏感資料外洩且沒有症狀；白名單漏了 → 稽核少一欄，會紅。**
 *
 * ## 兩層結構：外層資料表名，內層業務欄位名
 *
 * 這兩層刻意用**不同的詞彙**，因為它們要對上的是不同的東西：
 *
 * - **外層 key = 資料表名（snake_case）**，因為它就是 `audit_logs.subject_table` 的合法值
 *   ——那一欄記錄的是「這筆稽核講的是哪張表的哪一列」。
 * - **內層 key = 業務層欄位名（camelCase）**，因為它要對上 `recordAudit` 執行時**實際收到**的欄位集合，
 *   而那是業務型別（`EmployeeProfileInput` 那一套）的欄位，不是 Drizzle schema 的欄位。
 *   兩邊的詞彙不保證對得上，這件事不因為某個欄位現在剛好同名就不成立：舉例，「員工到職日」在
 *   業務上是 `hireDate`，在資料庫裡是 `employee_employments.hire_date`（表都不一樣）；「身分證」
 *   在業務上是 `identityNumber`，資料庫這一輪雖然新增了同名的明文欄位 `identity_number`，
 *   但舊的 `identity_number_encrypted`／`identity_number_hash` 這一輪仍然原封不動留著（過渡狀態，
 *   見 `db/schema/employees.ts` 檔頭），一張表上同時有「對得上業務欄位名」與「對不上」的欄位並存。
 *   掃描器若照「讀 Drizzle schema 比對政策」實作，換一張表、換一個時期就可能踩到不同的落差，
 *   而真正危險的是下一步：有人為了讓它過而把比對改成鬆散比對（猜測欄位名的對應規則），
 *   從此它驗證的是一份人工拼湊的映射，跟執行期真正收到的欄位集合對不上，**而掃描器是綠的**。
 *
 * ## `source` 是字串，不是 import
 *
 * {@link AuditTablePolicy.source} 明寫型別來源，讓掃描器知道該拿哪一個型別的欄位清單來比對。
 * **刻意是字串而不是 `import type`**：`audit` 不得相依其他模組的內部檔案（§0.3），
 * 而掃描器做的是靜態比對，執行期不需要那個型別。寫成 import 的話，
 * 「audit 模組相依 employees 模組的內部檔案」這條違規就會被開一個口，而且是永久性的
 * ——之後每加一張被稽核的表，就多一條跨模組相依。
 *
 * 也不用「目錄慣例」去猜來源（例如「表名 `employees` 就去 `modules/employees/main/domain/` 找」）：
 * 靠約定命名的話，改檔名或搬目錄會讓掃描器**安靜地掃不到東西**——它照跑、照綠，只是零命中。
 */

/**
 * 三個級別。
 *
 * **三級而不是兩級**，是為了讓「刻意不記」與「忘了分類」分得開：只有 `value`／`presence` 的話，
 * `createdAt` 這種本來就不該記的欄位，會跟一個剛加上去、還沒有人分類的新欄位長得一模一樣。
 */
export const AuditFieldLevel = {
  /** 記前後值。`changes` 形狀為 `{ field, before, after }`。 */
  Value: 'value',
  /**
   * **只記「這一欄變更了」，不記值。** `changes` 形狀為 `{ field, changed: true }`。
   *
   * 這一級是必要的，不是折衷：資料字典同時明列「管理者重設密碼要稽核」與「密碼不得寫入稽核」，
   * 兩條同時成立的唯一解就是記事件、不記值。身分證同理——「誰改了某人的身分證」是重要異動，
   * 但號碼不能進去。
   */
  Presence: 'presence',
  /** 明確不記，連欄位名都不會出現在 `changes` 裡。 */
  Excluded: 'excluded',
} as const

export type AuditFieldLevelValue = (typeof AuditFieldLevel)[keyof typeof AuditFieldLevel]

/** 單一資料表的政策。 */
export type AuditTablePolicy = {
  /**
   * 內層欄位名的型別來源，形如 `<路徑>#<型別名>`。供 `check:audit-policy` 取欄位清單比對，
   * 執行期只在錯誤訊息裡出現（讓「哪一份型別漏了分類」不必用猜的）。
   */
  readonly source: string
  /** 業務層欄位名（camelCase）→ 級別。**未列出的欄位＝未分類＝錯誤**，不是「預設不記」。 */
  readonly fields: Readonly<Record<string, AuditFieldLevelValue>>
}

/**
 * 全部政策。**外層 key 就是 `subject_table` 的合法值**（型別由 {@link AuditSubjectTable} 收斂）。
 *
 * 不另外維護一份「哪些表會被稽核」的清單：多維護一份的下場是兩邊會少一邊，而少的那邊不會報錯。
 */
export const AUDIT_FIELD_POLICY = {
  employees: {
    // 對上的是**寫入方向**的業務型別。輸出型別（`EmployeeDetail`）帶的是 `xxxMasked`，
    // 拿它當來源等於在稽核裡記遮罩後的值——那既不是原值也不是「有沒有改」，兩邊都沒用。
    source: 'modules/employees/main/domain/employee-model.ts#EmployeeProfileInput',
    fields: {
      /**
       * 資料字典明文要求「員工編號可修改，修改前後須留稽核紀錄」——**前後值本身就是這一欄的規格**。
       * 它是對外可見的識別碼，不是加密欄位，記值不擴大任何外洩面。
       */
      employeeCode: AuditFieldLevel.Value,
      /**
       * 姓名是稽核**可讀性**的下限：沒有它，一筆稽核只剩一串 uuid，查的人得再去員工表對一次
       * ——而那筆資料可能已經被改過或刪掉了，對出來的是現值，不是當時的值。
       */
      name: AuditFieldLevel.Value,
      /** 值域只有兩個代碼且非加密欄位，記值不增加外洩面，而「性別被改過」本身沒有追查價值。 */
      gender: AuditFieldLevel.Value,
      /**
       * 資料字典**明文禁止**完整身分證字號寫入稽核內容（與密碼、密碼 hash、完整銀行帳號同列）。
       * 這一欄沒有判斷空間，只能是 `presence`——**且這個判準與 `employees` 存不存加密欄位無關**：
       * `employees.identity_number_encrypted` 移除加密、改回明文儲存（見 `db/schema/employees.ts`
       * 檔頭）不會、也不該讓這一欄的級別跟著鬆動，因為理由從來就不是「這欄剛好是加密欄位」，
       * 是資料字典本身明文禁止身分證進稽核內容。
       */
      identityNumber: AuditFieldLevel.Presence,
      /*
       * 以下四欄（生日、電話、Email、地址）不在字典的明文禁止清單內，但**已定案一律只記
       * 「有調整」、不記內容**——請勿日後「補上」前後值，**這個決定不因為 `employees` 欄位改回
       * 明文儲存而改變**（架構變更見 `db/schema/employees.ts` 檔頭「敏感欄位改回明文」）。
       *
       * **判準原本是「業務欄位對應到 `*_encrypted` 欄位者，一律 presence」，那條判準現在不成立了
       * ——`employees` 已經沒有加密欄位。仍然維持 presence 級的理由是下面第 2 點單獨就足以撐住：**
       *
       * 1. ~~明文副本會落在加密邊界之外。~~ **這條理由隨加密移除而失效，不再適用**：欄位加密
       *    移除後，主表本來就是明文，稽核表多一份明文副本不再是「多穿越一層加密邊界」，
       *    而是單純的個資重複儲存問題——理由性質不同，不能拿舊理由套新架構，因此獨立列出、
       *    誠實標記為失效，而不是悄悄留著一段對不上程式碼的舊註解。
       * 2. **稽核會變成遮罩規則的旁路，這一條不因儲存方式改變而改變。** §5.1 要求對外一律遮罩，
       *    `employee-model.ts` 更是刻意讓輸出型別上根本沒有明文欄位。若稽核記明文，日後那支稽核
       *    查詢端點回的地址會是完整的，而員工詳情端點回的是遮罩的——**同一份個資，兩支端點兩種
       *    答案**，先做的那道防線等於白做。這條理由完全獨立於「主表存不存加密」，因此級別維持
       *    `presence`。
       *
       * 代價講清楚：查稽核的人看不到「地址從 A 改成 B」，只看得到「地址被改過」。
       * 需要前後值時，正確的作法是走 §5.1 允許的那種「明確授權 ＋ 必寫稽核」的專用端點，
       * 而不是把明文放進一張人人查得到、且永遠刪不掉的表。**請勿以「反正主表現在也是明文」為
       * 理由把這幾欄放寬成 `value`**——那正是這段說明要擋住的事。
       */
      birthday: AuditFieldLevel.Presence,
      phone: AuditFieldLevel.Presence,
      email: AuditFieldLevel.Presence,
      address: AuditFieldLevel.Presence,
      /*
       * **這裡刻意沒有 `id`／`createdAt`／`updatedAt` 這類 `excluded` 條目。**
       *
       * 不是忘了：內層 key 的定義域是 `source` 指到的那一個型別（`EmployeeProfileInput`），
       * 而它裡面根本沒有這幾個欄位。多寫進來的話，`check:audit-policy` 的第二條檢查
       * 「政策裡有型別上已經不存在的欄位 → 失敗」（計畫 §6.1）當場就會紅。
       *
       * 配套是呼叫端的責任：交給稽核的前後快照必須是**去掉 `id` 的 profile 形狀**，且必須是
       * 補齊過的完整 `EmployeeProfileInput`——`update` 的請求型別 `UpdateEmployeeInput`
       * （`{ id } & EmployeeProfileUpdateInput`）允許省略身分證、生日、手機、地址（省略＝不變更，
       * 見 `employee-model.ts` 的 `EmployeeProfileUpdateInput` 檔頭），但那是**請求**的形狀，
       * 不是稽核比對用的形狀：`updateEmployeeInTransaction` 會先把省略的欄位用目前值補齊，
       * 才組出交給 `buildAuditChanges` 的 `after`。傳未補齊、或連 `id` 都還在的整包進來的話，
       * 前者會讓稽核誤判成「變更了」，後者的 `id` 會被判為未分類而拋例外——都是要擋住的錯誤用法。
       */
    },
  },
  /**
   * **這個主體上發生的事，不是它自己欄位的差異**——角色指派／撤銷改的是 `company_user_roles`，
   * refresh token 重用偵測改的是 `refresh_tokens`。因此 `source` 不指向某個輸入型別（那裡沒有
   * 一個天然存在的「company_users 輸入型別」可指），而是指向 `audit` 模組自己宣告的**稽核內容型別**
   * ——完整理由見 `domain/audit-company-users-content.ts` 檔頭，計畫 §4.5 也有現成的說明。
   */
  company_users: {
    source: 'modules/audit/main/domain/audit-company-users-content.ts#CompanyUsersAuditContent',
    fields: {
      /**
       * 帳號在公司內的狀態。**新增於計畫 `05-employee-onboarding.md` Stage 3**：離職流程停用帳號時
       * 記錄前後狀態（`ACTIVE` → `INACTIVE`）。記值不記密——狀態本身不是敏感資料，
       * 而「這個帳號什麼時候被停用」正是資料字典要求稽核的內容。
       */
      status: AuditFieldLevel.Value,
      /**
       * 角色 id 陣列不是敏感資料（角色本身就是可見的組織資訊），記值才能回答「這個成員被指派／
       * 撤銷了哪些角色」——這正是資料字典要求稽核的內容（計畫 §1：「誰在什麼時候把某個角色指派
       * 給某人／撤銷」）。序列化成字串的理由見 `audit-company-users-content.ts`。
       */
      roleIds: AuditFieldLevel.Value,
      /**
       * 作廢的 token id 同樣不是敏感資料——它是資料庫的主鍵，不是 token 原值本身（原值連
       * DB 都不存明文，見 `db/schema/refresh-tokens.ts` 的 `token_hash`）。記值能讓事後追查
       * 「這次重用偵測到底作廢了哪幾張票」一次查到，而不必再去猜時間範圍。
       */
      revokedTokenIds: AuditFieldLevel.Value,
      /**
       * 被重用的那張票的 id。與 `revokedTokenIds` 同理，是資料庫主鍵不是 token 原值，
       * 記值不擴大任何外洩面。它是這筆稽核紀錄最有鑑識價值的一欄——沒有它，「重用的是上一張
       * 票（良性）」與「重用的是很久以前的票（資安事件）」在稽核上分不出來，理由完整寫在
       * `domain/audit-company-users-content.ts` 的 `reusedTokenId` 檔頭。
       */
      reusedTokenId: AuditFieldLevel.Value,
      /**
       * 管理者重設密碼是否發生。**只有這一欄是 `presence` 級**——密碼與密碼 hash 不得寫入稽核
       * （資料字典、UI 定案 `docs/ui/20-employee-list.md` §3.5 同時明文要求），理由見
       * `domain/audit-company-users-content.ts` 的 `CompanyUsersAuditContent.passwordReset` 檔頭。
       */
      passwordReset: AuditFieldLevel.Presence,
    },
  },
  /**
   * 任職異動與離職操作（實作計畫 `plans/05-employee-onboarding.md` Stage 3、資料字典明列的
   * 「任職資料與離職操作」）。`source` 指向 service 層的稽核快照型別，不是 `EmploymentDetail`
   * ——理由與 `employees` 的 `EmployeeProfileInput` 相同：拿輸出型別當來源，會把不該記的推導值
   * （`id`／`employeeId`／`createdAt`／`updatedAt`）也混進定義域。
   *
   * 全部欄位都是 `value` 級：沒有一欄是個資或加密欄位，僱用型態、日期、狀態代碼記值不擴大任何
   * 外洩面，而且正是「這個人什麼時候到職、什麼時候離職、為什麼離職」這種需要前後值才回答得出來
   * 的問題。
   */
  employee_employments: {
    source: 'modules/employments/main/domain/employment-model.ts#EmploymentAuditSnapshot',
    fields: {
      employmentTypeCode: AuditFieldLevel.Value,
      employmentNatureCode: AuditFieldLevel.Value,
      hireDate: AuditFieldLevel.Value,
      leaveDate: AuditFieldLevel.Value,
      lastWorkingDate: AuditFieldLevel.Value,
      leaveReasonCode: AuditFieldLevel.Value,
      status: AuditFieldLevel.Value,
    },
  },
  /**
   * 部門異動（資料字典明列「部門、職稱及職務異動」）。目前只有 `create`（新增一筆部門歷史）
   * 會呼叫，沒有個資欄位，全部記值。
   */
  employee_department_histories: {
    source:
      'modules/employments/department-histories/domain/department-history-model.ts#DepartmentHistoryAuditSnapshot',
    fields: {
      departmentId: AuditFieldLevel.Value,
      effectiveFrom: AuditFieldLevel.Value,
      effectiveTo: AuditFieldLevel.Value,
    },
  },
  /**
   * 扣繳方式異動（資料字典明列「扣繳方式與勞退自願提繳率異動」）。扣繳方式代碼與生效期間都不是
   * 個資，全部記值——「這位員工的扣繳方式什麼時候從哪個代碼改成哪個代碼」正是稽核要回答的問題。
   */
  employee_withholding_settings: {
    source: 'modules/withholding/main/domain/withholding-model.ts#WithholdingSettingAuditSnapshot',
    fields: {
      withholdingMethodCode: AuditFieldLevel.Value,
      effectiveFrom: AuditFieldLevel.Value,
      effectiveTo: AuditFieldLevel.Value,
    },
  },
  /**
   * 職稱異動（資料字典明列「部門、職稱及職務異動」；實作計畫 `plans/05-employee-onboarding.md`
   * §8 Stage 5）。形狀與 `employee_department_histories` 完全同構——鎖粒度、期間重疊的處置、
   * 稽核欄位都跟部門那一張一樣，差別只在指向 `job_titles`。
   */
  employee_job_title_histories: {
    source: 'modules/employments/job-title-histories/domain/job-title-history-model.ts#JobTitleHistoryAuditSnapshot',
    fields: {
      jobTitleId: AuditFieldLevel.Value,
      effectiveFrom: AuditFieldLevel.Value,
      effectiveTo: AuditFieldLevel.Value,
    },
  },
  /**
   * 職務異動（資料字典明列「部門、職稱及職務異動」；實作計畫 `plans/05-employee-onboarding.md`
   * §8 Stage 5）。**主體是一次批次指派動作，不是逐筆歷史列**——與 `company_users` 的角色指派
   * 稽核（`roleIds` 記整組有效角色）同一個判斷，理由見 `modules/employments/job-position-histories/
   * impl/employments-job-position-histories.create.service.ts` 檔頭「稽核：整批只留一筆」。
   * `jobPositionIds` 序列化成字串的理由與 `company_users.roleIds` 相同：`AuditFieldValue`
   * 不允許陣列。
   */
  employee_job_position_histories: {
    source:
      'modules/employments/job-position-histories/domain/job-position-history-model.ts#JobPositionAssignmentAuditSnapshot',
    fields: {
      jobPositionIds: AuditFieldLevel.Value,
      effectiveFrom: AuditFieldLevel.Value,
      effectiveTo: AuditFieldLevel.Value,
    },
  },
  /**
   * 眷屬新增、修改及終止（資料字典明列；實作計畫 `plans/05-employee-onboarding.md` §6、
   * §8 Stage 7）。`source` 指向 {@link DependentAuditSnapshot}，同時涵蓋 `create`／`terminate`
   * 兩個動作各自會用到的欄位——與 `employee_employments` 的 `EmploymentAuditSnapshot`
   * （同時涵蓋 `create`／`leave`）同一種形狀，理由同構：`create` 時 `endDate` 恆為 `null`、
   * `status` 恆為 `ACTIVE`，`terminate` 只改動 `endDate`／`status`。
   *
   * **`identityNumber`／`birthday` 是 `presence` 級，判準與 `employees` 逐字相同**：
   * `identityNumber` 的理由是資料字典明文禁止身分證進稽核內容（與 `employees.identityNumber`
   * 同一條規則）；`birthday` 的理由是「稽核不得變成遮罩規則的旁路」（§5.1 要求對外一律遮罩，
   * 若稽核記明文，稽核查詢端點回的生日會是完整的，而眷屬列表端點回的是遮罩的）——完整說明見
   * 上面 `employees.fields` 的同名說明，不重複。**這兩欄的級別不因 `employee_dependents` 欄位
   * 改回明文儲存而改變**（見 `db/schema/employee-dependents.ts` 檔頭「敏感欄位改回明文」）。
   * 其餘欄位（姓名、關係代碼、四個資格布林值、生效日、結束日、狀態）都不是個資欄位，記值不擴大
   * 任何外洩面，而且正是「這個人什麼時候開始／結束列入扶養、資格條件何時變動」這種需要前後值
   * 才回答得出來的問題。
   */
  employee_dependents: {
    source: 'modules/dependents/main/domain/dependent-model.ts#DependentAuditSnapshot',
    fields: {
      name: AuditFieldLevel.Value,
      identityNumber: AuditFieldLevel.Presence,
      birthday: AuditFieldLevel.Presence,
      relationshipCode: AuditFieldLevel.Value,
      isStudent: AuditFieldLevel.Value,
      isDisabled: AuditFieldLevel.Value,
      isUnableToWork: AuditFieldLevel.Value,
      isCohabiting: AuditFieldLevel.Value,
      effectiveDate: AuditFieldLevel.Value,
      endDate: AuditFieldLevel.Value,
      status: AuditFieldLevel.Value,
    },
  },
  /**
   * 扣繳方式與勞退自願提繳率異動（資料字典明列；實作計畫 `plans/05-employee-onboarding.md` §6、
   * §8 Stage 7）。形狀與 `employee_withholding_settings` 完全同構——鎖粒度、期間重疊的處置、
   * 稽核欄位都跟扣繳設定一樣，差別只在多一個不需要稽核的 `createdBy`（設定者本身不是「被改動的
   * 欄位」，與 `employee_job_title_histories` 不記 `employmentId` 是同一個理由）。
   */
  employee_labor_pension_settings: {
    source: 'modules/labor-pension/main/domain/labor-pension-model.ts#LaborPensionSettingAuditSnapshot',
    fields: {
      voluntaryContributionRate: AuditFieldLevel.Value,
      effectiveFrom: AuditFieldLevel.Value,
      effectiveTo: AuditFieldLevel.Value,
    },
  },
  /**
   * 公司打卡規則異動（實作計畫 `plans/06-attendance.md` §4.6、§5 Stage 2）。落在「金額設定異動」
   * 的鄰近類別——雖然不是金額，但 `gpsRequired`／`allowEmployeeCancellation` 這類開關直接決定
   * 出勤規則怎麼跑，比照既有對「規則設定類」一律記值的做法，全部欄位 `value` 級：沒有一欄是
   * 個資或加密欄位，六個布林開關記值不擴大任何外洩面，而且正是「這間公司的打卡規則什麼時候
   * 從哪個值改成哪個值」這種需要前後值才回答得出來的問題。
   *
   * `update` 端點在公司從未存過設定時等同「建立」（見 `impl/attendance-settings.update.
   * service.ts` 檔頭），此時 `before` 傳 `null`——與 `employee_labor_pension_settings.create`
   * 是同一種形狀，不需要為「這是第一次還是後續修改」分開兩種政策。
   */
  attendance_settings: {
    source: 'modules/attendance/settings/domain/attendance-settings-model.ts#AttendanceSettingsAuditSnapshot',
    fields: {
      requireClockInBeforeClockOut: AuditFieldLevel.Value,
      allowEmployeeCancellation: AuditFieldLevel.Value,
      allowCorrectionRequest: AuditFieldLevel.Value,
      correctionRequiresApproval: AuditFieldLevel.Value,
      gpsEnabled: AuditFieldLevel.Value,
      gpsRequired: AuditFieldLevel.Value,
    },
  },
  /**
   * 他人撤銷打卡（`attendance.records.revoke-other`，實作計畫 `plans/06-attendance.md` §4.6、
   * §5 Stage 3）。**打卡建立與本人撤銷（`revoke`）不落在這份政策裡，也不會呼叫 `recordAudit`**
   * ——兩者都不是稽核要求的五類操作之一，`attendance_records` 自己的 `revoked_by`／
   * `revoked_at`／`revoke_reason` 三欄已完整回答「誰、何時、為何撤銷」，這份政策只在
   * `revoke-other` 這一種動作下才會被查表比對。
   *
   * `source` 指向 `revoke-other` 專用的稽核快照型別，不是 `AttendanceRecordDetail`
   * ——理由與 `employee_employments` 的 `EmploymentAuditSnapshot` 相同：拿輸出型別當來源會把
   * `id`／`employeeId`／`employmentId`／`createdAt`／`updatedAt` 這些不該記的推導值也混進定義域。
   *
   * **`latitude`／`longitude`／`address` 為 `presence` 級，不是 `value`**：這三欄不再是密文欄位
   * （§5.1 架構變更，見 `db/schema/attendance-records.ts` 檔頭），但仍是位置隱私——`audit_logs`
   * 是不加密、只能新增、任何具備稽核查看權限的人都能查的全域表，把座標原始值整份記進 `value`
   * 級，等於在稽核這條路上開了一個後門，讓計畫 §4.2 剛定案的「誰能看到別人座標」可見範圍規則
   * 失去意義——查得到 `audit_logs` 的人不需要 `attendance.records.view-all`／`.revoke-other`
   * 這個權限碼，就能在稽核紀錄裡看到每一筆他人座標的完整明細。
   */
  attendance_records: {
    source: 'modules/attendance/records/domain/attendance-record-model.ts#AttendanceRecordRevokeOtherAuditSnapshot',
    fields: {
      clockedAt: AuditFieldLevel.Value,
      attendanceTypeCode: AuditFieldLevel.Value,
      latitude: AuditFieldLevel.Presence,
      longitude: AuditFieldLevel.Presence,
      address: AuditFieldLevel.Presence,
      revokeReason: AuditFieldLevel.Value,
    },
  },
} as const satisfies Readonly<Record<string, AuditTablePolicy>>

/**
 * `subject_table` 的合法值。
 *
 * 型別上收斂到政策的外層 key：**沒有政策的表就記不了稽核**，而不是「記得進去、只是沒有人檢查它的欄位」。
 */
export type AuditSubjectTable = keyof typeof AUDIT_FIELD_POLICY
