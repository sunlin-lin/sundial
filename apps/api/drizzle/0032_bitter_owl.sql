CREATE TABLE `employee_dependents` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employee_id` char(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`identity_number_encrypted` varbinary(94) NOT NULL,
	`identity_number_hash` binary(32) NOT NULL,
	`birthday_encrypted` varbinary(78) NOT NULL,
	`relationship_code` int NOT NULL,
	`is_student` boolean NOT NULL,
	`is_disabled` boolean NOT NULL,
	`is_unable_to_work` boolean NOT NULL,
	`is_cohabiting` boolean NOT NULL,
	`effective_date` date NOT NULL,
	`end_date` date,
	`status` varchar(32) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	`deleted_at` datetime,
	`deleted_seq` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `employee_dependents_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_employee_dependents_company_employee_identity` UNIQUE(`company_id`,`employee_id`,`identity_number_hash`,`deleted_seq`)
);
--> statement-breakpoint
CREATE TABLE `employee_labor_pension_settings` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employee_id` char(36) NOT NULL,
	`voluntary_contribution_rate` decimal(5,4) NOT NULL,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`created_by` char(36) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `employee_labor_pension_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_employee_labor_pension_settings_employee_from` UNIQUE(`company_id`,`employee_id`,`effective_from`)
);
--> statement-breakpoint
ALTER TABLE `employee_dependents` ADD CONSTRAINT `fk_employee_dependents_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_dependents` ADD CONSTRAINT `fk_employee_dependents_employee` FOREIGN KEY (`company_id`,`employee_id`) REFERENCES `employees`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_labor_pension_settings` ADD CONSTRAINT `fk_employee_labor_pension_settings_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_labor_pension_settings` ADD CONSTRAINT `fk_employee_labor_pension_settings_employee` FOREIGN KEY (`company_id`,`employee_id`) REFERENCES `employees`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_labor_pension_settings` ADD CONSTRAINT `fk_employee_labor_pension_settings_created_by` FOREIGN KEY (`company_id`,`created_by`) REFERENCES `company_users`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_employee_dependents_company_employee` ON `employee_dependents` (`company_id`,`employee_id`,`deleted_seq`);--> statement-breakpoint
CREATE INDEX `ix_employee_labor_pension_settings_company_employee` ON `employee_labor_pension_settings` (`company_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `ix_employee_labor_pension_settings_company_created_by` ON `employee_labor_pension_settings` (`company_id`,`created_by`);