ALTER TABLE `employee_dependents` MODIFY COLUMN `identity_number_encrypted` varbinary(94);--> statement-breakpoint
ALTER TABLE `employee_dependents` MODIFY COLUMN `identity_number_hash` binary(32);--> statement-breakpoint
ALTER TABLE `employee_dependents` MODIFY COLUMN `birthday_encrypted` varbinary(78);--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `identity_number_encrypted` varbinary(94);--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `identity_number_hash` binary(32);--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `birthday_encrypted` varbinary(78);--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `phone_encrypted` varbinary(94);--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `address_encrypted` varbinary(1082);--> statement-breakpoint
ALTER TABLE `employee_dependents` ADD `identity_number` varchar(10);--> statement-breakpoint
ALTER TABLE `employee_dependents` ADD `birthday` date;--> statement-breakpoint
ALTER TABLE `employees` ADD `identity_number` varchar(10);--> statement-breakpoint
ALTER TABLE `employees` ADD `birthday` date;--> statement-breakpoint
ALTER TABLE `employees` ADD `phone` varchar(32);--> statement-breakpoint
ALTER TABLE `employees` ADD `email` varchar(254);--> statement-breakpoint
ALTER TABLE `employees` ADD `address` varchar(255);--> statement-breakpoint
ALTER TABLE `employee_dependents` ADD CONSTRAINT `uq_employee_dependents_company_employee_identity_plain` UNIQUE(`company_id`,`employee_id`,`identity_number`,`deleted_seq`);--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `uq_employees_company_identity_plain` UNIQUE(`company_id`,`identity_number`,`deleted_seq`);