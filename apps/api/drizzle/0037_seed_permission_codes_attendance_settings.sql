-- 權限碼 seed：新的頂層大目錄 `attendance`，本輪只開次目錄 `attendance.settings`
-- （實作計畫 docs/plans/06-attendance.md §5 Stage 2）。節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0026／0027／0029／0033
-- 的檔頭都引用過同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 規律：接續既有的頂層前綴序列（0001=01xx roles、0002=02xx permissions、0003=03xx
-- company-users、0008=04xx sessions、0009=05xx employees、0014=06xx regulatory、
-- 0022=07xx shifts、0024=08xx departments、0025=09xx employments、0026=0Axx withholding、
-- 0029=0Bxx job-titles、0Cxx job-positions、0033=0Dxx dependents、0Exx labor-pension）：
-- `attendance` 用 ...0Fxx。大目錄 sort_order 同樣遞增：dependents 130、labor-pension 140，
-- 這裡 attendance 是 150；`attendance.settings` 是本次唯一的次目錄，sort_order 10。
--
-- **`attendance.settings` 只有 `get`／`update` 兩個葉節點，沒有 `list`／`create`／`delete`**：
-- 這張表是「一間公司一筆」的單例設定（見 src/db/schema/attendance-settings.ts 檔頭的完整推論），
-- CRUD 的形狀是「查目前設定 ＋ 更新」，`update` 在公司從未存過設定時等同「建立」，因此不需要、
-- 也不應該另開一支 `create`——多開一支只會製造「該呼叫哪一支」的假選擇。
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
	-- ---- 新頂層大目錄：出勤 ----
	('00000000-0000-4000-8000-000000000f01', NULL, 'attendance', '出勤', '打卡與出勤設定；本輪只開出勤設定，打卡本體排在後續階段', 'ACTIVE', 0, 150, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000f01', 'attendance.settings', '出勤設定', '公司打卡規則：GPS、撤銷、補打卡等開關；一間公司一筆', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000f02', 'attendance.settings.get', '查詢出勤設定', '尚未設定過時回傳 data: null，不是錯誤', 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f12', '00000000-0000-4000-8000-000000000f02', 'attendance.settings.update', '修改出勤設定', '尚未存過設定時本端點即建立第一筆；不另開 create', 'ACTIVE', 1, 20, 0, NOW(), NOW());
