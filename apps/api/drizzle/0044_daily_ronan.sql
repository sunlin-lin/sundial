CREATE TABLE `attendance_correction_requests` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employee_id` char(36) NOT NULL,
	`employment_id` char(36) NOT NULL,
	`employee_schedule_id` char(36),
	`work_date` date NOT NULL,
	`attendance_type_code` int NOT NULL,
	`requested_clocked_at` datetime NOT NULL,
	`reason` text NOT NULL,
	`status_code` int NOT NULL,
	`pending_seq` bigint NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `attendance_correction_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_attendance_correction_requests_employee_work_date_type_seq` UNIQUE(`employee_id`,`work_date`,`attendance_type_code`,`pending_seq`)
);
--> statement-breakpoint
ALTER TABLE `attendance_correction_requests` ADD CONSTRAINT `fk_attendance_correction_requests_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_correction_requests` ADD CONSTRAINT `fk_attendance_correction_requests_employee` FOREIGN KEY (`company_id`,`employee_id`) REFERENCES `employees`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_correction_requests` ADD CONSTRAINT `fk_attendance_correction_requests_employment` FOREIGN KEY (`company_id`,`employment_id`) REFERENCES `employee_employments`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_attendance_correction_requests_company_employee_work_date` ON `attendance_correction_requests` (`company_id`,`employee_id`,`work_date`);