# 組織人事、薪資與人事成本

## 人事定案重點

> 員工清單的操作規格見 [員工清單 UI 定案](../ui/20-employee-list.md)。本文件是相對應 Schema 的唯一正式放置位置，不在 UI 文件重複定義欄位。

- `employees` 只代表公司內的人員主檔；不放在職狀態、到離職、部門、職稱、職務或薪資。
- 離職回任建立新的 `employee_employments`。
- 同時間僅一個部門；職務可同時多個；部門、職稱、職務皆留歷史。
- `employment_sequence` 不採用。

## `employees`

**註釋：** 員工個人主檔。

**設計理由：** 員工主檔只保存公司內的人員身分與個資，任職、部門、職稱、職務及薪資另行管理，避免會變動的雇用狀態覆蓋固定身分資料，也讓離職後回任仍沿用同一人員。

| 欄位名稱                    | 資料型態   | 必填性 | 欄位註釋                                     |
| --------------------------- | ---------- | ------ | -------------------------------------------- |
| `id`                        | `uuid`     | 必填   | 主鍵，資料唯一識別碼                         |
| `company_id`                | `uuid`     | 必填   | 所屬公司外鍵                                 |
| `employee_code`             | `string`   | 必填   | 公司內員工編號；可修改，修改前後須留稽核紀錄 |
| `name`                      | `string`   | 必填   | 顯示名稱                                     |
| `gender`                    | `string`   | 必填   | 性別代碼                                     |
| `identity_number_encrypted` | `binary`   | 必填   | 身分證加密值                                 |
| `identity_number_hash`      | `binary`   | 必填   | 身分證查詢 Hash                              |
| `birthday_encrypted`        | `binary`   | 必填   | 出生年月日加密值                             |
| `phone_encrypted`           | `binary`   | 必填   | 電話加密值                                   |
| `email_encrypted`           | `binary`   | 選填   | Email 加密值                                 |
| `address_encrypted`         | `binary`   | 必填   | 地址加密值                                   |
| `created_at`                | `datetime` | 必填   | 建立時間                                     |
| `updated_at`                | `datetime` | 必填   | 最後修改時間                                 |
| `deleted_at`                | `datetime` | 選填   | Soft Delete 時間                             |

**明確不含：** `status`、`hire_date`、`leave_date`。

**本輪新增約束：** `UNIQUE(company_id, employee_code)`；員工編號允許修改，但不得與同公司其他員工重複，且修改前後值寫入系統稽核。

## 已確認的本人個資顯示

- 「我的資料／個資」只供員工查看本人資料，不可直接修改。
- 員工編號與個人資料讀取 `employees`；到職與任職資料讀取目前有效的 `employee_employments`。
- 部門、職稱及職務讀取各自目前有效的歷史紀錄。
- 本頁不建立專用資料表，也不把任職或組織欄位搬入 `employees`。
- 詳細規劃見 [11-ui-my-profile.md](../ui/11-ui-my-profile.md)。

## `employee_employments`

**註釋：** 員工每次任職關係；回任新增一筆。

**設計理由：** 每一次受僱關係獨立成任職紀錄，可正確保留離職與回任的不同期間； employment_type_code 放在任職而非人員主檔，因同一人不同任職可能具有不同僱用型態。

| 欄位名稱                 | 資料型態   | 必填性 | 欄位註釋                                                                 |
| ------------------------ | ---------- | ------ | ------------------------------------------------------------------------ |
| `id`                     | `uuid`     | 必填   | 主鍵，資料唯一識別碼                                                     |
| `employee_id`            | `uuid`     | 必填   | 員工外鍵                                                                 |
| `employment_type_code`   | `integer`  | 必填   | 僱用型態：1 正職、2 兼職、3 約聘、4 派遣、5 工讀、6 臨時、7 顧問、8 實習 |
| `employment_nature_code` | `integer`  | 選填   | 任職性質代碼                                                             |
| `hire_date`              | `date`     | 必填   | 本次任職到職日                                                           |
| `leave_date`             | `date`     | 選填   | 本次任職離職日；在職為 NULL；辦理離職時必填                              |
| `last_working_date`      | `date`     | 選填   | 最後工作日；辦理離職時必填                                               |
| `leave_reason_code`      | `integer`  | 選填   | 離職原因代碼；辦理離職時必填                                             |
| `status`                 | `string`   | 必填   | 本次任職狀態；不用 DB ENUM                                               |
| `created_at`             | `datetime` | 必填   | 建立時間                                                                 |
| `updated_at`             | `datetime` | 必填   | 修改時間                                                                 |
| `deleted_at`             | `datetime` | 選填   | Soft Delete 時間                                                         |

**關聯與約束：** FK `employee_id → employees.id`；同一員工同一時間最多一筆有效任職；離職回任新增資料，不修改舊任職；不建立 `employment_sequence`。辦理離職時 `leave_date`、`last_working_date`、`leave_reason_code` 同時必填，且 `last_working_date ≤ leave_date`；完成後同步停用該員工的 `company_users`，但不刪除帳號與角色歷史。

## 人事歷史表

### `employee_department_histories`

**註釋：** 任職期間的部門歸屬歷史。

**設計理由：** 部門歸屬使用有效期間歷史表，才能回查某一日期員工所屬部門；限制期間不可重疊，落實同一時間只能有一個部門的定案。

| 欄位名稱         | 資料型態   | 必填性 | 欄位註釋             |
| ---------------- | ---------- | ------ | -------------------- |
| `id`             | `uuid`     | 必填   | 主鍵，資料唯一識別碼 |
| `employment_id`  | `uuid`     | 必填   | 任職紀錄外鍵         |
| `department_id`  | `uuid`     | 必填   | 部門外鍵             |
| `effective_from` | `date`     | 必填   | 生效開始日           |
| `effective_to`   | `date`     | 選填   | 生效結束日           |
| `created_at`     | `datetime` | 必填   | 建立時間             |
| `updated_at`     | `datetime` | 必填   | 最後修改時間         |

約束：同一任職在同一時間只能有一筆有效部門，期間不可重疊。由修改 UI 建立的新部門異動必須指定未來 `effective_from`；生效前不改寫目前有效紀錄。

### `job_titles`

**註釋：** 系統預設及公司自訂職稱。

**設計理由：** 職稱做成可共用主檔，避免每位員工重複輸入文字； company_id 可選是為了同時容納系統預設與公司自訂職稱。

| 欄位名稱     | 資料型態 | 必填性 | 欄位註釋             |
| ------------ | -------- | ------ | -------------------- |
| `id`         | `uuid`   | 必填   | 主鍵，資料唯一識別碼 |
| `company_id` | `uuid`   | 選填   | 所屬公司外鍵         |

### `employee_job_title_histories`

**資料表註釋：** `employee_job_title_histories` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 員工職稱另存有效期間，是為了保留升遷或改名銜前後的歷史，而不是直接覆寫目前職稱。

| 欄位名稱         | 資料型態   | 必填性 | 欄位註釋             |
| ---------------- | ---------- | ------ | -------------------- |
| `id`             | `uuid`     | 必填   | 主鍵，資料唯一識別碼 |
| `employment_id`  | `uuid`     | 必填   | 任職紀錄外鍵         |
| `job_title_id`   | `uuid`     | 必填   | 職稱外鍵             |
| `effective_from` | `date`     | 必填   | 生效開始日           |
| `effective_to`   | `date`     | 選填   | 生效結束日           |
| `created_at`     | `datetime` | 必填   | 建立時間             |
| `updated_at`     | `datetime` | 必填   | 最後修改時間         |

約束：同一任職同一時間只能有一筆有效職稱；由修改 UI 建立的新職稱異動必須指定未來 `effective_from`。

### `job_positions`

**註釋：** 職務主檔；職務與職稱分離。

**設計理由：** 職務與職稱分離，是因職稱代表名銜，職務代表實際責任；兩者變動與多人共用的方式不同，不應混在同一欄。

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋                                     |
| ------------- | ---------- | ------ | -------------------------------------------- |
| `id`          | `uuid`     | 必填   | 主鍵，資料唯一識別碼                         |
| `company_id`  | `uuid`     | 選填   | 所屬公司外鍵                                 |
| `code`        | `string`   | 必填   | 業務代碼                                     |
| `name`        | `string`   | 必填   | 顯示名稱                                     |
| `description` | `string`   | 必填   | 用途或異動說明                               |
| `is_system`   | `boolean`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `status`      | `string`   | 必填   | 狀態代碼，不使用 DB ENUM                     |
| `created_at`  | `datetime` | 必填   | 建立時間                                     |
| `updated_at`  | `datetime` | 必填   | 最後修改時間                                 |
| `deleted_at`  | `datetime` | 選填   | Soft Delete 時間                             |

### `employee_job_position_histories`

**資料表註釋：** `employee_job_position_histories` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 員工職務使用歷史關聯表，可同時存在多個有效職務並保留起訖期間，符合「職務可同時多個」的定案。

| 欄位名稱          | 資料型態   | 必填性 | 欄位註釋             |
| ----------------- | ---------- | ------ | -------------------- |
| `id`              | `uuid`     | 必填   | 主鍵，資料唯一識別碼 |
| `employment_id`   | `uuid`     | 必填   | 任職紀錄外鍵         |
| `job_position_id` | `uuid`     | 必填   | 職務外鍵             |
| `effective_from`  | `date`     | 必填   | 生效開始日           |
| `effective_to`    | `date`     | 選填   | 生效結束日           |
| `created_at`      | `datetime` | 必填   | 建立時間             |
| `updated_at`      | `datetime` | 必填   | 最後修改時間         |

約束：同一任職可同時有多個有效職務，但同一職務期間不得重疊；由修改 UI 建立的新職務異動必須指定未來 `effective_from`。

## `employee_dependents`

**註釋：** 薪資扣繳／報稅所需扶養親屬及資格條件。

**設計理由：** 眷屬資料獨立於員工，是因一名員工可有多名眷屬，且眷屬會影響扣繳等作業；獨立狀態欄可保留曾申報但已失效的關係。

| 欄位名稱                    | 資料型態   | 必填性 | 欄位註釋                                                                 |
| --------------------------- | ---------- | ------ | ------------------------------------------------------------------------ |
| `id`                        | `uuid`     | 必填   | 主鍵，資料唯一識別碼                                                     |
| `employee_id`               | `uuid`     | 必填   | 員工外鍵                                                                 |
| `name`                      | `string`   | 必填   | 顯示名稱                                                                 |
| `identity_number_encrypted` | `binary`   | 必填   | 身分證加密值                                                             |
| `identity_number_hash`      | `binary`   | 必填   | 身分證查詢 Hash                                                          |
| `birthday_encrypted`        | `binary`   | 必填   | 出生年月日加密值                                                         |
| `relationship_code`         | `integer`  | 必填   | 關係：1 配偶、2 父、3 母、4 子女、5 兄弟姊妹、6 祖父母、7 孫子女、8 其他 |
| `is_student`                | `boolean`  | 必填   | 是否為學生                                                               |
| `is_disabled`               | `boolean`  | 必填   | 是否身心障礙                                                             |
| `is_unable_to_work`         | `boolean`  | 必填   | 是否無謀生能力                                                           |
| `is_cohabiting`             | `boolean`  | 必填   | 是否同居共營生活                                                         |
| `effective_date`            | `date`     | 必填   | 開始列入扶養日期                                                         |
| `end_date`                  | `date`     | 選填   | 結束日期                                                                 |
| `status`                    | `string`   | 必填   | 狀態代碼，不使用 DB ENUM                                                 |
| `created_at`                | `datetime` | 必填   | 建立時間                                                                 |
| `updated_at`                | `datetime` | 必填   | 最後修改時間                                                             |
| `deleted_at`                | `datetime` | 選填   | Soft Delete 時間                                                         |

親屬代碼直接寫欄位註釋，不另開表：1配偶、2父親、3母親、4子女、5兄弟姊妹、6祖父母、7孫子女、8其他。

## `employee_withholding_settings`

**註釋：** 每月薪資扣繳方式及有效期間。

**設計理由：** 扣繳設定以員工為單位獨立保存，避免把會隨申報年度或家庭狀況調整的稅務選項塞入員工固定主檔。

| 欄位名稱                  | 資料型態   | 必填性 | 欄位註釋                        |
| ------------------------- | ---------- | ------ | ------------------------------- |
| `id`                      | `uuid`     | 必填   | PK                              |
| `employee_id`             | `uuid`     | 必填   | FK → `employees.id`             |
| `withholding_method_code` | `integer`  | 必填   | 1 薪資所得扣繳稅額表、2 固定 5% |
| `effective_from`          | `date`     | 必填   | 生效開始日                      |
| `effective_to`            | `date`     | 選填   | 生效結束日                      |
| `created_at`              | `datetime` | 必填   | 建立時間                        |
| `updated_at`              | `datetime` | 必填   | 修改時間                        |

約束：新增員工時扣繳方式必填；同一員工的有效期間不得重疊，修改時結束舊設定並新增一筆。

## `employee_labor_pension_settings`

**註釋：** 員工勞退自願提繳率及有效期間。

**設計理由：** 自願提繳率與所得扣繳方式是不同法規概念，且會隨時間調整，因此獨立保存，不放入 `employees` 或 `employee_withholding_settings`。

| 欄位名稱                      | 資料型態       | 必填性 | 欄位註釋                          |
| ----------------------------- | -------------- | ------ | --------------------------------- |
| `id`                          | `uuid`         | 必填   | PK                                |
| `employee_id`                 | `uuid`         | 必填   | FK → `employees.id`               |
| `voluntary_contribution_rate` | `decimal(5,4)` | 必填   | 自願提繳率，例如 6% 保存為 0.0600 |
| `effective_from`              | `date`         | 必填   | 生效開始日                        |
| `effective_to`                | `date`         | 選填   | 生效結束日                        |
| `created_by`                  | `uuid`         | 必填   | 設定者公司成員 ID                 |
| `created_at`                  | `datetime`     | 必填   | 建立時間                          |
| `updated_at`                  | `datetime`     | 必填   | 修改時間                          |

約束：同一員工的有效期間不得重疊；可選比例由有效法規資料限制，不使用 DB ENUM 寫死。

## 薪資核心

### `salary_items`

**註釋：** 系統預設或公司自訂薪資項目。

**設計理由：** 薪資項目做成主檔，可統一薪資、津貼、扣款等代碼與名稱，並讓薪資設定及薪資明細引用同一語意。

| 欄位名稱                | 資料型態   | 必填性 | 欄位註釋             |
| ----------------------- | ---------- | ------ | -------------------- |
| `id`                    | `uuid`     | 必填   | 主鍵，資料唯一識別碼 |
| `company_id`            | `uuid`     | 選填   | 所屬公司外鍵         |
| `code`                  | `string`   | 必填   | 業務代碼             |
| `name`                  | `string`   | 必填   | 顯示名稱             |
| `type_code`             | `integer`  | 必填   | 1 應發、2 扣款       |
| `calculation_type_code` | `integer`  | 必填   | 計算方式代碼         |
| `is_taxable`            | `boolean`  | 必填   | 是否計入所得稅計算   |
| `is_insurable`          | `boolean`  | 必填   | 是否計入投保薪資計算 |
| `is_active`             | `boolean`  | 必填   | 是否啟用             |
| `description`           | `string`   | 選填   | 項目說明             |
| `created_at`            | `datetime` | 必填   | 建立時間             |
| `updated_at`            | `datetime` | 必填   | 修改時間             |
| `deleted_at`            | `datetime` | 選填   | Soft Delete 時間     |

**關聯與約束：** `company_id=NULL` 表示系統預設項目，非 NULL 表示公司自訂項目；公司內 `code` 不得重複。薪資項目只是定義，當期名稱與金額仍須 Snapshot 到 `payroll_details`。

### `employee_salary_settings`

**註釋：** 任職的長期薪資項目設定與調薪歷史。

**設計理由：** 員工薪資設定將「某員工適用某薪資項目及其金額／規則」獨立保存，讓不同員工可共用項目，同時不改動歷史薪資單。

| 欄位名稱                | 資料型態   | 必填性 | 欄位註釋                                     |
| ----------------------- | ---------- | ------ | -------------------------------------------- |
| `id`                    | `uuid`     | 必填   | 主鍵，資料唯一識別碼                         |
| `employment_id`         | `uuid`     | 必填   | 任職紀錄外鍵                                 |
| `salary_item_id`        | `uuid`     | 必填   | 薪資項目外鍵                                 |
| `calculation_type_code` | `integer`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `amount`                | `decimal`  | 必填   | 金額或計算基礎值                             |
| `start_date`            | `date`     | 必填   | 開始日期                                     |
| `end_date`              | `date`     | 選填   | 結束日期                                     |
| `description`           | `string`   | 必填   | 用途或異動說明                               |
| `created_at`            | `datetime` | 必填   | 建立時間                                     |
| `updated_at`            | `datetime` | 必填   | 最後修改時間                                 |
| `deleted_at`            | `datetime` | 選填   | Soft Delete 時間                             |

### `payroll_settings`

**資料表名稱：** `payroll_settings`

**註釋：** 公司計薪週期與發薪制度；設定與每期計薪結果分離。

| 欄位名稱                 | 資料型態   | 必填性 | 欄位註釋            |
| ------------------------ | ---------- | ------ | ------------------- |
| `id`                     | `uuid`     | 必填   | PK                  |
| `company_id`             | `uuid`     | 必填   | FK → `companies.id` |
| `payroll_frequency_code` | `integer`  | 必填   | 計薪頻率代碼        |
| `payroll_start_day`      | `integer`  | 必填   | 計薪週期起日        |
| `payroll_end_day`        | `integer`  | 必填   | 計薪週期迄日        |
| `payday_type_code`       | `integer`  | 必填   | 發薪日規則類型代碼  |
| `payday`                 | `integer`  | 必填   | 發薪日              |
| `description`            | `string`   | 選填   | 設定說明            |
| `created_at`             | `datetime` | 必填   | 建立時間            |
| `updated_at`             | `datetime` | 必填   | 修改時間            |

**設計理由：** 薪資制度的公司級參數集中於設定表，可避免每一期薪資重複保存相同規則，也便於公司分別設定。

**關聯：** `company_id → companies.id`。

**約束：** 每家公司使用自己的計薪設定；週期起訖與發薪日必須符合 `payroll_frequency_code`、`payday_type_code` 所代表的規則。設定只負責產生新計薪期間，不得回頭修改既有 `payroll_periods` 或已結算薪資。

### `payroll_periods`

**註釋：** 實際計薪期間，如 26 日至次月 25 日；包含期間開始、結束與發薪日。

**設計理由：** 薪資期間獨立成表，可先界定計薪起訖與處理狀態，讓同一期的多名員工薪資共用同一期間並防止期間語意散落。

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋                                                |
| ------------- | ---------- | ------ | ------------------------------------------------------- |
| `id`          | `uuid`     | 必填   | PK，計薪期間 ID                                         |
| `company_id`  | `uuid`     | 必填   | FK → `companies.id`                                     |
| `period_code` | `string`   | 必填   | 計薪期間代碼，例如 `202608`                             |
| `start_date`  | `date`     | 必填   | 計薪開始日期                                            |
| `end_date`    | `date`     | 必填   | 計薪結束日期                                            |
| `pay_date`    | `date`     | 必填   | 預定發薪日期                                            |
| `status_code` | `integer`  | 必填   | 計薪期間狀態；後期定案採 code，不採早期 `status string` |
| `created_at`  | `datetime` | 必填   | 建立時間                                                |
| `updated_at`  | `datetime` | 必填   | 修改時間                                                |

**關聯與約束：** `company_id → companies.id`；同一公司 `period_code` 不得重複；`start_date ≤ end_date`。`payroll_settings` 是週期規則，本表是實際生成的計薪期間。

### `payrolls`

**註釋：** 員工某計薪期薪資單／結算主檔；保存應發、扣款、實發與鎖定狀態。

**設計理由：** 薪資單以員工與薪資期間為核心保存一次計算結果，使後續設定變更不會回頭改寫已結算結果。

| 欄位名稱                   | 資料型態   | 必填性   | 欄位註釋                              |
| -------------------------- | ---------- | -------- | ------------------------------------- |
| `id`                       | `uuid`     | 必填     | PK，薪資單 ID                         |
| `payroll_period_id`        | `uuid`     | 必填     | FK → `payroll_periods.id`             |
| `employee_id`              | `uuid`     | 必填     | FK → `employees.id`                   |
| `employment_id`            | `uuid`     | 必填     | FK → `employee_employments.id`        |
| `gross_amount`             | `decimal`  | 必填     | 應發總額                              |
| `deduction_amount`         | `decimal`  | 必填     | 扣款總額                              |
| `net_amount`               | `decimal`  | 必填     | 實發金額                              |
| `status_code`              | `integer`  | 必填     | 薪資單生命週期狀態                    |
| `approved_by`              | `uuid`     | 選填     | 核准人員 ID                           |
| `approved_at`              | `datetime` | 選填     | 核准時間                              |
| `paid_at`                  | `datetime` | 選填     | 實際發薪時間                          |
| `company_name_snapshot`    | `string`   | 必填     | 結算當時的公司名稱；歷史薪資單顯示值  |
| `employee_code_snapshot`   | `string`   | 必填     | 結算當時的員工編號                    |
| `employee_name_snapshot`   | `string`   | 必填     | 結算當時的員工姓名                    |
| `department_name_snapshot` | `string`   | 條件必填 | 結算當時的部門名稱；無部門時可為 NULL |
| `job_title_name_snapshot`  | `string`   | 選填     | 結算當時的職稱名稱                    |
| `created_at`               | `datetime` | 必填     | 建立時間                              |
| `updated_at`               | `datetime` | 必填     | 修改時間                              |

**關聯與約束：** 原則上 `UNIQUE(payroll_period_id, employee_id)`；同一薪資單的 `employment_id` 必須屬於該員工。核准、發薪、結算後不得因調薪或法規更新重算覆蓋；錯誤於後續期間補發／扣回。

### `payroll_attendance_snapshots`

**資料表註釋：** 薪資結算當下實際採用的出勤、工時、加班、請假與異常摘要；供歷史薪資單顯示與稽核。

**設計理由：** 出勤結果日後可能因重算或資料修正改變，薪資單必須保留結算時真正採用的數值，才能持續說明當期薪資計算依據。

| 欄位名稱           | 資料型態       | 必填性 | 欄位註釋                               |
| ------------------ | -------------- | ------ | -------------------------------------- |
| `id`               | `uuid`         | 必填   | PK                                     |
| `payroll_id`       | `uuid`         | 必填   | FK → `payrolls.id`；一張薪資單一筆快照 |
| `attendance_days`  | `decimal(6,2)` | 必填   | 結算採用的出勤天數；支援半日           |
| `worked_minutes`   | `integer`      | 必填   | 結算採用的實際工時分鐘                 |
| `overtime_minutes` | `integer`      | 必填   | 結算採用的核准加班分鐘                 |
| `leave_minutes`    | `integer`      | 必填   | 結算採用的請假分鐘                     |
| `late_days`        | `integer`      | 必填   | 結算採用的遲到天數                     |
| `early_leave_days` | `integer`      | 必填   | 結算採用的早退天數                     |
| `absence_days`     | `decimal(6,2)` | 必填   | 結算採用的缺勤天數；支援部分日         |
| `created_at`       | `datetime`     | 必填   | 快照建立時間                           |

**關聯與約束：** `UNIQUE(payroll_id)`；所有數值不得為負；薪資結算後不可修改。分鐘於 UI 換算成小時，但資料仍以分鐘保存。

### 已確認的本人薪資單 UI

- 員工只看得到本人已結算薪資單；不另設發布狀態。
- 列表顯示期間、發薪日、應發、扣款、實發及發放狀態，操作只提供查看。
- 不提供 PDF、下載或匯出。
- 結算時保存公司、員工編號、姓名、部門及職稱顯示快照。
- 結算時保存全部出勤計薪摘要，不得查看時即時重算。
- 詳細規劃見 [16-ui-my-payroll.md](../ui/16-ui-my-payroll.md)。

### `payroll_details`

**註釋：** 當期實際薪資明細，可來自長期設定、系統計算、臨時新增或人工調整。

**設計理由：** 薪資明細逐項保存金額，是為了說明薪資總額由哪些薪資項目組成，支援稽核與重新核對，而不是只留彙總數字。

| 欄位名稱           | 資料型態   | 必填性 | 欄位註釋                                           |
| ------------------ | ---------- | ------ | -------------------------------------------------- |
| `id`               | `uuid`     | 必填   | PK，薪資明細 ID                                    |
| `payroll_id`       | `uuid`     | 必填   | FK → `payrolls.id`                                 |
| `salary_item_id`   | `uuid`     | 選填   | FK → `salary_items.id`；臨時項目可為 NULL          |
| `item_name`        | `string`   | 必填   | 薪資項目名稱快照，避免主檔改名影響歷史             |
| `type_code`        | `integer`  | 必填   | 1 應發、2 扣款                                     |
| `source_type_code` | `integer`  | 必填   | 1 員工薪資設定、2 系統計算、3 臨時新增、4 人工調整 |
| `amount`           | `decimal`  | 必填   | 當期實際金額                                       |
| `description`      | `string`   | 選填   | 明細說明／人工調整原因                             |
| `created_at`       | `datetime` | 必填   | 建立時間                                           |
| `updated_at`       | `datetime` | 必填   | 修改時間                                           |

**關聯與約束：** `payroll_id → payrolls.id`。臨時項目可不建永久 `salary_items`，但必須保留 `item_name`、來源、金額與原因；不修改 `employee_salary_settings`。薪資核准／結算後明細不可直接改寫。

### `employee_salary_bank_accounts`

**註釋：** 員工發薪銀行帳戶；敏感帳號需加密。

**設計理由：** 薪轉帳戶獨立保存，可支援員工帳戶異動與敏感金融資料管理，避免銀行欄位長期固定在員工主檔。

| 欄位名稱                   | 資料型態    | 必填性 | 欄位註釋                  |
| -------------------------- | ----------- | ------ | ------------------------- |
| `id`                       | `uuid`      | 必填   | PK，銀行帳戶 ID           |
| `employee_id`              | `uuid`      | 必填   | FK → `employees.id`       |
| `bank_code`                | `string`    | 必填   | 銀行代碼                  |
| `branch_code`              | `string`    | 必填   | 分行代碼                  |
| `account_number_encrypted` | `varbinary` | 必填   | 銀行帳號加密值            |
| `account_number_hash`      | `varbinary` | 必填   | 銀行帳號查詢 Hash         |
| `account_name_encrypted`   | `varbinary` | 必填   | 戶名加密值                |
| `is_primary`               | `boolean`   | 必填   | 是否主要發薪帳戶          |
| `status_code`              | `integer`   | 必填   | 帳戶狀態；後期定案採 code |
| `effective_from`           | `date`      | 必填   | 帳戶生效開始日            |
| `effective_to`             | `date`      | 選填   | 帳戶生效結束日            |
| `created_at`               | `datetime`  | 必填   | 建立時間                  |
| `updated_at`               | `datetime`  | 必填   | 修改時間                  |
| `deleted_at`               | `datetime`  | 選填   | Soft Delete 時間          |

**關聯與約束：** `employee_id → employees.id`；同一員工可有多個帳戶，但同時間只能有一個主要帳戶。帳號不得明文保存。修改薪轉銀行或帳號時結束舊紀錄並新增一筆，不覆蓋歷史。

### `payroll_payments`

**註釋：** 實際薪資發放方式、時間、金額與結果。

**設計理由：** 付款紀錄與薪資單分離，因一張薪資單的計算完成與實際付款是不同事件，也可能有重送、失敗或分次付款紀錄。

| 欄位名稱              | 資料型態   | 必填性       | 欄位註釋                                                 |
| --------------------- | ---------- | ------------ | -------------------------------------------------------- |
| `id`                  | `uuid`     | 必填         | PK，發薪紀錄 ID                                          |
| `payroll_id`          | `uuid`     | 必填         | FK → `payrolls.id`                                       |
| `payment_method_code` | `integer`  | 必填         | 1 銀行轉帳、2 現金、3 支票                               |
| `bank_account_id`     | `uuid`     | 選填         | FK → `employee_salary_bank_accounts.id`；非轉帳可為 NULL |
| `amount`              | `decimal`  | 必填         | 實際發放金額                                             |
| `payment_status_code` | `integer`  | 必填         | 發放狀態代碼                                             |
| `paid_at`             | `datetime` | 必填性依狀態 | 實際發放時間；未發放時可為 NULL                          |
| `reference_number`    | `string`   | 選填         | 銀行交易或公司內部交易編號                               |
| `description`         | `string`   | 選填         | 發放說明                                                 |
| `created_at`          | `datetime` | 必填         | 建立時間                                                 |
| `updated_at`          | `datetime` | 必填         | 修改時間                                                 |

**關聯與約束：** 銀行轉帳時 `bank_account_id` 條件必填，且帳戶必須屬於該薪資單員工；付款紀錄不得取代或修改薪資計算結果。

## 人事成本

人事成本與員工實領薪資分離：Payroll 回答員工實際領多少，人事成本則保存公司為員工承擔的薪資、保險、勞退、福利與其他成本。

### `personnel_cost_items`

**資料表註釋：** `personnel_cost_items` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 人事成本項目獨立成可引用主檔，讓薪資、保險、退休金及其他雇主成本使用一致分類，而不以自由文字散落。

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋                                     |
| ------------- | ---------- | ------ | -------------------------------------------- |
| `id`          | `uuid`     | 必填   | 主鍵，資料唯一識別碼                         |
| `company_id`  | `uuid`     | 選填   | 所屬公司外鍵                                 |
| `code`        | `string`   | 必填   | 業務代碼                                     |
| `name`        | `string`   | 必填   | 顯示名稱                                     |
| `type_code`   | `integer`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `is_active`   | `boolean`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `description` | `string`   | 必填   | 用途或異動說明                               |
| `created_at`  | `datetime` | 必填   | 建立時間                                     |
| `updated_at`  | `datetime` | 必填   | 最後修改時間                                 |
| `deleted_at`  | `datetime` | 選填   | Soft Delete 時間                             |

### `personnel_costs`

**註釋：** 某員工在某成本期間的實際公司負擔。

**設計理由：** 實際人事成本逐員工、期間及項目留存，才能與薪資付款區分並進行成本分析；薪資是員工所得，人事成本還包含雇主負擔。

| 欄位名稱                 | 資料型態   | 必填性 | 欄位註釋                                     |
| ------------------------ | ---------- | ------ | -------------------------------------------- |
| `id`                     | `uuid`     | 必填   | 主鍵，資料唯一識別碼                         |
| `company_id`             | `uuid`     | 必填   | 所屬公司外鍵                                 |
| `employee_id`            | `uuid`     | 必填   | 員工外鍵                                     |
| `employment_id`          | `uuid`     | 必填   | 任職紀錄外鍵                                 |
| `personnel_cost_item_id` | `uuid`     | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `payroll_id`             | `uuid`     | 選填   | 薪資結算外鍵                                 |
| `cost_date`              | `date`     | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `cost_period`            | `string`   | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `amount`                 | `decimal`  | 必填   | 金額或計算基礎值                             |
| `source_type_code`       | `integer`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `description`            | `string`   | 必填   | 用途或異動說明                               |
| `created_at`             | `datetime` | 必填   | 建立時間                                     |
| `updated_at`             | `datetime` | 必填   | 最後修改時間                                 |
