-- 權限碼 seed：兩個新的頂層大目錄 `dependents`（眷屬）／`labor-pension`（勞退自願提繳率）
-- （實作計畫 docs/plans/05-employee-onboarding.md §3.3、§8 Stage 7）。節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0026／0029 的檔頭都引用過
-- 同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 規律：接續既有的頂層前綴序列（0001=01xx roles、0002=02xx permissions、0003=03xx
-- company-users、0008=04xx sessions、0009=05xx employees、0014=06xx regulatory、
-- 0022=07xx shifts、0024=08xx departments、0025=09xx employments、0026=0Axx withholding、
-- 0029=0Bxx job-titles、0Cxx job-positions）：`dependents` 用 ...0Dxx，`labor-pension` 用
-- ...0Exx。大目錄 sort_order 同樣遞增：job-titles 110、job-positions 120，這裡 dependents 是
-- 130、labor-pension 是 140。
--
-- **`dependents.main` 有三個葉節點（`list`／`create`／`terminate`）**，比照計畫 §6「眷屬新增、
-- 修改及終止」都要留稽核的要求——本輪沒有做「修改」端點（只做建立、查詢、終止），理由見
-- `modules/dependents/main/impl/dependents-main.create.service.ts` 檔頭與本次回報；
-- `labor-pension.main` 只有 `list`／`create` 兩個葉節點，形狀與 0026 的 `withholding.main`
-- 完全同構（本輪同樣只做「新增一筆」，不做「結束舊設定並新增一筆」的複合動作）。
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
	-- ---- 新頂層大目錄：眷屬 ----
	('00000000-0000-4000-8000-000000000d01', NULL, 'dependents', '眷屬', '薪資扣繳／報稅所需扶養親屬及資格條件', 'ACTIVE', 0, 130, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-000000000d01', 'dependents.main', '眷屬主檔', '眷屬：查詢、新增、終止', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-000000000d02', 'dependents.main.list', '查詢眷屬清單', '依員工查詢；身分證字號一律遮罩', 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000d12', '00000000-0000-4000-8000-000000000d02', 'dependents.main.create', '新增眷屬', '可於新增員工時一併新增，也可以後補登', 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000d13', '00000000-0000-4000-8000-000000000d02', 'dependents.main.terminate', '終止扶養', '對既有列做條件式更新，不刪除紀錄', 'ACTIVE', 1, 30, 0, NOW(), NOW()),
	-- ---- 新頂層大目錄：勞退自願提繳率 ----
	('00000000-0000-4000-8000-000000000e01', NULL, 'labor-pension', '勞退自願提繳率', '員工勞退自願提繳率及有效期間', 'ACTIVE', 0, 140, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-000000000e01', 'labor-pension.main', '勞退設定主檔', '勞退自願提繳率：查詢、新增', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000e11', '00000000-0000-4000-8000-000000000e02', 'labor-pension.main.list', '查詢勞退設定清單', NULL, 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000e12', '00000000-0000-4000-8000-000000000e02', 'labor-pension.main.create', '新增勞退設定', NULL, 'ACTIVE', 1, 20, 0, NOW(), NOW());
