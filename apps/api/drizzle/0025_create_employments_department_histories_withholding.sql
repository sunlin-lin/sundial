-- employee_employments／employee_department_histories／employee_withholding_settings：
-- 任職、部門歷史、扣繳設定（資料字典 docs/schema/02-employee-payroll-cost.md；
-- 實作計畫 docs/plans/05-employee-onboarding.md Stage 3）。
--
-- 與資料字典不同之處（三張表共同）：新增 company_id 欄位（字典沒有，公司範圍原本要透過
-- employee_id／employment_id 才能間接得到）。TenantDatabase（apps/api/src/db/client.ts，§4.2）
-- 要求帶公司範圍的表要自己有一欄 company_id，否則每支查詢都要手寫 JOIN 才能拿到公司條件——
-- 那正是 §4.2 想堵住的破口。複合外鍵 (company_id, employee_id/employment_id) → 對應表
-- (company_id, id) 保證這一欄不會被填成與被參照列不同的公司，因此不是第二份可能漂移的真相。
-- 詳細理由分別寫在 apps/api/src/db/schema/employee-employments.ts、
-- employee-department-histories.ts、employee-withholding-settings.ts 各自的檔頭。
--
-- employee_employments 額外新增 deleted_seq（軟刪除與唯一鍵並存的固定配套，§4.3，
-- 理由與 employees／departments 相同）；另外兩張表沒有 deleted_at／deleted_seq，
-- 字典本來就沒有列這兩欄——「結束」用 effective_to 表示，不是刪除。
--
-- §4.3 期間重疊：三張表都有「同一時間只能一筆有效」的約束，MariaDB 沒有 exclusion constraint
-- 擋得住。定案處置：UNIQUE(company_id, 擁有者, effective_from/hire_date[, deleted_seq]) 擋最
-- 常見的同日重複，加上寫入前對擁有者那一列 SELECT ... FOR UPDATE 序列化（鎖的粒度：
-- employee_employments＝員工、employee_department_histories＝任職、
-- employee_withholding_settings＝員工，各自寫在對應模組的 create service 檔頭）。
-- 兩道防線都不完美，殘留風險已在各檔頭與回報中寫明。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行
-- 修正，於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區再寫入時間（§6）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `employee_department_histories` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employment_id` char(36) NOT NULL,
	`department_id` char(36) NOT NULL,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `employee_department_histories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_employee_department_histories_employment_from` UNIQUE(`company_id`,`employment_id`,`effective_from`)
);
--> statement-breakpoint
CREATE TABLE `employee_employments` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employee_id` char(36) NOT NULL,
	`employment_type_code` int NOT NULL,
	`employment_nature_code` int,
	`hire_date` date NOT NULL,
	`leave_date` date,
	`last_working_date` date,
	`leave_reason_code` int,
	`status` varchar(32) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	`deleted_at` datetime,
	`deleted_seq` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `employee_employments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_employee_employments_employee_hire_date` UNIQUE(`company_id`,`employee_id`,`hire_date`,`deleted_seq`),
	CONSTRAINT `uq_employee_employments_company_id` UNIQUE(`company_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_withholding_settings` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employee_id` char(36) NOT NULL,
	`withholding_method_code` int NOT NULL,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `employee_withholding_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_employee_withholding_settings_employee_from` UNIQUE(`company_id`,`employee_id`,`effective_from`)
);
--> statement-breakpoint
ALTER TABLE `employee_department_histories` ADD CONSTRAINT `fk_employee_department_histories_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_department_histories` ADD CONSTRAINT `fk_employee_department_histories_employment` FOREIGN KEY (`company_id`,`employment_id`) REFERENCES `employee_employments`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_department_histories` ADD CONSTRAINT `fk_employee_department_histories_department` FOREIGN KEY (`company_id`,`department_id`) REFERENCES `departments`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_employments` ADD CONSTRAINT `fk_employee_employments_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_employments` ADD CONSTRAINT `fk_employee_employments_employee` FOREIGN KEY (`company_id`,`employee_id`) REFERENCES `employees`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_withholding_settings` ADD CONSTRAINT `fk_employee_withholding_settings_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_withholding_settings` ADD CONSTRAINT `fk_employee_withholding_settings_employee` FOREIGN KEY (`company_id`,`employee_id`) REFERENCES `employees`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_employee_department_histories_company_employment` ON `employee_department_histories` (`company_id`,`employment_id`);--> statement-breakpoint
CREATE INDEX `ix_employee_department_histories_company_department` ON `employee_department_histories` (`company_id`,`department_id`);--> statement-breakpoint
CREATE INDEX `ix_employee_employments_company_employee` ON `employee_employments` (`company_id`,`employee_id`,`deleted_seq`);--> statement-breakpoint
CREATE INDEX `ix_employee_withholding_settings_company_employee` ON `employee_withholding_settings` (`company_id`,`employee_id`);