# 班別、排班與出勤

## 設計理念

規則 → 排定 → 異動 → 實際 → 判定。班別不是班表；班表不是打卡；請假不修改班表。週期不限制七天，支援做二休二、輪班、零工、跨日、臨時叫班、換班、公司停班與調班歷史。

## 排班 Schema

### `shift_definitions`

**註釋：** 班別主檔。

**設計理由：** 班別主檔保存可重用的班別定義，員工班表只引用班別，避免每天重複輸入相同工時規則。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵，資料唯一識別碼 |
| `company_id` | `uuid` | 必填 | 所屬公司外鍵 |
| `code` | `varchar` | 必填 | 業務代碼 |
| `name` | `varchar` | 必填 | 顯示名稱 |
| `work_type_code` | `integer` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `is_overnight` | `boolean` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `is_flexible` | `boolean` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `required_work_minutes` | `integer` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `description` | `text` | 必填 | 用途或異動說明 |
| `is_active` | `boolean` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 最後修改時間 |
| `deleted_at` | `datetime` | 選填 | Soft Delete 時間 |

### `shift_work_periods`

**資料表註釋：** `shift_work_periods` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 工作時段拆成子表，可表達跨日或一天多段工作，不必將開始、結束時間限制成班別主檔上的單一一組。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `型態待恢復` | 待核對 | 主鍵，資料唯一識別碼 |
| `shift_definition_id` | `uuid` | 必填 | FK → `shift_definitions.id` |
| `sequence_no` | `integer` | 必填 | 同一班別工作時段順序 |
| `start_time` | `time` | 必填 | 工作時段開始時間 |
| `end_time` | `time` | 必填 | 工作時段結束時間 |
| `end_day_offset` | `integer` | 必填 | 結束日偏移；跨日班用 1 |
| `work_minutes` | `integer` | 必填 | 此工作時段應工作分鐘數 |

### `shift_breaks`

**資料表註釋：** `shift_breaks` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 休息時段與工作時段分開，可計算應工作時數及不計薪休息，也能支援一個班別有多段休息。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `型態待恢復` | 待核對 | 主鍵，資料唯一識別碼 |
| `shift_definition_id` | `uuid` | 必填 | FK → `shift_definitions.id` |
| `sequence_no` | `integer` | 必填 | 同一班別休息時段順序 |
| `start_time` | `time` | 必填 | 休息開始時間 |
| `end_time` | `time` | 必填 | 休息結束時間 |
| `break_minutes` | `integer` | 必填 | 休息分鐘數 |
| `is_paid` | `boolean` | 必填 | 是否為有薪休息 |

## 已確認的班別設定與排班模式範圍

> 完整操作與模式說明見 [人事作業／班別設定](../ui/22-ui-shift-settings.md)。

既有 `shift_definitions`、`shift_work_periods`、`shift_breaks` 支援一般班、跨日班、分段班、中空班及多段有薪／無薪休息。固定星期、每日不同固定班、任意長度循環、做二休二、日夜輪替、兩班／三班、大小週、人工月排班、零工、臨時叫班、季節性及專案期間均納入排班範圍。

班別被排班引用後，時間、休息及應工作分鐘不得直接覆蓋歷史；現階段採停用舊班別並複製建立新班別，未確認前不自行增加班別版本表。

以下功能已確認納入整體系統，但仍需獨立設計正式Schema及流程：

- 彈性上班區間、核心工時及彈性下班計算。
- 班組主檔、成員有效期間、主管、規則指派及週期定位。
- 員工換班申請、雙方確認、主管審核及雙班表原子異動。
- 代班申請、代班者同意、主管審核及原／代班表關聯。
- 公司停班事件、受影響班表、停班日別及計薪處理。
- 待命／備勤安排、實際叫回或轉工作、打卡、工時及計薪結果。

上述功能不能直接塞入 `shift_definitions`。尚未逐項確認的表名與欄位一律標記待設計，不從UI描述反推正式Schema。

### `schedule_rules` / `schedule_rule_details`

**註釋：** 固定週班或任意長度循環規則及每個週期日內容。規則需含公司、名稱、類型、週期長度與啟用狀態；明細需含週期序號、班別、日期性質及是否安排工作。做二休二以四日週期表達，不綁星期。

**設計理由：** 排班規則與規則明細採主從結構：主表保存適用範圍與版本，明細保存循環內每天的安排，避免固定只支援單週或固定天數。


| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | PK，員工排班規則指派 ID |
| `employment_id` | `uuid` | 必填 | FK → `employee_employments.id` |
| `schedule_rule_id` | `uuid` | 必填 | FK → `schedule_rules.id` |
| `cycle_anchor_date` | `date` | 必填 | 週期第 1 日的定位基準日；使做二休二等任意週期可正確展開 |
| `effective_from` | `date` | 必填 | 指派生效日 |
| `effective_to` | `date` | 選填 | 指派失效日 |
| `status_code` | `integer` | 必填 | 指派狀態代碼 |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 修改時間 |

**關聯與約束：** 任職、排班規則必須屬於同一公司；同一任職的有效指派期間不得互相衝突。指派只負責「某期間套用哪套規則」，發布時才展開成 `employee_schedules`，規則變更不得覆蓋已發布歷史。
### `employee_schedule_assignments`

**註釋：** 員工在有效期間套用哪一套排班規則，包含週期定位基準日。正式名稱在原對話中未單獨再確認，概念與欄位責任已確認。

**設計理由：** 員工與排班規則用指派表連接，才能保留誰在何期間適用哪套規則，也避免變更規則時直接覆寫員工資料。


| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | PK，公司出勤設定 ID |
| `company_id` | `uuid` | 必填 | FK → `companies.id` |
| `require_clock_in_before_clock_out` | `boolean` | 必填 | 是否要求有有效上班卡後才能打下班卡；本次需求為 true |
| `allow_employee_cancellation` | `boolean` | 必填 | 是否允許員工自行撤銷誤打紀錄；撤銷不得 DELETE |
| `allow_correction_request` | `boolean` | 必填 | 是否允許申請補登 |
| `correction_requires_approval` | `boolean` | 必填 | 補登是否需審核；核准後才建立正式打卡 |
| `gps_enabled` | `boolean` | 必填 | 是否接受 GPS 資訊；不等同 GPS 必填 |
| `gps_required` | `boolean` | 必填 | GPS 是否強制；本次定案為 false |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 修改時間 |

**關聯與約束：** `company_id → companies.id`；公司同時間一筆有效設定。設定只管理打卡流程，不保存遲到、早退結果；GPS 關閉或缺失都不得直接判定出勤異常。
### `schedule_periods`

**資料表註釋：** `schedule_periods` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 排班期間先界定一批班表的日期範圍與處理狀態，方便批次產生、鎖定與追蹤，而不是讓每日日程各自失去批次脈絡。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵，資料唯一識別碼 |
| `company_id` | `uuid` | 必填 | 所屬公司外鍵 |
| `name` | `string` | 必填 | 顯示名稱 |
| `start_date` | `date` | 必填 | 開始日期 |
| `end_date` | `date` | 必填 | 結束日期 |
| `status_code` | `integer` | 必填 | 流程或資料狀態代碼 |
| `published_at` | `datetime` | 選填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `published_by` | `uuid` | 選填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 最後修改時間 |

### `employee_schedules`

**註釋：** 員工某日最終有效班表快照；排班確定／發布時產生。

**設計理由：** 每日班表保存實際排定結果，而不在查詢時永遠由規則即時計算；因此規則改版不會覆蓋歷史，零工也能直接建立單日班表。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `型態待恢復` | 待核對 | 主鍵，資料唯一識別碼 |
| `schedule_period_id` | `uuid` | 選填 | FK → `schedule_periods.id`；直接建立日排班時可為 NULL |
| `company_id` | `型態待恢復` | 待核對 | 所屬公司外鍵 |
| `employee_id` | `型態待恢復` | 待核對 | 員工外鍵 |
| `employment_id` | `型態待恢復` | 待核對 | 任職紀錄外鍵 |
| `schedule_date` | `date` | 必填 | 排班日期 |
| `shift_definition_id` | `uuid` | 選填 | FK → `shift_definitions.id`；非工作日可為 NULL |
| `schedule_day_type_code` | `integer` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `scheduled_work_flag` | `boolean` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |

規則：歷史班表不得被新規則覆蓋；零工可直接建立；國定假日不等於每個員工休假；加班資格由該日班表性質與是否排定工作共同判定；不建立 `employee_holiday_calendars`。

### `schedule_changes`

**註釋：** 已發布班表異動／調班歷史。

**設計理由：** 班表異動另留紀錄，讓原排班、變更內容、原因與流程可稽核，而不是只看得到修改後結果。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵，資料唯一識別碼 |
| `employee_schedule_id` | `uuid` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `employee_id` | `uuid` | 必填 | 員工外鍵 |
| `original_shift_id` | `uuid` | 選填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `new_shift_id` | `uuid` | 選填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |

## 已確認的「全體出勤」UI

- 「人事作業」下新增「全體出勤」。
- 按年月查詢，並可同時依部門及人員篩選；人員可依員工編號或姓名搜尋。
- 列表一位員工一天一列，顯示員工編號、姓名、部門、日期、上下班時間、上下班地點、工時、遲到、早退、狀態及來源。
- 上班地點與下班地點顯示 GPS 反查後的大約地址；主列表不直接顯示經緯度。
- 工時與判定結果讀取 `attendance_results`；時間、來源及位置讀取正式打卡事件。
- 打卡 GPS 的實際保存欄位留待打卡功能討論，本輪不得補猜。
- 詳細規劃見 [09-ui-all-attendance.md](../ui/09-ui-all-attendance.md)。

## 已確認的 Dashboard 打卡與撤銷

- 使用者進入公司後，預設頁面為「總覽」Dashboard；上下班打卡放在總覽主要區域。
- 沒有有效上班卡不得先打下班卡；畫面依狀態顯示下一個有效打卡動作。
- 上班卡與下班卡皆可撤銷，撤銷原因必填。
- 撤銷不得 DELETE；原始事件需保留，撤銷後不參與有效工時與出勤判定。
- 已有下班卡時，需先撤銷下班卡，才能撤銷其前面的上班卡。
- 已鎖定日期不得由員工直接撤銷，應改走更正流程。
- 撤銷後重新計算出勤結果；全體出勤主列表顯示有效打卡，明細保留撤銷歷史。
- 撤銷相關正式欄位與 GPS 保存欄位尚待逐欄確認，不在本輪補猜。
- 詳細規劃見 [10-ui-dashboard-attendance.md](../ui/10-ui-dashboard-attendance.md)。

## 已確認的「我的資料／出勤紀錄」UI

- 「我的資料」下新增「出勤紀錄」，只能查詢目前登入員工本人。
- 年月預設為系統當月，進入頁面立即載入；可切換其他年月。
- 顯示出勤天數、總工時、遲到天數、早退天數及缺勤天數。
- 列表顯示日期、上下班時間與地點、工時、遲到、早退、狀態及來源。
- 一個工作日一列，跨日班依班表工作日期歸屬，日期預設由新到舊。
- 點選日期可查看當日原始及已撤銷打卡等明細；目前只查看，補卡／更正入口尚未定案。
- 統計由當月有效 `attendance_results` 彙總，不建立專用統計表。
- 後端依 `users`、`company_users` 與其員工連結限制本人資料，不接受任意其他員工 ID。
- 詳細規劃見 [12-ui-my-attendance.md](../ui/12-ui-my-attendance.md)。

## 出勤 Schema

### `attendance_records`

**註釋：** 正常或核准補登形成的正式打卡事件。

**設計理由：** 原始打卡紀錄獨立保存實際事件，避免排班或判定規則改變時失去原始證據，並可支援同日多次進出。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵，資料唯一識別碼 |
| `employee_id` | `uuid` | 必填 | 員工外鍵 |
| `employment_id` | `uuid` | 必填 | 任職紀錄外鍵 |
| `employee_schedule_id` | `uuid` | 選填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `work_date` | `date` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `attendance_type_code` | `integer` | 必填 | 欄位已確認；代碼值或額外約束未在定案節點明定 |

| `source_type_code` | `integer` | 必填 | 打卡來源類型，例如現場打卡或人工補登 |
| `source_id` | `uuid` | 選填 | 人工補登時 FK → `attendance_correction_requests.id` |

規則：有效上班卡後才能打下班卡；兩種卡均可撤銷；撤銷不 DELETE；GPS 選填。

### `attendance_correction_requests`

**註釋：** 忘打卡補登申請；上班與下班分開申請。

**設計理由：** 補卡申請與原始打卡分離，讓人工更正必須經過申請與審核，且不直接竄改原始紀錄。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `型態待恢復` | 待核對 | 主鍵，資料唯一識別碼 |
| `employee_id` | `型態待恢復` | 待核對 | 員工外鍵 |
| `employment_id` | `型態待恢復` | 待核對 | 任職紀錄外鍵 |
| `employee_schedule_id` | `uuid` | 必填 | FK → `employee_schedules.id` |
| `attendance_type_code` | `integer` | 必填 | 申請補登的上班／下班事件類型 |
| `requested_clocked_at` | `datetime` | 必填 | 申請補登的實際打卡時間；較晚版本曾寫作 `requested_at`，語意以此欄為準 |
| `reason` | `型態待恢復` | 待核對 | 原因 |
| `status_code` | `型態待恢復` | 待核對 | 流程或資料狀態代碼 |

**審核欄位更新：** 原 `reviewed_by`、`reviewed_at`、`review_comment` 單次欄位已由 `attendance_correction_reviews` 歷程表取代。

**已確認流程與約束：**

- 上班與下班分開申請；同一工作日、同一類型不得同時存在多筆待審核申請。
- 已有有效打卡的類型不得重複申請；不可申請未來日期。
- 已結算月份不得提出申請；存在待審核申請時應阻止月份結算。
- 待審核申請可由員工撤回；撤回保留紀錄且不得再審核。
- 未核准申請不提供複製後重新送出；退回原因保存於審核歷程。
- 核准後才建立正式 `attendance_records`，來源為人工補登，且不建立 GPS。
- 核准後重新計算 `attendance_results`。
- 撤回欄位名稱與型態尚待確認。
- 詳細規劃見 [13-ui-attendance-correction.md](../ui/13-ui-attendance-correction.md)。

### `attendance_correction_reviews`

**註釋：** 補打卡申請的不可變審核與撤銷歷程。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | PK |
| `attendance_correction_request_id` | `uuid` | 必填 | FK → `attendance_correction_requests.id` |
| `action_code` | `integer` | 必填 | 核准、退回、撤銷核准或撤銷退回 |
| `action_by` | `uuid` | 必填 | 操作者 |
| `action_at` | `datetime` | 必填 | 操作時間 |
| `reason` | `text` | 條件必填 | 退回及撤銷審核結果時必填 |
| `created_at` | `datetime` | 必填 | 建立時間 |

歷程只能新增，不可修改或刪除。薪資尚未開始核算時，已核准及已退回結果均可撤銷並回到待審核；薪資開始核算後只可查看。詳細流程見 [17-ui-attendance-correction-approval.md](../ui/17-ui-attendance-correction-approval.md)。

### `attendance_settings`

**註釋：** 公司打卡規則；GPS 是否啟用不得等同強制必填。

**設計理由：** 出勤容許值與判定參數集中於公司設定，讓遲到、早退等規則能按公司調整，並避免硬寫在程式或每筆結果。


| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | PK，公司出勤設定 ID |
| `company_id` | `uuid` | 必填 | FK → `companies.id` |
| `require_clock_in_before_clock_out` | `boolean` | 必填 | 是否要求有效上班卡後才能打下班卡；本次需求為 true |
| `allow_employee_cancellation` | `boolean` | 必填 | 是否允許員工自行撤銷誤打紀錄；撤銷不得 DELETE |
| `allow_correction_request` | `boolean` | 必填 | 是否允許申請補登 |
| `correction_requires_approval` | `boolean` | 必填 | 補登是否需審核；通過後才建立正式打卡 |
| `gps_enabled` | `boolean` | 必填 | 是否接受 GPS 資訊 |
| `gps_required` | `boolean` | 必填 | GPS 是否強制；本次定案為 false |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 修改時間 |

**關聯與約束：** `company_id → companies.id`；GPS 開啟不等於強制，缺少 GPS 不得直接判定異常。設定只管理打卡流程，不保存每日判定結果。
### `attendance_results`

**註釋：** 依班表、有效打卡、請假與異動計算的遲到、早退、缺卡等判定結果；不得反向改寫原始打卡或班表。

**設計理由：** 出勤結果保存計算後的判定快照，將原始打卡與規則運算結果分離，便於重算、稽核及供薪資／加班流程引用。


| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | PK，出勤結果 ID |
| `employee_schedule_id` | `uuid` | 必填 | FK → `employee_schedules.id`；本次判定所依班表 |
| `employee_id` | `uuid` | 必填 | FK → `employees.id` |
| `work_date` | `date` | 必填 | 班次工作日期，不以跨日打卡的日曆日期取代 |
| `scheduled_minutes` | `integer` | 必填 | 應工作分鐘數 |
| `worked_minutes` | `integer` | 必填 | 實際工作分鐘數 |
| `late_minutes` | `integer` | 必填 | 遲到分鐘數 |
| `early_leave_minutes` | `integer` | 必填 | 早退分鐘數 |
| `absence_minutes` | `integer` | 必填 | 缺勤分鐘數 |
| `leave_minutes` | `integer` | 必填 | 核准請假分鐘數 |
| `overtime_minutes` | `integer` | 必填 | 認列加班分鐘數 |
| `result_status_code` | `integer` | 必填 | 出勤判定狀態代碼 |
| `calculated_at` | `datetime` | 必填 | 計算時間 |
| `updated_at` | `datetime` | 必填 | 最後重算時間 |

**關聯與約束：** 原始班表、打卡、請假是事實來源，本表只保存計算結果，不得反向改寫來源。班表或有效事件變更時可重算，但已被薪資結算鎖定的歷史不得無痕覆蓋。



