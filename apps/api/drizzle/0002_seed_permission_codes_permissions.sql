-- 權限碼 seed：大目錄 `permissions`。節點規則見 0001 的檔頭說明。
--
-- 這個大目錄目前只有一支端點（`permissions.main.tree`，供角色設定畫面取得整棵權限樹），
-- 但仍然建立兩層分類節點：權限樹的節點種類只有一種形狀（§0.2 的「一律兩層」），
-- 少建一層會讓「這個碼是分類還是端點」變成要看深度才知道，而深度會隨著之後新增的端點改變。

SET time_zone = '+08:00';
--> statement-breakpoint
INSERT INTO `permissions`
	(`id`, `parent_id`, `code`, `name`, `description`, `status`, `is_assignable`, `sort_order`, `deleted_seq`, `created_at`, `updated_at`)
VALUES
	('00000000-0000-4000-8000-000000000201', NULL, 'permissions', '權限', '系統權限樹', 'ACTIVE', 0, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000201', 'permissions.main', '權限管理', '權限主檔', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000202', 'permissions.main.tree', '查詢權限樹', '角色設定畫面用的大／小權限樹', 'ACTIVE', 1, 10, 0, NOW(), NOW());
