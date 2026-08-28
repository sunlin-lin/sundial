# 法規同步、系統管理與結算邊界

## 系統管理分層

- 系統設定：角色、權限、帳號與系統參數，回答「誰能做什麼」。
- 法規設定：政府資料與公司投保設定，回答「依法怎麼算」。
- 稽核日誌：橫跨薪資、補休、請假、打卡撤銷、核發及權限異動，回答「誰何時改了什麼」。

## 法規四表定案

### `company_regulatory_settings`

**註釋：** 公司職災行業別、投保單位類別及生效歷史。

**設計理由：** 公司法規設定只保存公司採用的同步與套用選項，將公司偏好與中央法規資料分離，避免每家公司複製整份法規。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `bigint` | 必填 | 主鍵，資料唯一識別碼 |
| `company_id` | `bigint/uuid` | 必填 | 所屬公司外鍵 |
| `occupational_industry_code` | `varchar(30)` | 必填 | 公司職業災害保險行業別代碼 |
| `insurance_unit_type_code` | `varchar(30)` | 必填 | 投保單位類別代碼 |
| `effective_from` | `date` | 必填 | 生效開始日 |
| `effective_to` | `date` | 選填 | 生效結束日 |
| `created_by` | `FK` | 必填 | 建立者外鍵 |
| `created_at` | `datetime` | 必填 | 建立時間 |

公司只保存選擇，不複製政府當期費率；同公司有效期間不得重疊。

### `regulatory_dataset_versions`

**註釋：** 平台共用的政府資料歷史版本與原始 Snapshot。

**設計理由：** 法規資料集採版本表並保存生效日，可同時保留歷史與未來版本；不使用 is_current，因「目前版本」應由生效區間判定而非容易失真的旗標。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `bigint` | 必填 | 主鍵，資料唯一識別碼 |
| `dataset_code` | `integer` | 必填 | 法規資料集代碼 |
| `version_code` | `varchar(30)` | 必填 | 西元版本代碼，例如 `2026-01` |
| `effective_from` | `date` | 必填 | 版本生效日 |
| `effective_to` | `date` | 選填 | 版本失效日；可由下一版本推導 |
| `government_resource_id` | `varchar(150)` | 選填 | 本次取得的政府資源識別碼，不視為永久固定 URL |
| `source_modified_at` | `datetime` | 選填 | 政府來源標示的修改時間 |
| `synced_at` | `datetime` | 必填 | 同步完成時間 |
| `checksum` | `varchar(128)` | 必填 | 原始內容雜湊，用於判斷內容是否改變 |
| `record_count` | `integer` | 選填 | 解析後筆數 |
| `raw_format_code` | `integer` | 必填 | 原始資料格式代碼 |
| `raw_data` | `LONGTEXT` | 必填 | 政府原始資料 Snapshot |
| `created_at` | `datetime` | 必填 | 建立時間 |

約束：`UNIQUE(dataset_code, version_code)`；`effective_from` 必填；不用 `is_current`。

### `regulatory_records`

**註釋：** 政府原始資料解析後供 Payroll 查詢的標準化資料。

**設計理由：** 同一版本內以 record_key 對應多筆法規內容，通用 data 欄先承載不同資料集結構，可在未確認專屬欄位前避免過早拆出錯誤 Schema。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `bigint` | 必填 | 主鍵，資料唯一識別碼 |
| `dataset_version_id` | `bigint` | 必填 | 政府法規版本外鍵 |
| `record_key` | `varchar(150)` | 必填 | 同一版本內穩定且唯一的資料鍵 |
| `code` | `varchar(100)` | 選填 | 業務代碼 |
| `name` | `varchar(250)` | 選填 | 顯示名稱 |
| `range_from` | `decimal(18,4)` | 選填 | 級距下限 |
| `range_to` | `decimal(18,4)` | 選填 | 級距上限 |
| `amount` | `decimal(18,4)` | 選填 | 金額或計算基礎值 |
| `rate` | `decimal(18,8)` | 選填 | 費率／比率 |
| `data` | `json` | 必填 | 無法由通用欄位承載的完整標準化內容 |
| `sort_order` | `integer` | 選填 | 同版本顯示／運算順序 |
| `created_at` | `datetime` | 必填 | 建立時間 |

約束：`UNIQUE(dataset_version_id, record_key)`。所得稅特殊結構先放 `data`，暫不另拆表。

### `regulatory_sync_logs`

**註釋：** 每次自動排程或人工同步結果。

**設計理由：** 同步紀錄獨立保存每次下載、驗證與套用結果，讓失敗可追查且不影響已生效資料，亦不以最後同步時間取代完整歷程。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `bigint` | 必填 | 主鍵，資料唯一識別碼 |
| `dataset_code` | `integer` | 必填 | 本次同步的法規資料集代碼 |
| `trigger_type_code` | `integer` | 必填 | 1 自動排程、2 人工觸發 |
| `started_at` | `datetime` | 必填 | 同步開始時間 |
| `finished_at` | `datetime` | 選填 | 同步結束時間 |
| `status_code` | `integer` | 必填 | 1 執行中、2 更新成功、3 失敗、4 無異動 |
| `dataset_version_id` | `bigint` | 選填 | 成功產生／辨識出的版本 FK |
| `government_resource_id` | `varchar(150)` | 選填 | 本次實際使用的政府資源識別碼 |
| `records_received` | `integer` | 選填 | 本次收到／解析筆數 |
| `error_message` | `text` | 選填 | 失敗原因 |
| `created_at` | `datetime` | 必填 | 建立時間 |

同步失敗不得破壞既有有效版本。

## 明確不建立／被推翻方案

- `regulatory_sources`
- `regulatory_datasets`
- 永久固定 Resource URL
- Version + Revision
- 政府撤回流程
- 人工核准每個法規版本
- `is_current`

抓取、Metadata、Resource 探索與解析器由程式碼管理；DB 保存版本、原始資料、標準化資料與同步紀錄。

## Payroll 邊界

- 法規模組提供歷史政府資料，Payroll 負責計算。
- 不同法規可使用不同版本，不能只放一個 `regulatory_version_id`。
- 版本依各法規適用基準日選擇，不依系統當天日期。
- 已結算 Payroll 鎖定勞保、健保、勞退、職災與所得稅實際版本；政府後續更新不得改寫。
- 最低工資、加班費等法律公式屬計算邏輯，不因抓到 Open Data 就自動改演算法。

## 稽核日誌

表名已定案為 `audit_logs`，逐欄 Schema 見下。實作計畫見 [實作計畫：稽核紀錄](../plans/02-audit-logs.md)。

### `audit_logs`

**註釋：** 誰在什麼時候改了哪一筆資料，以及改了什麼。

**設計理由：** 稽核紀錄獨立且只承載「資料異動」一種語意，不混入登入行為、系統 log 或查詢行為——稽核要求「一筆不少、永久保存、不可修改」，行為紀錄要求「量大、可過期清理、可取樣」，兩種保存策略互斥；混在同一張表就只能取其一，而通常取到的是後者，稽核紀錄會跟著被清掉。

| 欄位名稱 | 資料型態 | 必填性 | 欄位註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵，資料唯一識別碼 |
| `company_id` | `uuid` | 必填 | 所屬公司外鍵 |
| `actor_type_code` | `integer` | 必填 | 1 公司成員、2 系統（排程／驗證器） |
| `actor_company_user_id` | `uuid` | 條件必填 | 操作者公司成員外鍵；`actor_type_code=1` 時必填 |
| `action` | `varchar(150)` | 必填 | 動作碼，由模組路徑推導，例如 `employees.main.update` |
| `subject_table` | `varchar(64)` | 必填 | 資料主體所在的表，例如 `employees` |
| `subject_id` | `varchar(64)` | 必填 | 資料主體主鍵的字串形式；uuid 直接存，`bigint` 存十進位字串 |
| `changes` | `json` | 必填 | 逐欄差異；新增時 `before` 為 NULL，刪除時 `after` 為 NULL |
| `effective_date` | `date` | 選填 | 適用時的生效日；帶生效日的異動才有 |
| `created_at` | `datetime` | 必填 | 建立時間，即「操作時間」——稽核與業務同一交易寫入，兩者必然相同 |

**`subject_id` 為何是字串而非 `uuid`：** 全站主鍵型態不只一種（法規三表與 `company_regulatory_settings` 用 `bigint`），而公司投保設定正是稽核表要服務的第一個對象。訂成 `uuid` 會讓它存不進去，且要到那個模組動工才會發現，屆時已套用的 migration 不得修改。

**明確不含：** `updated_at`、`deleted_at`。稽核紀錄不得修改或刪除，schema 上不提供這兩欄，等同於不宣告「這筆可以改」。判準見開發通用規範 §1.4 的「append-only 事件流水表」補集。

**明確不含：** `occurred_at`。不設第二個時間欄位——並存的話「哪一個才是真正的操作時間」會變成每次讀稽核都要重想一次的問題。

**明確不含：** IP、User-Agent、裝置資訊。登入行為屬於另一種紀錄，另有規劃。

**外鍵：** `company_id → companies.id`；`(company_id, actor_company_user_id) → company_users(company_id, id)` **複合外鍵**。單欄外鍵會讓「A 公司的稽核紀錄」指向 B 公司的成員而資料庫完全接受，與 `company_user_roles.assigned_by` 當初的修正同一理由。`actor_type_code=2` 時該欄為 NULL，MATCH SIMPLE 語意下不檢查。

**索引：** `(company_id, subject_table, subject_id, created_at)`、`(company_id, created_at)`、`(company_id, actor_company_user_id, created_at)`；三支索引皆以 `company_id` 起頭。

**`changes` 的欄位分級：** 每一張被稽核的表逐欄宣告可入稽核的程度——`value`（記前後值）、`presence`（只記「這一欄變更了」，不記值）、`excluded`（明確不記）。未分類的欄位由檢查腳本擋下。`presence` 是「密碼與身分證不得寫入」與「重設密碼、修改身分證必須留紀錄」兩條同時成立的唯一解。

依本輪「員工清單」UI 定案，稽核範圍增加並確認包含：

- 員工建立及員工編號修改。
- 基本資料修改。
- 任職資料與離職操作。
- 部門、職稱及職務異動。
- 眷屬新增、修改及終止。
- 扣繳方式與勞退自願提繳率異動。
- 帳號啟用、停用及管理者重設密碼。
- 角色指派與撤銷。
- 員工薪資設定及薪轉帳戶異動。

每筆紀錄至少要能表達操作者、操作時間、操作類型、資料主體、異動前後差異及適用時的生效日。密碼、密碼 Hash、完整身分證字號與完整銀行帳號不得寫入稽核內容。

員工修改頁的「歷史紀錄」由各有效期間歷史表與系統稽核紀錄整合查詢，不另建立一份重複的員工歷史快照表。操作規格見 [員工清單 UI 定案](../ui/20-employee-list.md)。

## 已確認但待後續獨立細化

- 離職生效、未休假、補休與最終薪資結算。
- 報表／統計、通知中心、員工自助入口及附件中心。
- 法定計算公式的版本化實作細節。




