CREATE TABLE `attendance_results` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employee_id` char(36) NOT NULL,
	`employee_schedule_id` char(36),
	`work_date` date NOT NULL,
	`scheduled_minutes` int NOT NULL,
	`worked_minutes` int NOT NULL,
	`late_minutes` int NOT NULL,
	`early_leave_minutes` int NOT NULL,
	`absence_minutes` int NOT NULL,
	`leave_minutes` int NOT NULL,
	`overtime_minutes` int NOT NULL,
	`result_status_code` int NOT NULL,
	`calculated_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `attendance_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_attendance_results_company_employee_work_date` UNIQUE(`company_id`,`employee_id`,`work_date`)
);
--> statement-breakpoint
ALTER TABLE `attendance_results` ADD CONSTRAINT `fk_attendance_results_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_results` ADD CONSTRAINT `fk_attendance_results_employee` FOREIGN KEY (`company_id`,`employee_id`) REFERENCES `employees`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_attendance_results_company_status` ON `attendance_results` (`company_id`,`result_status_code`);