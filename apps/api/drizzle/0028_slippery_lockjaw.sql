CREATE TABLE `employee_job_position_histories` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employment_id` char(36) NOT NULL,
	`job_position_id` char(36) NOT NULL,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `employee_job_position_histories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_employee_job_position_histories_employment_position_from` UNIQUE(`company_id`,`employment_id`,`job_position_id`,`effective_from`)
);
--> statement-breakpoint
CREATE TABLE `employee_job_title_histories` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`employment_id` char(36) NOT NULL,
	`job_title_id` char(36) NOT NULL,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `employee_job_title_histories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_employee_job_title_histories_employment_from` UNIQUE(`company_id`,`employment_id`,`effective_from`)
);
--> statement-breakpoint
CREATE TABLE `job_positions` (
	`id` char(36) NOT NULL,
	`company_id` char(36),
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(255),
	`is_system` boolean NOT NULL DEFAULT false,
	`status` varchar(32) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	`deleted_at` datetime,
	`deleted_seq` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `job_positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_job_positions_company_code` UNIQUE(`company_id`,`code`,`deleted_seq`)
);
--> statement-breakpoint
CREATE TABLE `job_titles` (
	`id` char(36) NOT NULL,
	`company_id` char(36),
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(255),
	`is_system` boolean NOT NULL DEFAULT false,
	`status` varchar(32) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	`deleted_at` datetime,
	`deleted_seq` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `job_titles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_job_titles_company_code` UNIQUE(`company_id`,`code`,`deleted_seq`)
);
--> statement-breakpoint
ALTER TABLE `employee_job_position_histories` ADD CONSTRAINT `fk_employee_job_position_histories_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_job_position_histories` ADD CONSTRAINT `fk_employee_job_position_histories_employment` FOREIGN KEY (`company_id`,`employment_id`) REFERENCES `employee_employments`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_job_position_histories` ADD CONSTRAINT `fk_employee_job_position_histories_job_position` FOREIGN KEY (`job_position_id`) REFERENCES `job_positions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_job_title_histories` ADD CONSTRAINT `fk_employee_job_title_histories_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_job_title_histories` ADD CONSTRAINT `fk_employee_job_title_histories_employment` FOREIGN KEY (`company_id`,`employment_id`) REFERENCES `employee_employments`(`company_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_job_title_histories` ADD CONSTRAINT `fk_employee_job_title_histories_job_title` FOREIGN KEY (`job_title_id`) REFERENCES `job_titles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_positions` ADD CONSTRAINT `fk_job_positions_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_titles` ADD CONSTRAINT `fk_job_titles_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_employee_job_position_histories_company_employment` ON `employee_job_position_histories` (`company_id`,`employment_id`);--> statement-breakpoint
CREATE INDEX `ix_employee_job_position_histories_company_job_position` ON `employee_job_position_histories` (`company_id`,`job_position_id`);--> statement-breakpoint
CREATE INDEX `ix_employee_job_title_histories_company_employment` ON `employee_job_title_histories` (`company_id`,`employment_id`);--> statement-breakpoint
CREATE INDEX `ix_employee_job_title_histories_company_job_title` ON `employee_job_title_histories` (`company_id`,`job_title_id`);--> statement-breakpoint
CREATE INDEX `ix_job_positions_company_status` ON `job_positions` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_job_titles_company_status` ON `job_titles` (`company_id`,`status`);