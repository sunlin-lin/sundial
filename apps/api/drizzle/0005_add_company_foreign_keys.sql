-- 補上指向 `companies` 的外鍵，並把 `company_user_roles` 的四條外鍵改成複合外鍵。
--
-- 為什麼是「補」：0000 建立 company_users／roles 時 `companies` 還不存在，指向不存在的表建不起來，
-- 於是那幾條外鍵當時只能缺席。缺席期間，成員與角色可以掛在一個不存在的公司 ID 底下——
-- 而所有查詢都以 company_id 過濾，這種孤兒列不會出現在任何清單裡，也就永遠不會有人發現它存在。
--
-- 已套用的 migration 禁止修改（§4.1），因此修正一律新增一支，而不是回頭改 0000。
--
-- **刻意「不」建立的外鍵：** role_permissions.company_id 與 company_user_roles.company_id
-- 都不另拉 FK → companies.id。前者已有複合外鍵 (company_id, role_id) → roles(company_id, id)，
-- 而 roles.company_id 在本檔取得了 FK → companies.id；後者同理，經 company_users 而成立。
-- 公司存在這件事已經被保證，再加一條只是讓每次寫入多查一張表，換不到任何額外的約束。

-- ── 1. company_users ───────────────────────────────────────────────────────────
-- 先建 UNIQUE(company_id, id)：MariaDB 的外鍵只能指向被參照端的唯一索引，
-- 而下面 company_user_roles 的複合外鍵要指向 company_users(company_id, id)。
-- 與 roles.uq_roles_company_id 是同一個手法（0000 已為 role_permissions 建過一次）。
ALTER TABLE `company_users` ADD CONSTRAINT `uq_company_users_company_id` UNIQUE(`company_id`,`id`);
--> statement-breakpoint
-- 這條外鍵不需要額外索引：uq_company_users_company_user (company_id, user_id) 的前綴就是 company_id，
-- InnoDB 用得上它，因此不會自動長出一個只有 (company_id) 的索引。
ALTER TABLE `company_users` ADD CONSTRAINT `fk_company_users_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

-- ── 2. roles ───────────────────────────────────────────────────────────────────
-- 同上：uq_roles_company_code (company_id, code, deleted_seq) 的前綴可用，不需新索引。
ALTER TABLE `roles` ADD CONSTRAINT `fk_roles_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

-- ── 3. company_user_roles：四條外鍵一律改成複合，全部帶上 company_id ────────────
--
-- 原本它們只指向 company_users(id)／roles(id)，於是本表的 company_id 與被參照者的 company_id
-- **可以不同**：一筆「A 公司的指派紀錄」指向 B 公司的成員或 B 公司的角色，資料庫完全接受。
-- 後果是它會出現在 A 公司的成員角色查詢裡——查詢有回資料、沒有任何錯誤，而權限判定就以那一列為準。
-- 這是 §4.2 那種「通常是客戶先發現」的隔離破口，只是發生在寫入端，連 TenantDatabase 封裝都擋不到。
--
-- assigned_by／revoked_by 一併改：它們是同一類的稽核欄位，值同樣來自本公司已驗證的身分，
-- 留一條單純 FK 等於留一個「撤銷者可以是別家公司的人」的洞，而稽核紀錄正是事後唯一的舉證來源。

-- 先建支撐索引。沒有它們，InnoDB 會為 assigned_by／revoked_by 的外鍵自動補上只有單欄的索引，
-- 那種索引不以 company_id 開頭（§4.5），而且是自動長出來的、review 看不見。
CREATE INDEX `ix_company_user_roles_company_assigned_by` ON `company_user_roles` (`company_id`,`assigned_by`);
--> statement-breakpoint
CREATE INDEX `ix_company_user_roles_company_revoked_by` ON `company_user_roles` (`company_id`,`revoked_by`);
--> statement-breakpoint

-- 卸下舊的單純外鍵。
ALTER TABLE `company_user_roles` DROP FOREIGN KEY `fk_company_user_roles_company_user`;
--> statement-breakpoint
ALTER TABLE `company_user_roles` DROP FOREIGN KEY `fk_company_user_roles_role`;
--> statement-breakpoint
ALTER TABLE `company_user_roles` DROP FOREIGN KEY `fk_company_user_roles_assigned_by`;
--> statement-breakpoint
ALTER TABLE `company_user_roles` DROP FOREIGN KEY `fk_company_user_roles_revoked_by`;
--> statement-breakpoint

-- 卸下外鍵時，InnoDB 當初為它們自動建立的同名單欄索引**不會**跟著消失。
-- 必須明確刪掉：它們既已無人使用，又全部不以 company_id 開頭（§4.5）。
-- 刪除順序必須在「舊外鍵已卸下」之後、「新外鍵尚未加上」之前——先刪索引會讓舊外鍵無索引可用，
-- 後刪則會與新外鍵的同名約束在命名上打架。
ALTER TABLE `company_user_roles` DROP INDEX `fk_company_user_roles_company_user`;
--> statement-breakpoint
ALTER TABLE `company_user_roles` DROP INDEX `fk_company_user_roles_role`;
--> statement-breakpoint
ALTER TABLE `company_user_roles` DROP INDEX `fk_company_user_roles_assigned_by`;
--> statement-breakpoint
ALTER TABLE `company_user_roles` DROP INDEX `fk_company_user_roles_revoked_by`;
--> statement-breakpoint

-- 換上複合外鍵。名稱與舊的逐字相同，也與 src/db/schema/company-user-roles.ts 逐字相同：
-- 外鍵違反時 MariaDB 報的是資料庫端的名字，對不上程式碼裡的任何字串就只能逐表比對。
ALTER TABLE `company_user_roles` ADD CONSTRAINT `fk_company_user_roles_company_user` FOREIGN KEY (`company_id`,`company_user_id`) REFERENCES `company_users`(`company_id`,`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE `company_user_roles` ADD CONSTRAINT `fk_company_user_roles_role` FOREIGN KEY (`company_id`,`role_id`) REFERENCES `roles`(`company_id`,`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE `company_user_roles` ADD CONSTRAINT `fk_company_user_roles_assigned_by` FOREIGN KEY (`company_id`,`assigned_by`) REFERENCES `company_users`(`company_id`,`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- revoked_by 可為 NULL。InnoDB 的複合外鍵採 MATCH SIMPLE：只要有一欄是 NULL 就視為滿足，
-- 因此「尚未撤銷」的列（revoked_by IS NULL）不會被這條外鍵擋下。
ALTER TABLE `company_user_roles` ADD CONSTRAINT `fk_company_user_roles_revoked_by` FOREIGN KEY (`company_id`,`revoked_by`) REFERENCES `company_users`(`company_id`,`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
