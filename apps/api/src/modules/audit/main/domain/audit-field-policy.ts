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
 *   兩邊的詞彙本來就對不上：「身分證」在業務上是一個 `identityNumber`，在資料庫裡是兩欄
 *   （`identityNumberEncrypted` 密文 ＋ `identityNumberHash` blind index），schema 裡沒有任何一欄叫
 *   `identityNumber`。掃描器若照「讀 Drizzle schema 比對政策」實作，第一次就對不上，
 *   而真正危險的是下一步：有人為了讓它過而把比對改成鬆散比對（剝掉 `_encrypted`／`_hash` 後綴），
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
       * 這一欄沒有判斷空間，只能是 `presence`。
       */
      identityNumber: AuditFieldLevel.Presence,
      /*
       * 以下四欄（生日、電話、Email、地址）不在字典的明文禁止清單內，但**已定案一律只記
       * 「有調整」、不記內容**——請勿日後「補上」前後值。判準是**機械的、不必逐欄重新判斷
       * 「這個算不算敏感」**：
       *
       *   業務欄位對應到 `employees` 的 `*_encrypted` 欄位者，一律 `presence`。
       *
       * 兩個具體後果撐著這條判準：
       *
       * 1. **明文副本會落在加密邊界之外。** 這幾欄在 `employees` 是加密儲存的，而 `audit_logs.changes`
       *    是一個沒有加密的 JSON 欄位，且這張表 append-only——寫進去的明文**改不掉也刪不掉**（§3.4）。
       *    等於系統一邊花成本把地址加密，一邊在旁邊留一份永久明文。
       * 2. **稽核會變成遮罩規則的旁路。** §5.1 要求對外一律遮罩，`employee-model.ts` 更是刻意讓
       *    輸出型別上根本沒有明文欄位。若稽核記明文，日後那支稽核查詢端點回的地址會是完整的，
       *    而員工詳情端點回的是遮罩的——**同一份個資，兩支端點兩種答案**，先做的那道防線等於白做。
       *
       * 代價講清楚：查稽核的人看不到「地址從 A 改成 B」，只看得到「地址被改過」。
       * 需要前後值時，正確的作法是走 §5.1 允許的那種「明確授權 ＋ 必寫稽核」的專用端點，
       * 而不是把明文放進一張人人查得到、且永遠刪不掉的表。
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
       * 配套是呼叫端的責任：`UpdateEmployeeInput` 是 `{ id } & EmployeeProfileInput`，
       * 交給稽核的前後快照必須是**去掉 `id` 的 profile 形狀**。傳整包進來的話，
       * `id` 會被判為未分類而拋例外——那正是要的結果，不是要繞開的障礙。
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
} as const satisfies Readonly<Record<string, AuditTablePolicy>>

/**
 * `subject_table` 的合法值。
 *
 * 型別上收斂到政策的外層 key：**沒有政策的表就記不了稽核**，而不是「記得進去、只是沒有人檢查它的欄位」。
 */
export type AuditSubjectTable = keyof typeof AUDIT_FIELD_POLICY
