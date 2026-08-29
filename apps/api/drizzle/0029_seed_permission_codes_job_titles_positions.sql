-- 權限碼 seed：大目錄 `job-titles`／`job-positions`，以及 `employments` 新增的兩個次目錄
-- `job-title-histories`／`job-position-histories`（實作計畫 docs/plans/05-employee-onboarding.md
-- Stage 5）。節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024 的檔頭都引用過同一個教訓：
-- 0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 規律：
--   `job-titles`／`job-positions` 是**新的頂層大目錄**（與 `departments`／`employments`／
--   `withholding` 同一層級，不是 `employees` 底下的次目錄），接續既有的頂層前綴序列
--   （0001=01xx roles、0002=02xx permissions、0003=03xx company-users、0008=04xx sessions、
--   0009=05xx employees、0014=06xx regulatory、0022=07xx shifts、0024=08xx departments、
--   0025=09xx employments、0026=0Axx withholding）：`job-titles` 用 ...0Bxx，`job-positions`
--   用 ...0Cxx。大目錄 sort_order 同樣遞增：departments 80、employments 90、withholding 100，
--   這裡 job-titles 是 110、job-positions 是 120。
--
--   `employments.job-title-histories`／`employments.job-position-histories` 接在既有的
--   `employments`（...09xx）前綴底下，比照 0025 已經開出的兩個次目錄
--   （0902=employments.main、0903=employments.department-histories）：這裡開 0904／0905，
--   葉節點各自用 093x／094x 區塊（0025 的 0902 用 091x、0903 用 092x，同一種「次目錄借一個十位
--   區塊」的規律）。
--
-- **與 0025 的 `employments.department-histories` 不同：本輪兩張歷史表都開了 `create` 端點**
-- （見 `modules/employments/job-title-histories/employments-job-title-histories.routes.ts`、
-- `modules/employments/job-position-histories/employments-job-position-histories.routes.ts`
-- 的檔頭說明——UI 定案「可以修改部門、職稱及一個或多個職務」需要真正的建立端點，不只是
-- Stage 4 編排點內部呼叫），因此兩個次目錄都有 `list` 與 `create` 兩個葉節點，不像 0025 的
-- `employments.department-histories` 只有 `list`。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區再寫入時間（§6）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
SET time_zone = '+08:00';
--> statement-breakpoint
INSERT INTO `permissions`
	(`id`, `parent_id`, `code`, `name`, `description`, `status`, `is_assignable`, `sort_order`, `deleted_seq`, `created_at`, `updated_at`)
VALUES
	-- ---- employments 新增次目錄：職稱歷史 ----
	('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000901', 'employments.job-title-histories', '職稱歷史', '任職期間的職稱歷史：查詢、新增', 'ACTIVE', 0, 30, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000904', 'employments.job-title-histories.list', '查詢職稱歷史', '依任職查詢', 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000932', '00000000-0000-4000-8000-000000000904', 'employments.job-title-histories.create', '新增職稱歷史', '同一任職同一時間僅一筆有效職稱', 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	-- ---- employments 新增次目錄：職務歷史 ----
	('00000000-0000-4000-8000-000000000905', '00000000-0000-4000-8000-000000000901', 'employments.job-position-histories', '職務歷史', '任職期間的職務歷史：查詢、新增（同一任職可同時有多筆有效職務）', 'ACTIVE', 0, 40, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000905', 'employments.job-position-histories.list', '查詢職務歷史', '依任職查詢', 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000942', '00000000-0000-4000-8000-000000000905', 'employments.job-position-histories.create', '新增職務歷史', '一次指派一或多個職務，全部共用同一段有效期間', 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	-- ---- 新頂層大目錄：職稱主檔 ----
	('00000000-0000-4000-8000-000000000b01', NULL, 'job-titles', '職稱', '職稱主檔（系統預設與公司自訂）', 'ACTIVE', 0, 110, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000b01', 'job-titles.main', '職稱主檔管理', '職稱：查詢、新增、修改、刪除', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-000000000b02', 'job-titles.main.list', '查詢職稱清單', NULL, 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000b12', '00000000-0000-4000-8000-000000000b02', 'job-titles.main.get', '查詢單一職稱', NULL, 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000b13', '00000000-0000-4000-8000-000000000b02', 'job-titles.main.create', '新增職稱', '一律新增公司自訂職稱', 'ACTIVE', 1, 30, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000b14', '00000000-0000-4000-8000-000000000b02', 'job-titles.main.update', '修改職稱', '系統預設職稱不得修改', 'ACTIVE', 1, 40, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000b15', '00000000-0000-4000-8000-000000000b02', 'job-titles.main.delete', '刪除職稱', '軟刪除；系統預設職稱不得刪除', 'ACTIVE', 1, 50, 0, NOW(), NOW()),
	-- ---- 新頂層大目錄：職務主檔 ----
	('00000000-0000-4000-8000-000000000c01', NULL, 'job-positions', '職務', '職務主檔（系統預設與公司自訂，與職稱分離）', 'ACTIVE', 0, 120, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-000000000c01', 'job-positions.main', '職務主檔管理', '職務：查詢、新增、修改、刪除', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c02', 'job-positions.main.list', '查詢職務清單', NULL, 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000c12', '00000000-0000-4000-8000-000000000c02', 'job-positions.main.get', '查詢單一職務', NULL, 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000c13', '00000000-0000-4000-8000-000000000c02', 'job-positions.main.create', '新增職務', '一律新增公司自訂職務', 'ACTIVE', 1, 30, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000c14', '00000000-0000-4000-8000-000000000c02', 'job-positions.main.update', '修改職務', '系統預設職務不得修改', 'ACTIVE', 1, 40, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000c15', '00000000-0000-4000-8000-000000000c02', 'job-positions.main.delete', '刪除職務', '軟刪除；系統預設職務不得刪除', 'ACTIVE', 1, 50, 0, NOW(), NOW());

-- `employees.onboarding.create` 現在額外可能呼叫 `employments.job-title-histories.create`與
-- `employments.job-position-histories.create`（選填步驟，見 `employees-onboarding.errors.ts`），
-- 但到職編排本身不需要呼叫端另外持有這兩個新權限碼——編排點是單一交易內部呼叫子模組的業務動作，
-- 不經過 HTTP，因此不受權限檢查（權限檢查只發生在 HTTP 入口，§5.2）。這裡不需要為
-- `employees.onboarding` 新增任何欄位或關聯。
