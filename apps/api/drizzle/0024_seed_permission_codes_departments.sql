-- 權限碼 seed：大目錄 `departments`（實作計畫 docs/plans/05-employee-onboarding.md Stage 1）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0014／0019 的檔頭都引用過同一個教訓：0009 補
-- seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 沿用既有規律，接在 shifts 的 ...07xx 之後用 ...08xx（0001=01xx roles、0002=02xx
-- permissions、0003=03xx company-users、0008=04xx sessions、0009=05xx employees、
-- 0014=06xx regulatory、0022=07xx shifts）。大目錄 sort_order 同樣遞增：
-- 10、20、30、40、50、60、70 之後是 80。
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
	('00000000-0000-4000-8000-000000000801', NULL, 'departments', '部門', '班別以外的組織架構設定', 'ACTIVE', 0, 80, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801', 'departments.main', '組織架構', '部門樹：查詢、新增、修改、刪除', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000802', 'departments.main.tree', '查詢部門樹', '整棵樹，不分頁', 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000802', 'departments.main.get', '查詢單一部門', NULL, 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000813', '00000000-0000-4000-8000-000000000802', 'departments.main.create', '新增部門', '可指定上層部門', 'ACTIVE', 1, 30, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000814', '00000000-0000-4000-8000-000000000802', 'departments.main.update', '修改部門', '含改上層部門（搬移子樹）與啟用／停用', 'ACTIVE', 1, 40, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000815', '00000000-0000-4000-8000-000000000802', 'departments.main.delete', '刪除部門', '軟刪除（§4.3）；有子部門時拒絕', 'ACTIVE', 1, 50, 0, NOW(), NOW());
