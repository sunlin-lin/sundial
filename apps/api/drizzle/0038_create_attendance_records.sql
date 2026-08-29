-- `attendance_records`：正常或核准補登形成的正式打卡事件（資料字典
-- docs/schema/03-scheduling-attendance.md「出勤 Schema」attendance_records 節，含「打卡欄位
-- 定案」節；實作計畫 docs/plans/06-attendance.md §4.2～§4.6、§5 Stage 3）。
--
-- 與資料字典不同之處都寫在 src/db/schema/attendance-records.ts 的欄位與索引註解裡，這裡摘要
-- 最重要的兩點：
--   1. 座標與反查地址（`latitude`／`longitude`／`address`）為明文欄位，不是 `*_encrypted`
--      ——應用層加密已整組移除，機密性交由資料庫端靜態加密負責（§5.1）。
--   2. `employee_schedule_id`／`source_id` 只有欄位，沒有外鍵：目標表（`employee_schedules`／
--      `attendance_correction_requests`）在本階段都還不存在，這是誠實的階段性缺口。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區再寫入時間（§6）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `attendance_records` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employee_id` char(36) NOT NULL,
	`employment_id` char(36) NOT NULL,
	`employee_schedule_id` char(36),
	`work_date` date NOT NULL,
	`attendance_type_code` int NOT NULL,
	`source_type_code` int NOT NULL,
	`source_id` char(36),
	`clocked_at` datetime NOT NULL,
	`latitude` decimal(9,7),
	`longitude` decimal(10,7),
	`accuracy_meters` int,
	`address` varchar(255),
	`address_resolved_at` datetime,
	`revoked_at` datetime,
	`revoked_by` char(36),
	`revoke_reason` text,
	`revoked_seq` bigint NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `attendance_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_attendance_records_employee_work_date_type_seq` UNIQUE(`employee_id`,`work_date`,`attendance_type_code`,`revoked_seq`)
);
--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `fk_attendance_records_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `fk_attendance_records_employee` FOREIGN KEY (`company_id`,`employee_id`) REFERENCES `employees`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `fk_attendance_records_employment` FOREIGN KEY (`company_id`,`employment_id`) REFERENCES `employee_employments`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `fk_attendance_records_revoked_by` FOREIGN KEY (`company_id`,`revoked_by`) REFERENCES `company_users`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_attendance_records_company_work_date` ON `attendance_records` (`company_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `ix_attendance_records_company_employment_type_seq` ON `attendance_records` (`company_id`,`employment_id`,`attendance_type_code`,`revoked_seq`,`work_date`);--> statement-breakpoint
CREATE INDEX `ix_attendance_records_company_revoked_by` ON `attendance_records` (`company_id`,`revoked_by`);