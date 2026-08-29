# 班別、排班與出勤

## 設計理念

規則 → 排定 → 異動 → 實際 → 判定。班別不是班表；班表不是打卡；請假不修改班表。週期不限制七天，支援做二休二、輪班、零工、跨日、臨時叫班、換班、公司停班與調班歷史。

## 排班 Schema

### `shift_definitions`

**註釋：** 班別主檔。

**設計理由：** 班別主檔保存可重用的班別定義，員工班表只引用班別，避免每天重複輸入相同工時規則。

| 欄位名稱                | 資料型態   | 必填性 | 欄位註釋                                     |
| ----------------------- | ---------- | ------ | -------------------------------------------- |
| `id`                    | `uuid`     | 必填   | 主鍵，資料唯一識別碼                         |
| `company_id`            | `uuid`     | 必填   | 所屬公司外鍵                                 |
| `code`                  | `varchar`  | 必填   | 業務代碼                                     |
| `name`                  | `varchar`  | 必填   | 顯示名稱                                     |
| `work_type_code`        | `integer`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `is_overnight`          | `boolean`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `is_flexible`           | `boolean`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `required_work_minutes` | `integer`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `description`           | `text`     | 必填   | 用途或異動說明                               |
| `is_active`             | `boolean`  | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `created_at`            | `datetime` | 必填   | 建立時間                                     |
| `updated_at`            | `datetime` | 必填   | 最後修改時間                                 |
| `deleted_at`            | `datetime` | 選填   | Soft Delete 時間                             |

### `shift_work_periods`

**資料表註釋：** `shift_work_periods` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 工作時段拆成子表，可表達跨日或一天多段工作，不必將開始、結束時間限制成班別主檔上的單一一組。

| 欄位名稱              | 資料型態  | 必填性 | 欄位註釋                    |
| --------------------- | --------- | ------ | --------------------------- |
| `id`                  | `uuid`    | 必填   | 主鍵，資料唯一識別碼        |
| `shift_definition_id` | `uuid`    | 必填   | FK → `shift_definitions.id` |
| `sequence_no`         | `integer` | 必填   | 同一班別工作時段順序        |
| `start_time`          | `time`    | 必填   | 工作時段開始時間            |
| `end_time`            | `time`    | 必填   | 工作時段結束時間            |
| `end_day_offset`      | `integer` | 必填   | 結束日偏移；跨日班用 1      |
| `work_minutes`        | `integer` | 必填   | 此工作時段應工作分鐘數      |

### `shift_breaks`

**資料表註釋：** `shift_breaks` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 休息時段與工作時段分開，可計算應工作時數及不計薪休息，也能支援一個班別有多段休息。

| 欄位名稱              | 資料型態  | 必填性 | 欄位註釋                       |
| --------------------- | --------- | ------ | ------------------------------ |
| `id`                  | `uuid`    | 必填   | 主鍵，資料唯一識別碼           |
| `shift_definition_id` | `uuid`    | 必填   | FK → `shift_definitions.id`    |
| `sequence_no`         | `integer` | 必填   | 同一班別休息時段順序           |
| `start_time`          | `time`    | 必填   | 休息開始時間                   |
| `end_time`            | `time`    | 必填   | 休息結束時間                   |
| `break_minutes`       | `integer` | 必填   | 休息分鐘數                     |
| `is_paid`             | `boolean` | 必填   | 是否為有薪休息                 |
| `start_day_offset`    | `integer` | 必填   | 休息開始日偏移；相對班次工作日 |
| `end_day_offset`      | `integer` | 必填   | 休息結束日偏移                 |

**兩個日偏移欄位是實作時的增補**（見 [實作計畫：班別設定](../plans/04-shift-definitions.md) §4.2）：22:00–06:00 的夜班休息 02:00–03:00，只有 `start_time` 的話分不出那個 `02:00` 是班次開始前二十小時還是開始後四小時。跨日班與多段休息都在既有範圍內，因此這不是「用不到」而是欄位不足。

**兩張子表的 `id` 原標「型態待恢復」，已定為 `uuid`**：全站業務資料表一律 uuid（唯二例外是法規三表的 `bigint`，理由是平台全域、只增不改、列數極大）。

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

#### 定案：六項一律延後到排班上線之後再設計

**理由不是「沒空」。** 換班、代班、待命備勤、彈性工時這四項的共同性質是「**在既有班表上做修改**」的流程——而現在連班表都還沒有。沒有實際排班經驗就設計審核流程，會設計出形狀不對的東西：誰要審、審什麼、能不能撤銷、撤銷後班表怎麼還原，這些問題的答案取決於實際怎麼排班。

**這六項與其他缺口的差別**：其他缺口不補就做不出已定案的畫面；這六項是**新功能**，延後不擋任何東西。

**班組（第二項）比想像中小。** `employee_schedule_assignments.cycle_anchor_date` 已經表達了「同一套規則、不同起點」——A 班 anchor 為 1/1、B 班為 1/3，做二休二就自然錯開。因此班組**只需要一張分組主檔 ＋ 成員有效期間，排班的展開機制一行都不用改**。

但它**確實需要主檔**，不能只靠 anchor：若每個人各有自己的 anchor，班組整體要調整起點時得逐人修改，而「這個人屬於哪一組」會變成「看他的 anchor 等於誰」這種推導出來的答案，那不可靠。

**換班（第三項）的範圍要看清楚**：`schedule_changes` 只承接「已發布班表異動」的**歷史**，不是換班申請流程本身——申請、雙方確認、主管審核、雙班表原子異動這四件事沒有任何表。

> **⚠ 以下三節的欄位表格原本錯置，已於本次定案歸位。**
>
> 原本 `schedule_rules / schedule_rule_details` 標題底下的逐欄表格，內容其實是**指派關係**（`employment_id`／`schedule_rule_id`／`cycle_anchor_date`）；而 `employee_schedule_assignments` 標題底下的欄位是 `attendance_settings` 的完整複本。也就是說**規則主表與明細表的正式欄位從來沒有被寫下來**。
>
> 本次定案：欄位歸位，並補上原本缺的兩張表。這是**歸位而不是重新設計**——指派表的欄位本來就在，只是放錯標題。

### `schedule_rules`

**註釋：** 固定週班或任意長度循環的排班規則。

**設計理由：** 規則與明細採主從結構，主表保存適用範圍與週期長度，明細保存循環內每一天的安排；**週期長度不綁七天**，做二休二以四日週期表達。

| 欄位名稱            | 資料型態   | 必填性 | 欄位註釋                               |
| ------------------- | ---------- | ------ | -------------------------------------- |
| `id`                | `uuid`     | 必填   | 主鍵                                   |
| `company_id`        | `uuid`     | 必填   | 所屬公司外鍵                           |
| `code`              | `string`   | 必填   | 業務代碼                               |
| `name`              | `string`   | 必填   | 顯示名稱                               |
| `rule_type_code`    | `integer`  | 必填   | 規則類型代碼                           |
| `cycle_length_days` | `integer`  | 必填   | 週期長度（天）；做二休二為 4，週班為 7 |
| `status`            | `string`   | 必填   | 啟用狀態，不使用 DB ENUM               |
| `created_at`        | `datetime` | 必填   | 建立時間                               |
| `updated_at`        | `datetime` | 必填   | 修改時間                               |
| `deleted_at`        | `datetime` | 選填   | Soft Delete 時間                       |

約束：`UNIQUE(company_id, code, deleted_seq)`；`cycle_length_days` 必須大於 0。

### `schedule_rule_details`

**註釋：** 循環規則內每一個週期日的安排。

| 欄位名稱              | 資料型態  | 必填性 | 欄位註釋                                           |
| --------------------- | --------- | ------ | -------------------------------------------------- |
| `id`                  | `uuid`    | 必填   | 主鍵                                               |
| `schedule_rule_id`    | `uuid`    | 必填   | FK → `schedule_rules.id`                           |
| `cycle_day_no`        | `integer` | 必填   | 週期內第幾天，1 起算，不得超過 `cycle_length_days` |
| `shift_definition_id` | `uuid`    | 選填   | FK → `shift_definitions.id`；休假日為 NULL         |
| `day_type_code`       | `integer` | 必填   | 日期性質代碼                                       |
| `is_working`          | `boolean` | 必填   | 該日是否安排工作                                   |

約束：`UNIQUE(schedule_rule_id, cycle_day_no)`；明細筆數應等於 `cycle_length_days`。

### `employee_schedule_assignments`

**註釋：** 員工在有效期間套用哪一套排班規則，包含週期定位基準日。

**設計理由：** 員工與排班規則用指派表連接，才能保留誰在何期間適用哪套規則，也避免變更規則時直接覆寫員工資料。`cycle_anchor_date` 是任意長度週期能正確展開的支點——做二休二的 A、B 兩組就是同一套規則、相差兩天的起點。

| 欄位名稱            | 資料型態   | 必填性 | 欄位註釋                                                |
| ------------------- | ---------- | ------ | ------------------------------------------------------- |
| `id`                | `uuid`     | 必填   | PK，員工排班規則指派 ID                                 |
| `employment_id`     | `uuid`     | 必填   | FK → `employee_employments.id`                          |
| `schedule_rule_id`  | `uuid`     | 必填   | FK → `schedule_rules.id`                                |
| `cycle_anchor_date` | `date`     | 必填   | 週期第 1 日的定位基準日；使做二休二等任意週期可正確展開 |
| `effective_from`    | `date`     | 必填   | 指派生效日                                              |
| `effective_to`      | `date`     | 選填   | 指派失效日                                              |
| `status_code`       | `integer`  | 必填   | 指派狀態代碼                                            |
| `created_at`        | `datetime` | 必填   | 建立時間                                                |
| `updated_at`        | `datetime` | 必填   | 修改時間                                                |

**關聯與約束：** 任職、排班規則必須屬於同一公司；同一任職的有效指派期間不得互相衝突。指派只負責「某期間套用哪套規則」，發布時才展開成 `employee_schedules`，規則變更不得覆蓋已發布歷史。

### `schedule_periods`

**資料表註釋：** `schedule_periods` 的已確認資料責任；詳細規則依本節說明。

**設計理由：** 排班期間先界定一批班表的日期範圍與處理狀態，方便批次產生、鎖定與追蹤，而不是讓每日日程各自失去批次脈絡。

| 欄位名稱       | 資料型態   | 必填性 | 欄位註釋                                     |
| -------------- | ---------- | ------ | -------------------------------------------- |
| `id`           | `uuid`     | 必填   | 主鍵，資料唯一識別碼                         |
| `company_id`   | `uuid`     | 必填   | 所屬公司外鍵                                 |
| `name`         | `string`   | 必填   | 顯示名稱                                     |
| `start_date`   | `date`     | 必填   | 開始日期                                     |
| `end_date`     | `date`     | 必填   | 結束日期                                     |
| `status_code`  | `integer`  | 必填   | 流程或資料狀態代碼                           |
| `published_at` | `datetime` | 選填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `published_by` | `uuid`     | 選填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `created_at`   | `datetime` | 必填   | 建立時間                                     |
| `updated_at`   | `datetime` | 必填   | 最後修改時間                                 |

### `employee_schedules`

**註釋：** 員工某日最終有效班表快照；排班確定／發布時產生。

**設計理由：** 每日班表保存實際排定結果，而不在查詢時永遠由規則即時計算；因此規則改版不會覆蓋歷史，零工也能直接建立單日班表。

| 欄位名稱                 | 資料型態     | 必填性 | 欄位註釋                                              |
| ------------------------ | ------------ | ------ | ----------------------------------------------------- |
| `id`                     | `型態待恢復` | 待核對 | 主鍵，資料唯一識別碼                                  |
| `schedule_period_id`     | `uuid`       | 選填   | FK → `schedule_periods.id`；直接建立日排班時可為 NULL |
| `company_id`             | `型態待恢復` | 待核對 | 所屬公司外鍵                                          |
| `employee_id`            | `型態待恢復` | 待核對 | 員工外鍵                                              |
| `employment_id`          | `型態待恢復` | 待核對 | 任職紀錄外鍵                                          |
| `schedule_date`          | `date`       | 必填   | 排班日期                                              |
| `shift_definition_id`    | `uuid`       | 選填   | FK → `shift_definitions.id`；非工作日可為 NULL        |
| `schedule_day_type_code` | `integer`    | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定          |
| `scheduled_work_flag`    | `boolean`    | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定          |

規則：歷史班表不得被新規則覆蓋；零工可直接建立；國定假日不等於每個員工休假；加班資格由該日班表性質與是否排定工作共同判定；不建立 `employee_holiday_calendars`。

### `schedule_changes`

**註釋：** 已發布班表異動／調班歷史。

**設計理由：** 班表異動另留紀錄，讓原排班、變更內容、原因與流程可稽核，而不是只看得到修改後結果。

| 欄位名稱               | 資料型態 | 必填性 | 欄位註釋                                     |
| ---------------------- | -------- | ------ | -------------------------------------------- |
| `id`                   | `uuid`   | 必填   | 主鍵，資料唯一識別碼                         |
| `employee_schedule_id` | `uuid`   | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `employee_id`          | `uuid`   | 必填   | 員工外鍵                                     |
| `original_shift_id`    | `uuid`   | 選填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `new_shift_id`         | `uuid`   | 選填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |

## 已確認的「全體出勤」UI

- 「人事作業」下新增「全體出勤」。
- 按年月查詢，並可同時依部門及人員篩選；人員可依員工編號或姓名搜尋。
- 列表一位員工一天一列，顯示員工編號、姓名、部門、日期、上下班時間、上下班地點、工時、遲到、早退、狀態及來源。
- 上班地點與下班地點顯示 GPS 反查後的大約地址；主列表不直接顯示經緯度。
- 工時與判定結果讀取 `attendance_results`；時間、來源及位置讀取正式打卡事件。
- 打卡 GPS 的實際保存欄位**已於後續定案**，見下方 `attendance_records` 的「打卡欄位定案」節（座標與反查地址為明文欄位，機密性交由資料庫端靜態加密負責；座標的可見範圍另受呼叫者身分限制，見同節）。
- 詳細規劃見 [09-ui-all-attendance.md](../ui/09-ui-all-attendance.md)。

## 已確認的 Dashboard 打卡與撤銷

- 使用者進入公司後，預設頁面為「總覽」Dashboard；上下班打卡放在總覽主要區域。
- 沒有有效上班卡不得先打下班卡；畫面依狀態顯示下一個有效打卡動作。
- 上班卡與下班卡皆可撤銷，撤銷原因必填。
- 撤銷不得 DELETE；原始事件需保留，撤銷後不參與有效工時與出勤判定。
- 已有下班卡時，需先撤銷下班卡，才能撤銷其前面的上班卡。
- 已鎖定日期不得由員工直接撤銷，應改走更正流程。
- 撤銷後重新計算出勤結果；全體出勤主列表顯示有效打卡，明細保留撤銷歷史。
- 撤銷相關正式欄位與 GPS 保存欄位**已於後續定案**，見下方 `attendance_records` 的「打卡欄位定案」節（`revoked_at`／`revoked_by`／`revoke_reason`／`revoked_seq`）。
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

| 欄位名稱               | 資料型態  | 必填性 | 欄位註釋                                     |
| ---------------------- | --------- | ------ | -------------------------------------------- |
| `id`                   | `uuid`    | 必填   | 主鍵，資料唯一識別碼                         |
| `employee_id`          | `uuid`    | 必填   | 員工外鍵                                     |
| `employment_id`        | `uuid`    | 必填   | 任職紀錄外鍵                                 |
| `employee_schedule_id` | `uuid`    | 選填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `work_date`            | `date`    | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |
| `attendance_type_code` | `integer` | 必填   | 欄位已確認；代碼值或額外約束未在定案節點明定 |

| `source_type_code` | `integer` | 必填 | 打卡來源類型，例如現場打卡或人工補登 |
| `source_id` | `uuid` | 選填 | 人工補登時 FK → `attendance_correction_requests.id` |

規則：有效上班卡後才能打下班卡；兩種卡均可撤銷；撤銷不 DELETE；GPS 選填。

#### 打卡欄位定案（原標「留待打卡功能討論，本輪不得補猜」，此節即該次討論的結果）

| 欄位名稱              | 資料型態        | 必填性 | 欄位註釋                                                                     |
| --------------------- | --------------- | ------ | ---------------------------------------------------------------------------- |
| `company_id`          | `uuid`          | 必填   | 所屬公司外鍵；全域規則要求 Tenant 資料可追溯至公司，撤銷者的複合外鍵也需要它 |
| `clocked_at`          | `datetime`      | 必填   | 打卡時刻（台北牆鐘）                                                         |
| `latitude`            | `decimal(9,7)`  | 選填   | 緯度（十進位度數，±90）                                                      |
| `longitude`           | `decimal(10,7)` | 選填   | 經度（十進位度數，±180）                                                     |
| `accuracy_meters`     | `integer`       | 選填   | 定位精準度；非個資                                                           |
| `address`             | `varchar`       | 選填   | 反查地址                                                                     |
| `address_resolved_at` | `datetime`      | 選填   | 反查完成時刻；`NULL` 表示尚未反查或反查失敗                                  |
| `revoked_at`          | `datetime`      | 選填   | 撤銷時刻                                                                     |
| `revoked_by`          | `uuid`          | 選填   | 撤銷者公司成員；複合外鍵 `(company_id, revoked_by)`                          |
| `revoke_reason`       | `text`          | 選填   | 撤銷原因；撤銷時必填                                                         |
| `revoked_seq`         | `bigint`        | 必填   | 撤銷流水號，有效紀錄恆為 `0`；見下方唯一鍵                                   |

**座標與反查地址為明文欄位，機密性交由資料庫端靜態加密負責**（`docs/dev-standards-backend.md` §5.1 全站架構：應用層 `*_encrypted` 欄位加密已移除，改由資料庫端靜態加密負責；`innodb_encrypt_tables` 目前尚未啟用，這是全站現況）。這與員工個資改回明文欄位是同一次架構決定的延伸——不需要再對座標維護一份應用層金鑰與 blind index（座標本來就不需要被查詢重複，UI 定案沒有任何地理圍欄需求）。

**座標型別為定點十進位，不是浮點數或應用層字串**：`latitude` 用 `decimal(9,7)`（±90，小數 7 位約 1.1 公分精度），`longitude` 用 `decimal(10,7)`（±180）。座標不參與加總或門檻比較，不落在「金額禁止用 number」（§4.7）那條規則要防的失敗模式裡——定點十進位儲存只是為了寫入當下就不留二進位捨入的疑慮，API 回應可轉換為 JSON `number` 輸出，不需要比照金額全程以字串流通。

**座標可見範圍：看自己的一律可見，看別人的需要權限。** 明細（單筆打卡或單日出勤明細）回應座標時，依呼叫者身分決定：查詢者是這筆記錄本人時一律回傳；查詢者查看他人記錄時，需具備 `attendance.records.view-all`／`attendance.records.revoke-other` 權限碼才回傳，否則回應中完全不含 `latitude`／`longitude` 欄位（不是欄位存在但為 `null`——`null` 保留給「這筆記錄本來就沒有 GPS」，兩種情況不能長得一樣）。明細以外的列表（全體出勤、我的出勤、每日全員打卡明細）維持只顯示反查地址，不顯示經緯度。

`accuracy_meters` 不透露位置，與座標的敏感性質不同，因此不受上述可見範圍規則限制。

**`work_date` 由配對決定，不是「打卡當日」。** 下班卡的 `work_date` 取自**它要配對的那張有效上班卡**；找不到可配對的上班卡時才退回打卡當日，而那種情況本身就應被判定為異常。

反過來寫（以打卡當日為準）會讓跨日班永遠配不起來：22:00 的上班卡是 `D`，05:50 的下班卡是 `D+1`，兩張卡分屬不同工作日、永遠湊不成一組，而症狀是「明明打了下班卡卻被判缺卡」。零工、臨時叫班、未排班日都會踩到。

**併發鎖粒度：鎖 `employee_employments`，`FOR UPDATE` 必須是交易的第一句。** 打卡（含上班卡與下班卡）與其配對邏輯共用同一個併發風險：先做一般查詢再上鎖，鎖到手時查詢用的一致性讀快照已經是鎖定前那份舊快照（MariaDB 預設 `REPEATABLE READ`，快照在交易內第一次一般 `SELECT` 時就固定，鎖定讀不受這份快照約束，但先查後鎖仍會讓配對邏輯讀到鎖定前的舊快照）。因此交易內第一句固定是 `SELECT ... FOR UPDATE` 鎖定呼叫者目前有效的 `employee_employments` 那一列，鎖到手之後才查「目前有效的同工作日同類型打卡」做配對與重複檢查；`UNIQUE(employee_id, work_date, attendance_type_code, revoked_seq)`（見下方）是最後一道保險，鎖之外的邊界情況擋不住的交給唯一鍵擋，唯一鍵也擋不住的視為系統錯誤，不是可以吞掉的業務分支。撤銷不需要新的鎖：撤銷是條件式 `UPDATE`（`WHERE revoked_at IS NULL AND id = ?`），影響列數為 `0` 即回傳衝突，不需額外上鎖。

**`revoked_seq` 的作用**：約束是「同一員工、同一工作日、同一類型只能有一張**有效**卡」，但 MariaDB 的唯一索引中 NULL 互不相等，`UNIQUE(employee_id, work_date, attendance_type_code)` 會把已撤銷的一起算進去，於是撤銷之後補不了卡。唯一鍵因此是 `(employee_id, work_date, attendance_type_code, revoked_seq)`，有效紀錄恆為 `0`，撤銷時填入遞增值。作法與 `employees.deleted_seq` 相同。

**本人撤銷（`revoke`）與他人撤銷（`revoke-other`）共用同一組 `revoked_*` 欄位，不另外分流。** `revoke` 端點只能撤銷 token 推出的本人記錄，`revoke-other` 需要 `attendance.records.revoke-other` 權限碼撤銷他人記錄；事後要分辨這筆是哪一種，比較 `revoked_by` 是否等於這筆記錄 `employee_id` 目前綁定的 `company_users` 帳號即可，不需要在 `revoke_reason` 塞約定文字。`revoke` 撤銷是軟刪除，不寫 `audit_logs`；`revoke-other` 標記作廢並寫入 `audit_logs`（欄位等級見下方「稽核範圍與欄位等級」）。兩種撤銷之後都要重新計算 `attendance_results`，沒有差別。

**撤銷的限制只有一條：該工作日是否已被薪資結算鎖定，不看這筆記錄有沒有被別的流程引用。** 有待審核的補打卡申請指向同一天，或這筆記錄本身是核准補打卡建立出來的（`source_type_code` 為人工補登），都不構成撤銷限制——申請失去依據是申請流程自己該處理的狀態（可被退回或撤回），不需要靠禁止撤銷來預防；用禁止撤銷預防的代價是打錯卡又剛好有人送出補打卡申請時，這筆卡會被鎖死到申請處理完為止，比申請失去依據更難解。薪資結算鎖定的判斷依據是 `payroll_periods.status_code`（見 `docs/schema/02-payroll-calculation-settlement.md`）——**該表目前只存在於文件層級的設計，薪資結算模組（第 5 層）尚未實作**，因此這條鎖定檢查在薪資模組上線前只能是固定回傳「未鎖定」的樁，不是真的能查到結算狀態；薪資模組上線時，依 `work_date` 落在哪一個 `payroll_period_id` 區間查其 `status_code` 是否為「已結算」即可接上，不需要更動撤銷流程其餘邏輯。

**「有效狀態」不另設欄位**：`revoked_at IS NULL` 就是有效。多一個 `is_active` 會產生「`revoked_at` 有值但 `is_active` 仍為 true」這種組合，而它**不會報錯**，只會讓一筆已撤銷的打卡繼續參與工時計算。

**反查必須是非同步的，打卡不得因反查失敗而失敗。** 打卡當下只寫入座標，`address` 與 `address_resolved_at` 由背景補上。員工在收訊不良的地方按下打卡，不該因為外部服務沒回應就打不成。反查結果要存下來而不是讀取時才算：事後查核要看的是「**當時系統認定的地點**」，而反查服務更新之後歷史地址會跟著變。

**地址反查目前暫停，服務商未定（使用者 2026-08-29 拍板）。** `address`／`address_resolved_at` 現階段一律為 `NULL`；座標本身照常存，不受影響。UI 09／23 已定案「沒有 GPS 或無法取得反查地址時顯示『—』」，因此地點欄位一律顯示「—」。已查證過的服務商方向、待裁示的服務商與精度門檻，見 [06-attendance.md](../plans/06-attendance.md) §4.8。

#### 稽核範圍與欄位等級

**打卡建立、本人撤銷（`revoke`）不寫 `audit_logs`。** 不落在「個資異動／金額設定異動／帳號啟停用與密碼重設／角色權限指派撤銷／審核結果變更」這五類必須稽核的操作裡；`revoked_by`／`revoked_at`／`revoke_reason` 三欄本身已回答「誰、何時、為何撤銷」，不需要再靠 `audit_logs` 重複記錄，且全公司每人每天至少兩次的打卡量體也不適合全部進全域稽核表。

**他人撤銷（`revoke-other`）必須寫 `audit_logs`。** 這是具審核權限者對別人已生效的出勤事實做出「這筆不算數」的處置，性質與「審核結果變更」相鄰，比照該類處理。

**補打卡申請的核准、退回、撤銷核准、撤銷退回（`attendance_correction_reviews` 四個動作）必須寫 `audit_logs`。** 落在「審核結果變更」這一類；`attendance_correction_reviews` 本身雖是不可變的歷程表，但服務的是「這一筆申請的完整流程」查詢，`audit_logs` 服務的是「跨主體、按操作者與時間排序」查詢，兩者面向不同，歷史表不可變不代表可以不進 `audit_logs`。

**欄位等級（僅適用於前述必須稽核的動作；打卡建立與本人撤銷不寫稽核，不適用下表）：**

```
attendance_records（僅 revoke-other 動作適用）:
  clockedAt:            Value     // 打卡時刻本身，不是個資
  attendanceTypeCode:   Value
  latitude:              Presence  // 位置隱私；記進 audit_logs（不加密、append-only）等於讓「誰能看座標」這條可見範圍規則被稽核旁路
  longitude:             Presence
  address:               Presence
  revokeReason:          Value     // 撤銷原因，供未來查核，記值才有稽核意義

attendance_correction_reviews:
  actionCode:            Value
  reason:                Value     // 退回／撤銷原因，審核依據，記值
```

`attendance_settings`（公司打卡規則）異動整表 `Value` 級，比照既有對「規則設定類」一律記值的做法。

### `attendance_correction_requests`

**註釋：** 忘打卡補登申請；上班與下班分開申請。

**設計理由：** 補卡申請與原始打卡分離，讓人工更正必須經過申請與審核，且不直接竄改原始紀錄。

| 欄位名稱               | 資料型態     | 必填性 | 欄位註釋                                                              |
| ---------------------- | ------------ | ------ | --------------------------------------------------------------------- |
| `id`                   | `型態待恢復` | 待核對 | 主鍵，資料唯一識別碼                                                  |
| `employee_id`          | `型態待恢復` | 待核對 | 員工外鍵                                                              |
| `employment_id`        | `型態待恢復` | 待核對 | 任職紀錄外鍵                                                          |
| `employee_schedule_id` | `uuid`       | 必填   | FK → `employee_schedules.id`                                          |
| `attendance_type_code` | `integer`    | 必填   | 申請補登的上班／下班事件類型                                          |
| `requested_clocked_at` | `datetime`   | 必填   | 申請補登的實際打卡時間；較晚版本曾寫作 `requested_at`，語意以此欄為準 |
| `reason`               | `型態待恢復` | 待核對 | 原因                                                                  |
| `status_code`          | `型態待恢復` | 待核對 | 流程或資料狀態代碼                                                    |

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

| 欄位名稱                           | 資料型態   | 必填性   | 欄位註釋                                 |
| ---------------------------------- | ---------- | -------- | ---------------------------------------- |
| `id`                               | `uuid`     | 必填     | PK                                       |
| `attendance_correction_request_id` | `uuid`     | 必填     | FK → `attendance_correction_requests.id` |
| `action_code`                      | `integer`  | 必填     | 核准、退回、撤銷核准或撤銷退回           |
| `action_by`                        | `uuid`     | 必填     | 操作者                                   |
| `action_at`                        | `datetime` | 必填     | 操作時間                                 |
| `reason`                           | `text`     | 條件必填 | 退回及撤銷審核結果時必填                 |
| `created_at`                       | `datetime` | 必填     | 建立時間                                 |

歷程只能新增，不可修改或刪除。薪資尚未開始核算時，已核准及已退回結果均可撤銷並回到待審核；薪資開始核算後只可查看。詳細流程見 [17-ui-attendance-correction-approval.md](../ui/17-ui-attendance-correction-approval.md)。

### `attendance_settings`

**註釋：** 公司打卡規則；GPS 是否啟用不得等同強制必填。

**設計理由：** 出勤容許值與判定參數集中於公司設定，讓遲到、早退等規則能按公司調整，並避免硬寫在程式或每筆結果。

| 欄位名稱                            | 資料型態   | 必填性 | 欄位註釋                                          |
| ----------------------------------- | ---------- | ------ | ------------------------------------------------- |
| `id`                                | `uuid`     | 必填   | PK，公司出勤設定 ID                               |
| `company_id`                        | `uuid`     | 必填   | FK → `companies.id`                               |
| `require_clock_in_before_clock_out` | `boolean`  | 必填   | 是否要求有效上班卡後才能打下班卡；本次需求為 true |
| `allow_employee_cancellation`       | `boolean`  | 必填   | 是否允許員工自行撤銷誤打紀錄；撤銷不得 DELETE     |
| `allow_correction_request`          | `boolean`  | 必填   | 是否允許申請補登                                  |
| `correction_requires_approval`      | `boolean`  | 必填   | 補登是否需審核；通過後才建立正式打卡              |
| `gps_enabled`                       | `boolean`  | 必填   | 是否接受 GPS 資訊                                 |
| `gps_required`                      | `boolean`  | 必填   | GPS 是否強制；本次定案為 false                    |
| `created_at`                        | `datetime` | 必填   | 建立時間                                          |
| `updated_at`                        | `datetime` | 必填   | 修改時間                                          |

**關聯與約束：** `company_id → companies.id`；GPS 開啟不等於強制，缺少 GPS 不得直接判定異常。設定只管理打卡流程，不保存每日判定結果。

### `attendance_results`

**註釋：** 依班表、有效打卡、請假與異動計算的遲到、早退、缺卡等判定結果；不得反向改寫原始打卡或班表。

**設計理由：** 出勤結果保存計算後的判定快照，將原始打卡與規則運算結果分離，便於重算、稽核及供薪資／加班流程引用。

| 欄位名稱               | 資料型態   | 必填性 | 欄位註釋                                       |
| ---------------------- | ---------- | ------ | ---------------------------------------------- |
| `id`                   | `uuid`     | 必填   | PK，出勤結果 ID                                |
| `employee_schedule_id` | `uuid`     | 必填   | FK → `employee_schedules.id`；本次判定所依班表 |
| `employee_id`          | `uuid`     | 必填   | FK → `employees.id`                            |
| `work_date`            | `date`     | 必填   | 班次工作日期，不以跨日打卡的日曆日期取代       |
| `scheduled_minutes`    | `integer`  | 必填   | 應工作分鐘數                                   |
| `worked_minutes`       | `integer`  | 必填   | 實際工作分鐘數                                 |
| `late_minutes`         | `integer`  | 必填   | 遲到分鐘數                                     |
| `early_leave_minutes`  | `integer`  | 必填   | 早退分鐘數                                     |
| `absence_minutes`      | `integer`  | 必填   | 缺勤分鐘數                                     |
| `leave_minutes`        | `integer`  | 必填   | 核准請假分鐘數                                 |
| `overtime_minutes`     | `integer`  | 必填   | 認列加班分鐘數                                 |
| `result_status_code`   | `integer`  | 必填   | 出勤判定狀態代碼                               |
| `calculated_at`        | `datetime` | 必填   | 計算時間                                       |
| `updated_at`           | `datetime` | 必填   | 最後重算時間                                   |

**關聯與約束：** 原始班表、打卡、請假是事實來源，本表只保存計算結果，不得反向改寫來源。班表或有效事件變更時可重算，但已被薪資結算鎖定的歷史不得無痕覆蓋。

**無班表時的判定：`result_status_code` 新增 `NO_SCHEDULE`，不得冒用「正常」。** 沒有班表（排班尚未上線，或該日確實沒有排班）時，`worked_minutes` 仍可由有效打卡配對算出，但 `scheduled_minutes`／`late_minutes`／`early_leave_minutes`／`overtime_minutes`／`absence_minutes` 缺乏應上班時間與休息時段可比較，一律寫 `0`；`result_status_code` 使用新代碼 `NO_SCHEDULE`，與「正常」「遲到」「異常」等既有狀態並列，不與「正常」共用代碼——用「正常」代表「算不出來」會讓畫面把兩種完全不同的情況顯示成同一個外觀，且排班上線後重算時真正「準時」與「還沒判定」的舊紀錄會無法區分。

**判定函式簽章固定為 `computeAttendanceResult(events, schedule: Schedule | null)`，排班上線後傳入真正的 `Schedule` 物件，不另外寫第二份判定邏輯。** `schedule` 為 `null` 時內部跳過遲到／早退／應工時分支，只算 `worked_minutes`，回傳 `NO_SCHEDULE`；排班上線時需要一支「重算全部 `NO_SCHEDULE` 紀錄」的批次動作，否則排班上線前的歷史紀錄永遠停在未判定狀態。
