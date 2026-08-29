-- 權限碼 seed：新的次目錄 `attendance.results`（實作計畫 docs/plans/06-attendance.md §5 Stage 4）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0026／0027／0029／0033
-- 的檔頭都引用過同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 規律：延續 0037／0039 已經開的 `attendance` 前綴序列（...0Fxx）。`attendance` 大目錄本身
-- （f01）已在 0037 建立，這裡新增 `attendance.results` 次目錄（f04，sort_order 30，接續
-- `attendance.settings`=10、`attendance.records`=20）與它底下唯一的葉節點（f31，延續
-- `attendance.settings` 用 f1x、`attendance.records` 用 f2x 的分段慣例，這裡用 f3x）。
--
-- **本次目錄只有一個動作，且不是查詢或撤銷，是「重算全部 NO_SCHEDULE 紀錄」的批次維護動作**
-- （計畫 §4.1）：排班（第 3 層）尚未上線前，這支端點對已存在的判定結果重新套用
-- `computeAttendanceResult`；主要用途在排班上線後，把停留在 `NO_SCHEDULE` 狀態的歷史紀錄
-- 換算成真正對照班表的判定。查詢類端點（依員工／依日期查判定結果）排在 Stage 7
-- （對應「全體出勤」「我的出勤」兩個畫面），本輪不開。
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
	-- ---- 新次目錄：出勤判定結果 ----
	('00000000-0000-4000-8000-000000000f04', '00000000-0000-4000-8000-000000000f01', 'attendance.results', '出勤判定結果', '依班表、有效打卡計算的遲到、早退、缺卡等判定；本輪只有批次重算一個動作，查詢排在 Stage 7', 'ACTIVE', 0, 30, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f31', '00000000-0000-4000-8000-000000000f04', 'attendance.results.recalculate-no-schedule', '重算全部未排班判定', '重新計算目前狀態為 NO_SCHEDULE 的判定結果；排班上線後用來把歷史紀錄換算成對照班表的判定', 'ACTIVE', 1, 10, 0, NOW(), NOW());
