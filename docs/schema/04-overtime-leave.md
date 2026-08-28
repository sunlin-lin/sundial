# 加班、補休、請假與公司贈與假

## 加班

### `overtime_requests`

**註釋：** 員工加班申請，保存日期、起訖、分鐘、原因、班表關聯與流程狀態。

**設計理由：** 加班申請保存員工提出的日期、時數與原因，是流程來源；不直接以打卡超時當成已核准加班，避免出勤事實與申請資格混淆。

| 欄位名稱                 | 資料型態   | 必填性 | 欄位註釋                                     |
| ------------------------ | ---------- | ------ | -------------------------------------------- |
| `id`                     | `bigint`   | 必填   | PK，加班申請 ID                              |
| `employee_id`            | `bigint`   | 必填   | FK → `employees.id`                          |
| `schedule_id`            | `bigint`   | 必填   | FK → `employee_schedules.id`，申請時所依班表 |
| `start_at`               | `datetime` | 必填   | 申請加班開始時間；支援跨日                   |
| `end_at`                 | `datetime` | 必填   | 申請加班結束時間；支援跨日                   |
| `requested_minutes`      | `integer`  | 必填   | 依起訖計算的申請分鐘數                       |
| `compensation_type_code` | `integer`  | 必填   | 1 加班費、2 補休；一筆不可拆分               |
| `reason`                 | `text`     | 必填   | 加班事由；本輪 UI 與流程定案要求必填         |
| `status_code`            | `integer`  | 必填   | 1 待審核、2 核准、3 拒絕、4 撤回、5 取消     |
| `applied_at`             | `datetime` | 必填   | 申請時間                                     |
| `approved_at`            | `datetime` | 選填   | 核准時間                                     |
| `approved_by`            | `bigint`   | 選填   | 核准者                                       |
| `rejected_at`            | `datetime` | 選填   | 拒絕時間                                     |
| `rejected_by`            | `bigint`   | 選填   | 拒絕者                                       |
| `rejection_reason`       | `text`     | 選填   | 拒絕原因                                     |
| `created_at`             | `datetime` | 必填   | 建立時間                                     |
| `updated_at`             | `datetime` | 必填   | 修改時間                                     |

**約束：** `end_at > start_at`；`requested_minutes > 0`；申請被拒後以新申請重送，不修改舊申請。實際打卡超過申請區間不自動增加認列分鐘。

### 已確認的本人加班申請 UI 與流程

- 列表顯示日期、時段、日別、出勤、計酬、加班費、事由、狀態及操作。
- 申請日期必須已有可配對的完整有效上班卡與下班卡；補卡核准前、缺卡或只有單一卡時不可申請。
- 可申請區間為有效出勤扣除正常班表時段；員工仍需自行選擇實際加班起訖。
- 不接受未來日期預先申請，已結算月份不得申請。
- 計酬方式為加班費或補休，一筆不可拆分；事由必填。
- 本人提出且尚未審核的申請可自行撤銷；資料保留為已撤回，不得 DELETE。
- 打卡被待審核加班引用時，需先撤回申請才能撤銷打卡；已核准加班所依打卡不得由員工直接撤銷。
- 詳細規劃見 [15-ui-my-overtime.md](../ui/15-ui-my-overtime.md)。

### `overtime_approvals`

**註釋：** 加班核准、拒絕、撤回等審核歷史。

**設計理由：** 審核紀錄獨立成表，可保存多關卡、每次決定與時間，不以申請表上的單一狀態覆蓋審核歷程。

| 欄位名稱              | 資料型態   | 必填性   | 欄位註釋                                       |
| --------------------- | ---------- | -------- | ---------------------------------------------- |
| `id`                  | `bigint`   | 必填     | PK，審核紀錄 ID                                |
| `overtime_request_id` | `bigint`   | 必填     | FK → `overtime_requests.id`                    |
| `action_code`         | `integer`  | 必填     | 1 核准、2 退回、3 撤銷核准、4 撤銷退回、5 取消 |
| `action_by`           | `bigint`   | 必填     | 執行者                                         |
| `action_at`           | `datetime` | 必填     | 執行時間                                       |
| `reason`              | `text`     | 條件必填 | 退回、撤銷核准及撤銷退回時必填                 |
| `created_at`          | `datetime` | 必填     | 建立時間                                       |

**約束：** 審核歷史只新增、不覆寫；申請主檔狀態是目前狀態，本表才是完整流程軌跡。

### 已確認的加班簽核 UI 與撤銷規則

- 進入預設顯示待審核，第 1 頁，每頁 20 筆，等待最久優先。
- 列表顯示員工、部門、日期、日別、申請時段、有效出勤、時數、計酬、事由及狀態。
- 審核者不得修改申請時間，也不得部分核准；只能整筆核准或退回。
- 核准時認列分鐘必須等於申請分鐘；部分不符即整筆退回。
- 薪資尚未核算時，可撤銷核准或撤銷退回並回到待審核。
- 補休尚未使用時，可先撤銷補休額度再撤銷加班核准；已使用則不可直接撤銷。
- 薪資開始核算或加班費已進入薪資後不可撤銷。
- 詳細規劃見 [18-ui-overtime-approval.md](../ui/18-ui-overtime-approval.md)。

### `overtime_compensations`

**資料表註釋：** `overtime_compensations` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 加班補償與申請分開，是因核准加班可選加班費、補休或其他已確認方式；補償是核准後的處置結果，不是申請本身。

| 欄位名稱                 | 資料型態   | 必填性 | 欄位註釋                    |
| ------------------------ | ---------- | ------ | --------------------------- |
| `id`                     | `bigint`   | 必填   | PK，補償處理 ID             |
| `overtime_request_id`    | `bigint`   | 必填   | FK → `overtime_requests.id` |
| `compensation_type_code` | `integer`  | 必填   | 1 加班費、2 補休            |
| `recognized_minutes`     | `integer`  | 必填   | 最終認列加班分鐘數          |
| `status_code`            | `integer`  | 必填   | 1 有效、2 撤銷              |
| `processed_at`           | `datetime` | 必填   | 處理時間                    |
| `processed_by`           | `bigint`   | 必填   | 處理者                      |
| `cancelled_at`           | `datetime` | 選填   | 撤銷時間                    |
| `cancelled_by`           | `bigint`   | 選填   | 撤銷者                      |
| `cancel_reason`          | `text`     | 選填   | 撤銷原因                    |
| `created_at`             | `datetime` | 必填   | 建立時間                    |

**約束：** 同一加班申請同時間只能有一筆有效補償；不得同時拆成加班費與補休。撤銷後重新核發必須新增處理與 Snapshot，不得 UPDATE 舊資料。 核准時 `recognized_minutes` 必須等於 `overtime_requests.requested_minutes`，不允許部分核准。撤銷核准時本表標記撤銷而不刪除；補休已被使用或薪資已開始核算時不得直接撤銷。

## 補休

### `compensatory_leave_credits`

**註釋：** 每筆來源產生的補休額度批次。

**設計理由：** 補休額度逐筆建立來源與到期日，才能追蹤每一筆加班轉換出的可用時數，並依來源處理使用及失效。

| 欄位名稱           | 資料型態     | 必填性 | 欄位註釋                                     |
| ------------------ | ------------ | ------ | -------------------------------------------- |
| `id`               | `型態待恢復` | 待核對 | 主鍵，資料唯一識別碼                         |
| `company_id`       | `型態待恢復` | 待核對 | 所屬公司外鍵                                 |
| `employee_id`      | `型態待恢復` | 待核對 | 員工外鍵                                     |
| `employment_id`    | `型態待恢復` | 待核對 | 任職紀錄外鍵                                 |
| `source_type_code` | `型態待恢復` | 待核對 | 欄位已確認；代碼值或額外約束未在定案節點明定 |

### `compensatory_leave_rate_snapshots`

**註釋：** 補休核發者所選計價基準及計算所需薪資／規則 Snapshot。後續調薪不得改變；到期轉薪使用原 Snapshot。

**設計理由：** 換算倍率保存快照，是為了讓額度沿用核准當時的法規或公司規則；日後倍率改變不應回算既有補休。

| 欄位名稱                       | 資料型態        | 必填性 | 欄位註釋                             |
| ------------------------------ | --------------- | ------ | ------------------------------------ |
| `id`                           | `bigint`        | 必填   | PK，Snapshot ID                      |
| `compensatory_leave_credit_id` | `bigint`        | 必填   | FK → `compensatory_leave_credits.id` |
| `rate_rule_id`                 | `bigint`        | 必填   | 核發者當時選用的計價規則 ID          |
| `base_amount`                  | `decimal(12,2)` | 必填   | 當時採用的薪資基準金額               |
| `hourly_rate`                  | `decimal(12,4)` | 必填   | 當時換算出的時薪                     |
| `calculation_snapshot`         | `json`          | 必填   | 規則與薪資輸入的完整計算快照         |
| `selected_by`                  | `bigint`        | 必填   | 選擇計價基準的核發者                 |
| `selected_at`                  | `datetime`      | 必填   | 選擇／核發時間                       |
| `created_at`                   | `datetime`      | 必填   | 建立時間                             |

**約束：** Snapshot 建立後不可修改；後續調薪不影響既有補休價值。到期轉薪仍使用此 Snapshot；撤銷重發需建立新額度及新 Snapshot。

### `compensatory_leave_transactions`

**註釋：** 取得、預約／凍結、使用、取消返還、調整、撤銷、到期轉薪等不可變帳本。

**設計理由：** 補休交易採不可只靠餘額的流水紀錄，可完整表達取得、使用、調整與到期，讓目前餘額能被稽核重建。

| 欄位名稱                       | 資料型態      | 必填性 | 欄位註釋                                               |
| ------------------------------ | ------------- | ------ | ------------------------------------------------------ |
| `id`                           | `bigint`      | 必填   | PK，交易 ID                                            |
| `compensatory_leave_credit_id` | `bigint`      | 必填   | FK → `compensatory_leave_credits.id`                   |
| `transaction_type_code`        | `integer`     | 必填   | 1 取得、2 預約、3 使用、4 取消返還、5 到期轉薪、6 撤銷 |
| `minutes`                      | `integer`     | 必填   | 本次異動分鐘數                                         |
| `reference_type`               | `varchar(50)` | 選填   | 來源類型                                               |
| `reference_id`                 | `bigint`      | 選填   | 來源資料 ID                                            |
| `occurred_at`                  | `datetime`    | 必填   | 實際發生時間                                           |
| `created_by`                   | `bigint`      | 必填   | 建立者                                                 |
| `reason`                       | `text`        | 選填   | 異動原因                                               |
| `created_at`                   | `datetime`    | 必填   | 建立時間                                               |

### `compensatory_leave_allocations`

**註釋：** 一次補休使用實際分配到哪些額度批次。最早到期優先，可部分使用，取消原路返還。

**設計理由：** 使用補休時另記額度分配，可指出一次請假實際扣到哪些來源額度，支援不同到期日與先到期先使用。

規則：到期日當天仍可使用；到期剩餘一定轉薪資；薪資結算後不可直接修改歷史。

## 請假核心

### `leave_types`

**資料表註釋：** `leave_types` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 假別做成主檔，讓法定假、公司假及其他假別使用一致代碼與顯示設定，不把假別種類寫死在申請資料。

假別定義；特休、福利假、補休彼此分離。

| 欄位名稱            | 資料型態      | 必填性       | 欄位註釋                               |
| ------------------- | ------------- | ------------ | -------------------------------------- |
| `id`                | `bigint`      | 必填         | PK，假別 ID                            |
| `code`              | `varchar(30)` | 必填         | 假別代碼                               |
| `name`              | `varchar(50)` | 必填         | 假別名稱                               |
| `category_code`     | `integer`     | 必填         | 1 法定、2 性別平等、3 公司福利、4 其他 |
| `is_paid`           | `boolean`     | 必填         | 是否有薪                               |
| `requires_balance`  | `boolean`     | 必填         | 是否需要額度                           |
| `requires_approval` | `boolean`     | 必填         | 是否需要審核                           |
| `requires_document` | `boolean`     | 必填         | 是否要求證明文件                       |
| `unit_code`         | `integer`     | 必填         | 1 日、2 小時、3 分鐘                   |
| `is_active`         | `boolean`     | 必填         | 是否啟用                               |
| `sort_order`        | `integer`     | 必填性未明定 | 顯示排序                               |
| `description`       | `text`        | 選填         | 假別說明                               |
| `created_at`        | `datetime`    | 必填         | 建立時間                               |
| `updated_at`        | `datetime`    | 必填         | 修改時間                               |

**約束：** `UNIQUE(code)`；補休與一般假別的額度來源不同，不能因顯示在同一請假流程就合併帳本。

### `leave_type_rules`

**資料表註釋：** `leave_type_rules` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 假別規則與假別主檔分離，因同一假別的給付、單位、證明或限制可能隨政策調整，規則不應污染基本識別資料。

假別法規／公司規則與有效期間。

| 欄位名稱                  | 資料型態   | 必填性 | 欄位註釋                                       |
| ------------------------- | ---------- | ------ | ---------------------------------------------- |
| `id`                      | `bigint`   | 必填   | PK，規則 ID                                    |
| `leave_type_id`           | `bigint`   | 必填   | FK → `leave_types.id`                          |
| `rule_type_code`          | `integer`  | 必填   | 規則類型代碼                                   |
| `calculation_type_code`   | `integer`  | 必填   | 計算方式代碼                                   |
| `period_type_code`        | `integer`  | 選填   | 1 曆年、2 到職週年、3 月、4 事件、5 無固定期間 |
| `quota_minutes`           | `integer`  | 選填   | 標準額度分鐘數                                 |
| `max_quota_minutes`       | `integer`  | 選填   | 額度上限分鐘數                                 |
| `reference_leave_type_id` | `bigint`   | 選填   | FK → `leave_types.id`，參照其他假別            |
| `eligibility_rule`        | `json`     | 選填   | 資格規則                                       |
| `quota_rule`              | `json`     | 選填   | 額度規則                                       |
| `salary_rule`             | `json`     | 選填   | 薪資給付規則                                   |
| `document_rule`           | `json`     | 選填   | 證明文件規則                                   |
| `effective_from`          | `date`     | 必填   | 生效日                                         |
| `effective_to`            | `date`     | 選填   | 失效日                                         |
| `is_active`               | `boolean`  | 必填   | 是否啟用                                       |
| `created_at`              | `datetime` | 必填   | 建立時間                                       |
| `updated_at`              | `datetime` | 必填   | 修改時間                                       |

**約束：** 同一假別同類規則的有效期間不得重疊；歷史規則保留，已核准請假與已授予額度不得因新規則回算。

### `leave_entitlements`

**資料表註釋：** `leave_entitlements` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 應享額度記錄員工在特定期間被授予的權利，將「制度規則」與「個人實際取得」分開，才能處理年資與個別調整。

| 欄位名稱           | 資料型態      | 必填性 | 欄位註釋                                     |
| ------------------ | ------------- | ------ | -------------------------------------------- |
| `id`               | `bigint/uuid` | 必填   | 主鍵，資料唯一識別碼                         |
| `employee_id`      | `FK`          | 必填   | 員工外鍵                                     |
| `leave_type_id`    | `FK`          | 必填   | 假別外鍵                                     |
| `source_type_code` | `integer`     | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `source_id`        | `bigint`      | 選填   | 來源資料 ID                                  |
| `pay_type_code`    | `integer`     | 必填   | 1 有薪、2 無薪                               |
| `entitled_minutes` | `integer`     | 必填   | 授予分鐘數                                   |
| `effective_from`   | `date`        | 必填   | 可用起日                                     |
| `effective_to`     | `date`        | 選填   | 可用迄日                                     |
| `status_code`      | `integer`     | 必填   | 1 有效、2 撤銷、3 結清                       |
| `created_at`       | `datetime`    | 必填   | 建立時間                                     |
| `updated_at`       | `datetime`    | 必填   | 修改時間                                     |

### `leave_balances`

**資料表註釋：** `leave_balances` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 餘額表提供快速查詢，交易表保留每次增減的可稽核來源；兩者分工可兼顧效能與可追溯性，不能只留一個可被直接改寫的數字。

前者為當前餘額彙總／快取；後者為取得、使用、返還、調整及到期的完整帳本。原始 `entitled_minutes` 不因使用而 UPDATE。

| 欄位名稱            | 資料型態   | 必填性 | 欄位註釋                   |
| ------------------- | ---------- | ------ | -------------------------- |
| `id`                | `bigint`   | 必填   | PK                         |
| `employee_id`       | `bigint`   | 必填   | FK → `employees.id`        |
| `leave_type_id`     | `bigint`   | 必填   | FK → `leave_types.id`      |
| `entitled_minutes`  | `integer`  | 必填   | 已授予總分鐘數             |
| `reserved_minutes`  | `integer`  | 必填   | 申請中凍結分鐘數           |
| `used_minutes`      | `integer`  | 必填   | 已使用分鐘數               |
| `expired_minutes`   | `integer`  | 必填   | 已到期分鐘數               |
| `remaining_minutes` | `integer`  | 必填   | 可用剩餘分鐘數；彙總／快取 |
| `updated_at`        | `datetime` | 必填   | 最後重算時間               |

### `leave_balance_transactions`

**資料表註釋：** 假別額度不可變交易帳本，可由流水重建餘額。

| 欄位名稱                | 資料型態      | 必填性 | 欄位註釋                                                               |
| ----------------------- | ------------- | ------ | ---------------------------------------------------------------------- |
| `id`                    | `bigint`      | 必填   | PK                                                                     |
| `leave_entitlement_id`  | `bigint`      | 必填   | FK → `leave_entitlements.id`                                           |
| `transaction_type_code` | `integer`     | 必填   | 1 授予、2 凍結、3 使用、4 取消返還、5 結轉、6 到期、7 撤銷、8 人工調整 |
| `minutes`               | `integer`     | 必填   | 本次異動分鐘數                                                         |
| `reference_type`        | `varchar(50)` | 選填   | 來源資料類型                                                           |
| `reference_id`          | `bigint`      | 選填   | 來源資料 ID                                                            |
| `occurred_at`           | `datetime`    | 必填   | 異動發生時間                                                           |
| `created_by`            | `bigint`      | 必填   | 建立者                                                                 |
| `reason`                | `text`        | 選填   | 異動原因                                                               |
| `created_at`            | `datetime`    | 必填   | 建立時間                                                               |

### `leave_requests`

**資料表註釋：** `leave_requests` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 請假申請主表保存一次申請的共同資料與流程狀態，讓跨日或多日請假仍屬於同一申請。

| 欄位名稱      | 資料型態      | 必填性 | 欄位註釋                                     |
| ------------- | ------------- | ------ | -------------------------------------------- |
| `id`          | `bigint/uuid` | 必填   | 主鍵，資料唯一識別碼                         |
| `employee_id` | `FK`          | 必填   | 員工外鍵                                     |
| `request_no`  | `varchar(30)` | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `status_code` | `integer`     | 必填   | 流程或資料狀態代碼                           |
| `reason`      | `text`        | 必填   | 請假事由；UI 與本輪定案要求必填              |
| `applied_at`  | `datetime`    | 選填   | 送出申請時間                                 |
| `created_at`  | `datetime`    | 必填   | 建立時間                                     |
| `updated_at`  | `datetime`    | 必填   | 修改時間                                     |

### `leave_request_details`

**資料表註釋：** `leave_request_details` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 申請明細按日期／時段拆分，才能對照每天班表計算實際請假時數，避免以整段日曆時間誤算休息日。

| 欄位名稱            | 資料型態  | 必填性 | 欄位註釋                                     |
| ------------------- | --------- | ------ | -------------------------------------------- |
| `id`                | `PK`      | 必填   | 主鍵，資料唯一識別碼                         |
| `leave_request_id`  | `FK`      | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `leave_type_id`     | `FK`      | 必填   | 假別外鍵                                     |
| `leave_date`        | `date`    | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `start_time`        | `time`    | 選填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `end_time`          | `time`    | 選填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `requested_minutes` | `integer` | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `reason`            | `text`    | 選填   | 原因                                         |

### `leave_request_allocations`

**資料表註釋：** `leave_request_allocations` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 請假扣抵分配獨立保存，可追蹤申請使用哪一筆應享額度或補休來源，並支援單次申請跨多個額度。

| 欄位名稱                  | 資料型態   | 必填性 | 欄位註釋                                     |
| ------------------------- | ---------- | ------ | -------------------------------------------- |
| `id`                      | `PK`       | 必填   | 主鍵，資料唯一識別碼                         |
| `leave_request_detail_id` | `FK`       | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `entitlement_type_code`   | `integer`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `entitlement_id`          | `FK`       | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `allocated_minutes`       | `integer`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `created_at`              | `datetime` | 必填   | 建立時間                                     |

### `leave_request_approvals`

**資料表註釋：** `leave_request_approvals` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 審核、附件與事件分表，是因三者分別代表流程決策、證明文件及狀態歷程；各自可能一對多，不能塞在申請主表的重複欄位中。

| 欄位名稱           | 資料型態   | 必填性   | 欄位註釋                                                           |
| ------------------ | ---------- | -------- | ------------------------------------------------------------------ |
| `id`               | `bigint`   | 必填     | PK                                                                 |
| `leave_request_id` | `bigint`   | 必填     | FK → `leave_requests.id`                                           |
| `action_code`      | `integer`  | 必填     | 1 送出、2 核准、3 退回、4 員工撤回、5 撤銷核准、6 撤銷退回、7 取消 |
| `action_by`        | `bigint`   | 必填     | 操作者                                                             |
| `action_at`        | `datetime` | 必填     | 操作時間                                                           |
| `reason`           | `text`     | 條件必填 | 退回、撤銷核准及撤銷退回時必填                                     |
| `created_at`       | `datetime` | 必填     | 建立時間                                                           |

### 已確認的請假簽核 UI 與撤銷規則

- 進入預設顯示待審核，第 1 頁，每頁 20 筆，等待最久優先。
- 審核者不得修改假別、日期、時段、時數或事由，也不得部分核准。
- 只能整筆核准或退回；內容錯誤由員工建立新申請。
- 核准將凍結額度轉為使用並重算出勤；退回及員工撤回原路返還額度。
- 薪資尚未核算時，可撤銷核准：使用額度原路返還並依原分配重新凍結，重算出勤後回到待審核。
- 薪資尚未核算時，可撤銷退回：重新凍結全部原分配後回到待審核。
- 一般假別與補休各自使用自己的交易帳本，不得混用。
- 詳細規劃見 [19-ui-leave-approval.md](../ui/19-ui-leave-approval.md)。

### `leave_request_documents`

**資料表註釋：** 請假證明附件及驗證結果。

| 欄位名稱             | 資料型態   | 必填性 | 欄位註釋                               |
| -------------------- | ---------- | ------ | -------------------------------------- |
| `id`                 | `bigint`   | 必填   | PK                                     |
| `leave_request_id`   | `bigint`   | 必填   | FK → `leave_requests.id`               |
| `document_type_code` | `integer`  | 必填   | 1 診斷、2 醫療、3 死亡、4 關係、5 其他 |
| `file_id`            | `bigint`   | 必填   | 附件檔案 ID                            |
| `verified_at`        | `datetime` | 選填   | 驗證時間                               |
| `verified_by`        | `bigint`   | 選填   | 驗證者                                 |
| `status_code`        | `integer`  | 必填   | 1 待驗、2 通過、3 未通過               |
| `created_at`         | `datetime` | 必填   | 建立時間                               |

### `leave_events`

**資料表註釋：** 結婚、親屬死亡、生產、流產、懷孕、配偶生產、職災等事件來源。

| 欄位名稱              | 資料型態   | 必填性 | 欄位註釋                                                               |
| --------------------- | ---------- | ------ | ---------------------------------------------------------------------- |
| `id`                  | `bigint`   | 必填   | PK                                                                     |
| `employee_id`         | `bigint`   | 必填   | FK → `employees.id`                                                    |
| `event_type_code`     | `integer`  | 必填   | 1 結婚、2 親屬死亡、3 生產、4 流產、5 懷孕、6 配偶生產、7 職災、8 其他 |
| `event_date`          | `date`     | 必填   | 事件日期                                                               |
| `relationship_code`   | `integer`  | 選填   | 親屬關係代碼                                                           |
| `related_employee_id` | `bigint`   | 選填   | 關聯員工 ID                                                            |
| `details`             | `json`     | 選填   | 事件補充資料                                                           |
| `document_verified`   | `boolean`  | 必填   | 證明是否通過                                                           |
| `created_at`          | `datetime` | 必填   | 建立時間                                                               |
| `updated_at`          | `datetime` | 必填   | 修改時間                                                               |

## 已確認的「我的資料／請假與餘額」UI

- 顯示特休、補休及福利假每一次實際發放，不得只顯示假別總額。
- 餘額列表顯示假別、來源、發放日、可用期間、發放、申請中、已使用、剩餘及狀態。
- 補休與一般假別可統一顯示，但仍使用各自額度與交易帳本。
- 請假申請包含假別、起訖日期、指定時段開關、開始／結束時間、系統計算時數、必填事由及條件附件。
- 預設整日；開啟指定時段後可選幾點到幾點。跨日及休息時間依每日班表計算。
- 待審核先凍結額度，撤回／未核准原路返還，核准轉為使用；最早到期優先。
- 一次申請可扣抵多筆發放額度，並由 `leave_request_allocations` 保存來源。
- 已結算月份不得新增請假申請。
- 詳細規劃見 [14-ui-my-leave.md](../ui/14-ui-my-leave.md)。

## 公司贈與假

> 已確認的操作流程見 [人事作業／特休與補休贈與](../ui/21-ui-company-leave-grants.md)。

公司贈與假是「公司直接核發給員工」，不是員工互相轉贈。批次表保存全批共同條件，逐員工表保存每人的發放結果；每筆成功贈與再產生 `leave_entitlements`，以 `source_type_code=2` 及 `source_id=company_leave_grants.id` 回溯來源。

**定案規則：** 同一批次只能有一個假別、一種有薪／無薪性質、一個分鐘數及一組有效期間；`granted_minutes > 0`，禁止負數贈與。逐員工處理，個別失敗可重試。核發後不可直接改批次條件；撤銷只能收回尚未使用部分，已使用歷史保留。到期或離職後不可再用，但資料不得刪除。

### `company_leave_grant_batches`

**資料表註釋：** `company_leave_grant_batches` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 公司贈與假先以批次表記錄發放原因、範圍與時間，讓一次對多人發放能被整批追蹤及稽核。

| 欄位名稱          | 資料型態       | 必填性 | 欄位註釋                         |
| ----------------- | -------------- | ------ | -------------------------------- |
| `id`              | `bigint`       | 必填   | 主鍵，資料唯一識別碼             |
| `batch_no`        | `varchar(30)`  | 必填   | 公司贈與批次編號                 |
| `name`            | `varchar(100)` | 必填   | 顯示名稱                         |
| `leave_type_id`   | `bigint`       | 必填   | FK → `leave_types.id`            |
| `pay_type_code`   | `integer`      | 必填   | 1 有薪、2 無薪                   |
| `granted_minutes` | `integer`      | 必填   | 每位員工核發的分鐘數，必須大於 0 |
| `effective_from`  | `date`         | 必填   | 生效開始日                       |
| `effective_to`    | `date`         | 必填   | 生效結束日                       |
| `reason`          | `text`         | 必填   | 發放原因                         |
| `description`     | `text`         | 選填   | 公司內部備註                     |
| `created_by`      | `bigint`       | 必填   | 建立者 ID                        |
| `created_at`      | `datetime`     | 必填   | 建立時間                         |
| `updated_at`      | `datetime`     | 必填   | 最後修改時間                     |

同批不得混用假別、薪資類型、額度或有效期；`granted_minutes > 0`；起訖日必填。

### `company_leave_grants`

**資料表註釋：** `company_leave_grants` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 個別贈與結果另存每位員工實際取得的假別與額度，避免批次條件等同於最終結果，也便於處理個別失敗或調整。

| 欄位名稱            | 資料型態   | 必填性 | 欄位註釋                                         |
| ------------------- | ---------- | ------ | ------------------------------------------------ |
| `id`                | `bigint`   | 必填   | 主鍵，資料唯一識別碼                             |
| `batch_id`          | `bigint`   | 必填   | FK → `company_leave_grant_batches.id`            |
| `employee_id`       | `bigint`   | 必填   | FK → `employees.id`                              |
| `status_code`       | `integer`  | 必填   | 個別員工核發狀態；支援成功、失敗、撤銷及重試流程 |
| `granted_by`        | `bigint`   | 必填   | 實際核發者 ID                                    |
| `granted_at`        | `datetime` | 選填   | 核發成功時間                                     |
| `failure_reason`    | `text`     | 選填   | 個別發放失敗原因；失敗時填寫                     |
| `cancelled_minutes` | `integer`  | 必填   | 已撤銷分鐘數，預設 0                             |
| `cancelled_by`      | `bigint`   | 選填   | 撤銷者 ID                                        |
| `cancelled_at`      | `datetime` | 選填   | 撤銷時間                                         |
| `cancel_reason`     | `text`     | 選填   | 撤銷原因                                         |
| `created_at`        | `datetime` | 必填   | 建立時間                                         |
| `updated_at`        | `datetime` | 必填   | 最後修改時間                                     |

逐員工處理，個別失敗可單獨重試且不得重複核發給已成功員工；公司直接核發，員工不可互贈。撤銷以個別員工為單位：未使用可全部撤銷，部分使用只能撤銷剩餘分鐘，已全部使用、已完成薪資結算或已轉薪資者不可撤銷；已撤銷不得再次撤銷，只能重新發放。撤銷時 `cancelled_minutes > 0`，且 `cancelled_by`、`cancelled_at`、`cancel_reason` 必填；原核發及已使用歷史不可抹除。到期或離職後不可再用，但資料保留。

撤銷不得直接扣改原核發交易；必須在 `leave_balance_transactions` 新增公司贈與撤銷的扣除交易，並只扣除尚未使用餘額。發放列表以 `company_leave_grants` 為一人一筆，已使用與剩餘分鐘由 `leave_entitlements` 及交易帳本計算。
