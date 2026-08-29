-- `attendance_settings`：公司打卡規則主檔（資料字典 docs/schema/03-scheduling-attendance.md
-- 「出勤 Schema」attendance_settings 節；實作計畫 docs/plans/06-attendance.md §5 Stage 2）。
--
-- 與資料字典不同之處都寫在 src/db/schema/attendance-settings.ts 的欄位與索引註解裡，這裡摘要
-- 最重要的一點：**沒有 `deleted_at`／`deleted_seq`**——這張表是「一間公司一筆」的單例設定，
-- 唯一鍵是 `UNIQUE(company_id)` 本身，不是「代碼＋軟刪除序號」那一類需要重用識別鍵的表，
-- 公司被刪除時整列一起清空即可（`companyScopedTablesInDeleteOrder`，db/schema/index.ts）。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區再寫入時間（§6）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `attendance_settings` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	-- 是否要求有效上班卡後才能打下班卡；字典「本次需求為 true」（由 service 層在建立時代入）。
	`require_clock_in_before_clock_out` boolean NOT NULL,
	-- 是否允許員工自行撤銷誤打紀錄；撤銷不得 DELETE（字典「打卡欄位定案」節）。
	`allow_employee_cancellation` boolean NOT NULL,
	-- 是否允許申請補登。
	`allow_correction_request` boolean NOT NULL,
	-- 補登是否需審核；通過後才建立正式打卡。
	`correction_requires_approval` boolean NOT NULL,
	-- 是否接受 GPS 資訊。
	`gps_enabled` boolean NOT NULL,
	-- GPS 是否強制；字典「本次定案為 false」。GPS 開啟不等於強制，缺少 GPS 不得直接判定異常。
	`gps_required` boolean NOT NULL,
	-- datetime 存的就是台北牆鐘時間，不做任何換算（§6）。
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `attendance_settings_id` PRIMARY KEY(`id`),
	-- 一間公司一筆的唯一保證：見 db/schema/attendance-settings.ts 檔頭「為什麼是單例」的完整推論。
	-- 這個索引以 company_id 開頭，同時滿足 §4.5「帶 company_id 的表，索引必須以它開頭」。
	CONSTRAINT `uq_attendance_settings_company_id` UNIQUE(`company_id`)
);
--> statement-breakpoint
ALTER TABLE `attendance_settings` ADD CONSTRAINT `fk_attendance_settings_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;
