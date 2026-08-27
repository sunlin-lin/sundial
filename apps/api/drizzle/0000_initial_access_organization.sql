-- 公司存取與組織：登入帳號、公司成員、角色與權限。
-- 對應資料字典 docs/schema/01-company-access-organization.md，與字典不同之處都寫在
-- src/db/schema/ 對應檔案的欄位註解裡（每一處都附了為什麼）。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

CREATE TABLE `users` (
	`id` CHAR(36) NOT NULL,
	`username` VARCHAR(64) NOT NULL,
	`password_hash` VARCHAR(255) NOT NULL,
	`must_change_password` TINYINT(1) NOT NULL,
	`password_changed_at` DATETIME,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_username` UNIQUE(`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全域登入帳號與驗證資料；不得併入員工表';
--> statement-breakpoint
CREATE TABLE `company_users` (
	`id` CHAR(36) NOT NULL,
	`company_id` CHAR(36) NOT NULL,
	`user_id` CHAR(36) NOT NULL,
	`employee_id` CHAR(36),
	`status` VARCHAR(32) NOT NULL,
	`activated_at` DATETIME,
	`deactivated_at` DATETIME,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	CONSTRAINT `company_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_company_users_company_user` UNIQUE(`company_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登入帳號加入公司的成員關係，必要時連結該公司員工';
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` CHAR(36) NOT NULL,
	`company_id` CHAR(36) NOT NULL,
	`code` VARCHAR(64) NOT NULL,
	`name` VARCHAR(128) NOT NULL,
	`description` VARCHAR(255),
	`is_system` TINYINT(1) NOT NULL,
	`status` VARCHAR(32) NOT NULL,
	`deleted_at` DATETIME,
	`deleted_seq` BIGINT NOT NULL DEFAULT 0,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	-- deleted_seq 參與唯一鍵：UNIQUE 索引中 NULL 互不相等，用 deleted_at 的話對未刪除資料等於沒擋（§4.3）
	CONSTRAINT `uq_roles_company_code` UNIQUE(`company_id`,`code`,`deleted_seq`),
	-- 供 role_permissions 的複合外鍵指向；MariaDB 的外鍵必須指向被參照端的唯一索引
	CONSTRAINT `uq_roles_company_id` UNIQUE(`company_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司角色主檔；不預先寫死 HR、主管等角色';
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` CHAR(36) NOT NULL,
	`parent_id` CHAR(36),
	`code` VARCHAR(128) NOT NULL,
	`name` VARCHAR(128) NOT NULL,
	`description` VARCHAR(255),
	`status` VARCHAR(32) NOT NULL,
	`is_assignable` TINYINT(1) NOT NULL,
	`sort_order` INT NOT NULL DEFAULT 0,
	`deleted_at` DATETIME,
	`deleted_seq` BIGINT NOT NULL DEFAULT 0,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_permissions_code` UNIQUE(`code`,`deleted_seq`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系統權限主檔（全域表，無 company_id）；權限碼由端點路徑機械推導';
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`company_id` CHAR(36) NOT NULL,
	`role_id` CHAR(36) NOT NULL,
	`permission_id` CHAR(36) NOT NULL,
	`created_at` DATETIME NOT NULL,
	-- 唯一鍵以主鍵形式表達：InnoDB 無主鍵時會自建看不見的 rowid 叢集索引，等於每列多存一份沒人用得到的東西
	CONSTRAINT `pk_role_permissions` PRIMARY KEY(`company_id`,`role_id`,`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色與權限多對多關聯；company_id 自 roles 冗餘帶入以支撐公司範圍查詢與複合外鍵';
--> statement-breakpoint
CREATE TABLE `company_user_roles` (
	`id` CHAR(36) NOT NULL,
	`company_id` CHAR(36) NOT NULL,
	`company_user_id` CHAR(36) NOT NULL,
	`role_id` CHAR(36) NOT NULL,
	`assigned_at` DATETIME NOT NULL,
	`assigned_by` CHAR(36) NOT NULL,
	`revoked_at` DATETIME,
	`revoked_by` CHAR(36),
	`revoked_seq` BIGINT NOT NULL DEFAULT 0,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	CONSTRAINT `company_user_roles_id` PRIMARY KEY(`id`),
	-- 「同一公司成員與角色同時只能有一筆有效指派」：revoked_seq 讓有效紀錄全部落在 0 這一組，唯一性才成立
	CONSTRAINT `uq_company_user_roles_assignment` UNIQUE(`company_id`,`company_user_id`,`role_id`,`revoked_seq`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司成員與角色的指派及撤銷歷史；撤銷不刪列';
--> statement-breakpoint
-- 索引一律以 company_id 開頭（§4.5）；permissions 是全域表，不適用該規則。
CREATE INDEX `ix_company_users_company_status` ON `company_users` (`company_id`,`status`);
--> statement-breakpoint
CREATE INDEX `ix_roles_company_status` ON `roles` (`company_id`,`status`);
--> statement-breakpoint
CREATE INDEX `ix_permissions_parent_sort` ON `permissions` (`parent_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `ix_role_permissions_company_permission` ON `role_permissions` (`company_id`,`permission_id`);
--> statement-breakpoint
CREATE INDEX `ix_company_user_roles_company_user` ON `company_user_roles` (`company_id`,`company_user_id`,`revoked_seq`);
--> statement-breakpoint
CREATE INDEX `ix_company_user_roles_company_role` ON `company_user_roles` (`company_id`,`role_id`,`revoked_seq`);
--> statement-breakpoint
ALTER TABLE `company_users` ADD CONSTRAINT `fk_company_users_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE `permissions` ADD CONSTRAINT `fk_permissions_parent` FOREIGN KEY (`parent_id`) REFERENCES `permissions`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- 複合外鍵：授權的 company_id 必須與角色的 company_id 一致，跨公司授權在資料庫層就寫不出來
ALTER TABLE `role_permissions` ADD CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`company_id`,`role_id`) REFERENCES `roles`(`company_id`,`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `fk_role_permissions_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE `company_user_roles` ADD CONSTRAINT `fk_company_user_roles_company_user` FOREIGN KEY (`company_user_id`) REFERENCES `company_users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE `company_user_roles` ADD CONSTRAINT `fk_company_user_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- assigned_by／revoked_by 明確為外鍵：稽核欄位沒有外鍵時，指向不存在成員的值可以寫進去，
-- 而稽核紀錄的價值全部建立在「這個 ID 真的對得到一個人」之上
ALTER TABLE `company_user_roles` ADD CONSTRAINT `fk_company_user_roles_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `company_users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE `company_user_roles` ADD CONSTRAINT `fk_company_user_roles_revoked_by` FOREIGN KEY (`revoked_by`) REFERENCES `company_users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
