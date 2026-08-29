-- 權限碼 seed：大目錄 `employments`／`withholding`（實作計畫 docs/plans/05-employee-onboarding.md
-- Stage 3）。節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0014／0019／0024 的檔頭都引用過同一個教訓：
-- 0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 沿用既有規律，接在 departments 的 ...08xx 之後：employments 用 ...09xx，withholding 用
-- ...0Axx（0001=01xx roles、0002=02xx permissions、0003=03xx company-users、0008=04xx
-- sessions、0009=05xx employees、0014=06xx regulatory、0022=07xx shifts、0024=08xx
-- departments）。大目錄 sort_order 同樣遞增：departments 是 80，employments 是 90，
-- withholding 是 100。
--
-- `employments.department-histories.create`（新增部門歷史）**沒有對外端點**（Stage 3 只交付
-- 查詢端點，見 modules/employments/department-histories/employments-department-histories.
-- routes.ts 檔頭），因此這裡不 seed 對應的葉節點權限碼——沒有端點就沒有可以被授權的動作。
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
	('00000000-0000-4000-8000-000000000901', NULL, 'employments', '任職', '任職關係與部門歸屬歷史', 'ACTIVE', 0, 90, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000901', 'employments.main', '任職主檔', '任職：查詢、新增、離職', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000902', 'employments.main.list', '查詢任職清單', NULL, 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000912', '00000000-0000-4000-8000-000000000902', 'employments.main.get', '查詢單一任職', NULL, 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000902', 'employments.main.create', '新增任職', NULL, 'ACTIVE', 1, 30, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000914', '00000000-0000-4000-8000-000000000902', 'employments.main.leave', '辦理離職', '完成後同步停用該員工的公司帳號', 'ACTIVE', 1, 40, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000901', 'employments.department-histories', '部門歷史', '任職期間的部門歸屬歷史：查詢', 'ACTIVE', 0, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000921', '00000000-0000-4000-8000-000000000903', 'employments.department-histories.list', '查詢部門歷史', '依任職查詢；本輪沒有建立端點', 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000a01', NULL, 'withholding', '扣繳設定', '每月薪資扣繳方式及有效期間', 'ACTIVE', 0, 100, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000a01', 'withholding.main', '扣繳設定主檔', '扣繳設定：查詢、新增', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000a11', '00000000-0000-4000-8000-000000000a02', 'withholding.main.list', '查詢扣繳設定清單', NULL, 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000a12', '00000000-0000-4000-8000-000000000a02', 'withholding.main.create', '新增扣繳設定', NULL, 'ACTIVE', 1, 20, 0, NOW(), NOW());
