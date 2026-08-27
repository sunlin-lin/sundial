-- 權限碼 seed：大目錄 `company-users`。節點規則見 0001 的檔頭說明。
--
-- 次目錄是 `roles`（公司成員的角色指派），不是 `main`：§0.2 規定次目錄名就是該子實體的名稱，
-- 只有「子實體就是這個領域本身」時才叫 `main`。這裡的子實體是「成員與角色的關聯」，有自己的名字。
-- 因此權限碼是 `company-users.roles.*`，與路徑 `/company-users/roles/<動作>` 一一對應。
--
-- 大目錄名保留 kebab-case 的 `company-users`：轉換規則規定路徑原樣轉碼、一字不改（§1.3），
-- 任何「順手」的單複數或 camelCase 轉換都會讓人腦與腳本算出不同的期望值，檢查就此寫不出來。

SET time_zone = '+08:00';
--> statement-breakpoint
INSERT INTO `permissions`
	(`id`, `parent_id`, `code`, `name`, `description`, `status`, `is_assignable`, `sort_order`, `deleted_seq`, `created_at`, `updated_at`)
VALUES
	('00000000-0000-4000-8000-000000000301', NULL, 'company-users', '公司成員', '公司成員與其角色指派', 'ACTIVE', 0, 30, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000301', 'company-users.roles', '成員角色', '公司成員的角色指派與撤銷', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000302', 'company-users.roles.list', '查詢成員角色', NULL, 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000302', 'company-users.roles.create', '指派角色', NULL, 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000302', 'company-users.roles.revoke', '撤銷角色', '撤銷最後一個有效角色必須由服務層拒絕', 'ACTIVE', 1, 30, 0, NOW(), NOW());
