-- `shift_breaks`：班別的休息時段，可多段、分有薪無薪（資料字典 docs/schema/03-scheduling-attendance.md
-- 「排班 Schema」；實作計畫 docs/plans/04-shift-definitions.md §4.2、§5.2）。
--
-- **與資料字典不同：新增 `start_day_offset` 與 `end_day_offset` 兩欄——計畫對資料字典的唯一增補。**
-- 字典原本只有 start_time／end_time，shift_work_periods 有 end_day_offset 但本表沒有。
-- 具體情境：22:00–06:00 的夜班休息 02:00–03:00，start_time 存 02:00——這個 02:00 是班次開始前
-- 二十小時，還是開始後四小時？從欄位上分不出來，兩種讀法對出勤判定會算出完全不同的分鐘數。
-- 字典明列跨日班與多段休息都在範圍內，所以這不是「用不到」，是欄位不足。
-- 為什麼不能靠「休息一定落在某個工作時段內」反推：中空班的兩段工作之間本來就有空檔，
-- 那個空檔可能跨過午夜，反推需要一串條件判斷，而條件判斷寫錯不會報錯——不如直接存下來。
--
-- 本表沒有 company_id、不進 CompanyScopedTable、單欄外鍵，理由與 shift_work_periods 相同
-- （見 0020 檔頭）：公司範圍由 shift_definition_id 間接決定，存取一律經由 shift_definitions
-- 的 service，本表沒有自己的 company_id 可能填錯，沒有跨公司指錯這個破口需要堵。
--
-- id 型態理由同 shift_work_periods：字典標記「型態待恢復」，比照全站慣例採用 UUID。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區（§6，理由見 0019 檔頭）：本支只有 DDL、不寫入任何時間值，但仍然釘住。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `shift_breaks` (
	`id` CHAR(36) NOT NULL,
	`shift_definition_id` CHAR(36) NOT NULL,
	-- 同一班別內休息時段的順序，從 1 開始；由呼叫端／service 指定，不是資料庫自動編號。
	`sequence_no` INT NOT NULL,
	-- 台北時間、不帶日期（§6.1）。
	`start_time` TIME NOT NULL,
	`end_time` TIME NOT NULL,
	-- 與資料字典不同：新增欄位，見檔頭。開始時刻相對於班次開始日的日偏移。
	`start_day_offset` INT NOT NULL,
	-- 與資料字典不同：新增欄位，見檔頭。結束時刻相對於班次開始日的日偏移，
	-- 與 shift_work_periods.end_day_offset 同一機制。
	`end_day_offset` INT NOT NULL,
	-- 休息分鐘數。由 service 計算，不由呼叫端送：必須等於起訖時間之差（含日偏移），
	-- 理由與 shift_work_periods.work_minutes 是同一件事（計畫 §4.1、§5.2）。
	`break_minutes` INT NOT NULL,
	-- 是否為有薪休息；無薪休息會從 shift_definitions.required_work_minutes 中扣除（計畫 §4.1）。
	`is_paid` BOOLEAN NOT NULL,
	CONSTRAINT `shift_breaks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_shift_breaks_shift_sequence` UNIQUE(`shift_definition_id`,`sequence_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='班別的休息時段，可多段、分有薪無薪；日偏移欄位為本計畫對資料字典的唯一增補';
--> statement-breakpoint
-- 單欄外鍵，理由同 shift_work_periods（見 0020 檔頭）。
-- 這條外鍵不需要額外索引：uq_shift_breaks_shift_sequence 的前綴就是 shift_definition_id。
ALTER TABLE `shift_breaks` ADD CONSTRAINT `fk_shift_breaks_shift_definition` FOREIGN KEY (`shift_definition_id`) REFERENCES `shift_definitions`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
