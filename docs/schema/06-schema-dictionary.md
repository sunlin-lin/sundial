# HR Schema 表格化資料字典

> 本文件統一使用：資料表定義表＋逐欄資料表。`選填` 表示可為 NULL；`條件必填` 表示依主體或流程狀態決定。

## 角色與權限

### `roles`

| 項目       | 內容                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| 資料表註釋 | 公司角色主檔；角色是一組權限，不預先寫死 HR、主管或會計等角色。                                              |
| 關聯       | `company_id → companies.id`；`roles N:N permissions`。                                                       |
| 約束       | 公司內角色代碼應唯一；Soft Delete。                                                                          |
| 設計理由   | 角色以公司為範圍並保留系統／自訂區別，讓字典清楚反映角色可配置而非固定職稱；其設計來源與 01 的角色主檔一致。 |

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋            |
| ------------- | ---------- | ------ | ------------------- |
| `id`          | `uuid`     | 必填   | PK，角色唯一識別碼  |
| `company_id`  | `uuid`     | 必填   | FK，所屬公司        |
| `code`        | `string`   | 必填   | 公司內角色代碼      |
| `name`        | `string`   | 必填   | 角色名稱            |
| `description` | `string`   | 選填   | 角色用途說明        |
| `is_system`   | `boolean`  | 必填   | 是否系統預設角色    |
| `status`      | `string`   | 必填   | 角色狀態；不用 ENUM |
| `created_at`  | `datetime` | 必填   | 建立時間            |
| `updated_at`  | `datetime` | 必填   | 修改時間            |
| `deleted_at`  | `datetime` | 選填   | Soft Delete 時間    |

### `permissions`

| 項目       | 內容                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 資料表註釋 | 系統權限主檔；透過自關聯建立任意層級權限樹。                                                               |
| 關聯       | `parent_id → permissions.id`。                                                                             |
| 約束       | `parent_id=NULL` 為根權限；不使用 `permission_type`。                                                      |
| 設計理由   | 權限以自關聯呈現任意層級，字典保留 parent_id 的空值與外鍵語意，避免另造 permission_type 導致層級資訊重複。 |

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋                  |
| ------------- | ---------- | ------ | ------------------------- |
| `id`          | `uuid`     | 必填   | PK                        |
| `parent_id`   | `uuid`     | 選填   | FK，父權限；根節點為 NULL |
| `code`        | `string`   | 必填   | 權限唯一代碼              |
| `name`        | `string`   | 必填   | 權限名稱                  |
| `description` | `string`   | 選填   | 權限用途                  |
| `status`      | `string`   | 必填   | 權限狀態                  |
| `created_at`  | `datetime` | 必填   | 建立時間                  |
| `updated_at`  | `datetime` | 必填   | 修改時間                  |
| `deleted_at`  | `datetime` | 選填   | Soft Delete               |

### `role_permissions`

| 項目       | 內容                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- |
| 資料表註釋 | 角色與權限多對多關聯表。                                                                     |
| 關聯       | `role_id → roles.id`；`permission_id → permissions.id`。                                     |
| 約束       | `UNIQUE(role_id, permission_id)`；不需要獨立 ID。                                            |
| 設計理由   | 多對多關聯只需要兩個外鍵與建立時間；複合唯一鍵已能防止重複授權，因此字典明確不增加獨立主鍵。 |

| 欄位名稱        | 資料型態   | 必填性 | 欄位註釋 |
| --------------- | ---------- | ------ | -------- |
| `role_id`       | `uuid`     | 必填   | FK，角色 |
| `permission_id` | `uuid`     | 必填   | FK，權限 |
| `created_at`    | `datetime` | 必填   | 綁定時間 |

## 組織與人事

### `departments`

| 項目       | 內容                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| 資料表註釋 | 公司部門主檔，以自關聯建立無限層級組織樹。                                                                  |
| 關聯       | `company_id → companies.id`；`parent_id → departments.id`。                                                 |
| 約束       | 父子部門必須同公司；根部門 `parent_id=NULL`。                                                               |
| 設計理由   | 部門樹必須攜帶公司範圍並限制父子同 Tenant，字典重申此約束是為了讓實作不只建立一般自關聯，卻漏掉多租戶隔離。 |

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋     |
| ------------- | ---------- | ------ | ------------ |
| `id`          | `uuid`     | 必填   | PK           |
| `company_id`  | `uuid`     | 必填   | FK，所屬公司 |
| `parent_id`   | `uuid`     | 選填   | FK，上層部門 |
| `code`        | `string`   | 必填   | 部門代碼     |
| `name`        | `string`   | 必填   | 部門名稱     |
| `description` | `string`   | 選填   | 部門說明     |
| `status`      | `string`   | 必填   | 部門狀態     |
| `created_at`  | `datetime` | 必填   | 建立時間     |
| `updated_at`  | `datetime` | 必填   | 修改時間     |
| `deleted_at`  | `datetime` | 選填   | Soft Delete  |

### `employees`

| 項目       | 內容                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| 資料表註釋 | 員工個人主檔，只保存「這個人」；任職、部門、職稱、職務及薪資另存歷史。                                   |
| 關聯       | `company_id → companies.id`。                                                                            |
| 約束       | `UNIQUE(company_id, employee_code)`；不含 `status`、到職／離職日期。                                     |
| 設計理由   | 員工字典只描述人員身分與加密個資，刻意排除任職狀態及日期，避免實作者把 02 已分離的生命週期欄位加回主檔。 |

| 欄位名稱                    | 資料型態   | 必填性 | 欄位註釋            |
| --------------------------- | ---------- | ------ | ------------------- |
| `id`                        | `uuid`     | 必填   | PK                  |
| `company_id`                | `uuid`     | 必填   | FK，所屬公司        |
| `employee_code`             | `string`   | 必填   | 公司內員工編號      |
| `name`                      | `string`   | 必填   | 姓名                |
| `gender`                    | `string`   | 必填   | 性別代碼，不用 ENUM |
| `identity_number_encrypted` | `binary`   | 必填   | 身分證加密值        |
| `identity_number_hash`      | `binary`   | 必填   | 身分證查詢 Hash     |
| `birthday_encrypted`        | `binary`   | 選填   | 生日加密值          |
| `phone_encrypted`           | `binary`   | 選填   | 電話加密值          |
| `email_encrypted`           | `binary`   | 選填   | Email 加密值        |
| `address_encrypted`         | `binary`   | 選填   | 地址加密值          |
| `created_at`                | `datetime` | 必填   | 建立時間            |
| `updated_at`                | `datetime` | 必填   | 修改時間            |
| `deleted_at`                | `datetime` | 選填   | Soft Delete         |

### `employee_employments`

| 項目       | 內容                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 資料表註釋 | 員工每一次任職關係；重新入職建立新紀錄。                                                                   |
| 關聯       | `employee_id → employees.id`。                                                                             |
| 約束       | `employment_sequence` 不採用；離職日不得早於到職日。                                                       |
| 設計理由   | 任職字典以每次受僱關係為單位，使回任能新增紀錄而非覆寫舊資料；保留已恢復欄位，不自行補上未可靠確認的欄位。 |

| 欄位名稱                 | 資料型態   | 必填性       | 欄位註釋                                                     |
| ------------------------ | ---------- | ------------ | ------------------------------------------------------------ |
| `id`                     | `uuid`     | 必填         | PK                                                           |
| `employee_id`            | `uuid`     | 必填         | FK，員工                                                     |
| `employment_type_code`   | `integer`  | 必填         | 1正職、2兼職、3約聘、4派遣、5工讀、6臨時、7顧問、8實習       |
| `employment_nature_code` | `integer`  | 必填性待確認 | 任職性質代碼；原對話確認存在，但未可靠確認代碼值與 NULL 規則 |
| `hire_date`              | `date`     | 必填         | 到職日                                                       |
| `leave_date`             | `date`     | 選填         | 離職日                                                       |
| `leave_reason_code`      | `integer`  | 選填         | 離職原因代碼                                                 |
| `status`                 | `string`   | 必填         | 本次任職狀態                                                 |
| `created_at`             | `datetime` | 必填         | 建立時間                                                     |
| `updated_at`             | `datetime` | 必填         | 修改時間                                                     |
| `deleted_at`             | `datetime` | 選填         | Soft Delete                                                  |

## 其餘資料表格式索引

下列表格提供每張表的資料表註釋；其逐欄表格分別位於主題文件中，後續不得再使用行內欄位清單格式。

| 資料表名稱                          | 資料表註釋                                     |
| ----------------------------------- | ---------------------------------------------- |
| `employee_department_histories`     | 員工部門有效期間歷史；同時間只能一個有效部門。 |
| `job_titles`                        | 系統預設及公司自訂職稱主檔。                   |
| `employee_job_title_histories`      | 員工職稱／升遷有效期間歷史。                   |
| `job_positions`                     | 職務主檔；與職稱分離。                         |
| `employee_job_position_histories`   | 員工職務歷史；同時間可有多筆有效職務。         |
| `employee_dependents`               | 扣繳／報稅所需扶養親屬及資格條件。             |
| `employee_withholding_settings`     | 員工每月薪資扣繳方式及生效歷史。               |
| `salary_items`                      | 系統預設或公司自訂薪資項目定義。               |
| `employee_salary_settings`          | 任職的長期薪資設定與調薪歷史。                 |
| `payroll_settings`                  | 公司計薪週期及發薪規則。                       |
| `payroll_periods`                   | 實際計薪起訖與發薪日期。                       |
| `payrolls`                          | 員工某期薪資結算主檔。                         |
| `payroll_details`                   | 當期實際應發、扣款與人工調整明細。             |
| `payroll_payments`                  | 實際薪資付款結果。                             |
| `employee_salary_bank_accounts`     | 員工加密發薪銀行帳戶。                         |
| `personnel_cost_items`              | 人事成本項目定義。                             |
| `personnel_costs`                   | 員工某期間實際公司負擔成本。                   |
| `shift_definitions`                 | 班別主檔。                                     |
| `shift_work_periods`                | 班別工作區段。                                 |
| `shift_breaks`                      | 班別休息區段。                                 |
| `schedule_rules`                    | 固定週班或任意長度循環排班規則。               |
| `schedule_rule_details`             | 排班週期每一節點的班別及日期性質。             |
| `schedule_periods`                  | 一次正式排班／發布期間。                       |
| `employee_schedules`                | 員工某日最終有效班表快照。                     |
| `schedule_changes`                  | 已發布班表異動歷史。                           |
| `attendance_records`                | 正常或補登形成的正式打卡事件。                 |
| `attendance_correction_requests`    | 上班／下班分開的補登申請。                     |
| `attendance_settings`               | 公司打卡規則。                                 |
| `attendance_results`                | 依班表與打卡計算的出勤判定。                   |
| `overtime_requests`                 | 加班申請。                                     |
| `overtime_approvals`                | 加班審核歷史。                                 |
| `overtime_compensations`            | 加班最終補償方式。                             |
| `compensatory_leave_credits`        | 補休額度批次。                                 |
| `compensatory_leave_rate_snapshots` | 補休核發時計價基準快照。                       |
| `compensatory_leave_transactions`   | 補休不可變交易帳本。                           |
| `compensatory_leave_allocations`    | 補休使用對額度批次的分配。                     |
| `leave_types`                       | 假別定義。                                     |
| `leave_type_rules`                  | 假別規則及有效期間。                           |
| `leave_entitlements`                | 員工一般假額度批次。                           |
| `leave_balances`                    | 假別餘額彙總。                                 |
| `leave_balance_transactions`        | 假額度不可變交易帳本。                         |
| `leave_requests`                    | 請假申請主單。                                 |
| `leave_request_details`             | 請假日期、時段及假別明細。                     |
| `leave_request_approvals`           | 請假審核歷史。                                 |
| `leave_request_allocations`         | 請假實際扣用額度批次。                         |
| `leave_request_documents`           | 請假證明文件。                                 |
| `leave_events`                      | 特殊假別事件來源。                             |
| `company_leave_grant_batches`       | 公司贈與假批次共同條件。                       |
| `company_leave_grants`              | 每位員工的實際贈與結果。                       |
| `company_regulatory_settings`       | 公司投保及職災行業設定歷史。                   |
| `regulatory_dataset_versions`       | 政府法規資料版本與原始快照。                   |
| `regulatory_records`                | Payroll 可查詢的標準化法規資料。               |
| `regulatory_sync_logs`              | 法規同步執行結果。                             |
