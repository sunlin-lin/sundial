-- `shift_work_periods`：班別的工作時段，一天可多段，用以表達跨日班、分段班與中空班
-- （資料字典 docs/schema/03-scheduling-attendance.md「排班 Schema」；實作計畫 docs/plans/04-shift-definitions.md §5.2）。
--
-- **本表沒有 `company_id`，不進 CompanyScopedTable**（src/db/schema/index.ts，計畫 §5.2）：
-- 公司範圍由 `shift_definition_id` 間接決定，存取一律經由 shift_definitions 的 service，
-- 不單獨開端點。外鍵因此是單欄（→ shift_definitions.id），不是複合外鍵——本表沒有自己的
-- company_id 可能填錯，沒有「跨公司指錯」這個破口需要堵。
--
-- **約束（本輪只做資料庫層）**：`UNIQUE(shift_definition_id, sequence_no)` 由下方唯一鍵保證。
-- 工作時段不得重疊、`work_minutes` 必須等於起訖時間之差（含 end_day_offset，由 service 計算，
-- 不由呼叫端送，理由同 shift_definitions.required_work_minutes）——這兩條是業務規則，
-- 不是資料庫約束能表達的形狀，留給 Stage 2 的 service。
--
-- id 型態：資料字典標記「型態待恢復」，比照全站慣例採用 UUID（CHAR(36)）——本站具業務意義的
-- 主鍵除法規三表與 company_regulatory_settings（BIGINT auto-increment）外一律是 uuid。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區（§6，理由見 0019 檔頭）：本支只有 DDL、不寫入任何時間值，但仍然釘住
-- ——判準若變成「這一支有沒有寫時間」，每加一支就要重新判斷一次，漏判的後果沒有任何症狀。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `shift_work_periods` (
	`id` CHAR(36) NOT NULL,
	`shift_definition_id` CHAR(36) NOT NULL,
	-- 同一班別內工作時段的順序，從 1 開始；由呼叫端／service 指定，不是資料庫自動編號。
	`sequence_no` INT NOT NULL,
	-- 台北時間、不帶日期（§6.1：不含日期的時刻）。
	`start_time` TIME NOT NULL,
	`end_time` TIME NOT NULL,
	-- 結束日相對於開始日的偏移；跨日班用 1。與 shift_breaks 的日偏移欄位同一機制（計畫 §4.2）。
	`end_day_offset` INT NOT NULL,
	-- 此工作時段應工作分鐘數。由 service 計算，不由呼叫端送（計畫 §5.2）：必須等於起訖時間之差
	-- （含 end_day_offset），送進來的值與算出來的值若不一致，處置沒有標準答案，因此乾脆不收。
	`work_minutes` INT NOT NULL,
	CONSTRAINT `shift_work_periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_shift_work_periods_shift_sequence` UNIQUE(`shift_definition_id`,`sequence_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='班別的工作時段，一天可多段，表達跨日班、分段班與中空班';
--> statement-breakpoint
-- 單欄外鍵：本表沒有 company_id，只要 shift_definition_id 指得到一筆存在的 shift_definitions，
-- 公司範圍自然就是那一筆的 company_id，不需要（也無法）在這裡再約束一次。
-- 這條外鍵不需要額外索引：uq_shift_work_periods_shift_sequence 的前綴就是 shift_definition_id。
ALTER TABLE `shift_work_periods` ADD CONSTRAINT `fk_shift_work_periods_shift_definition` FOREIGN KEY (`shift_definition_id`) REFERENCES `shift_definitions`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
