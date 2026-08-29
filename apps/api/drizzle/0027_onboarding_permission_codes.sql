-- 權限碼 seed 與停用：大目錄 `employees` 新增次目錄 `onboarding`（實作計畫
-- docs/plans/05-employee-onboarding.md Stage 4：跨模組交易編排）。節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- id 沿用既有規律：`employees` 系列已用 ...0501（大目錄）、...0502（main）、...0511~0515（main 的
-- 五個葉節點），這裡接著開 ...0503（onboarding 次目錄分類節點）與 ...0531（onboarding.create 葉節點，
-- 刻意跳號到 ...053x 而不是接續 ...0516，讓同一個次目錄底下的節點在 id 上看得出是一組）。
--
-- **本支同時停用 `employees.main.create`（計畫 §4.2 定案的破壞性變更）。**
-- 單頁新增員工上線後，系統會有兩條建立員工的路，其中一條（`/employees/main/create`）只建人員
-- 主檔、不建任職與帳號——會產生「沒有任職、沒有帳號」的員工。該端點已在同一輪移除
-- （modules/employees/main/employees-main.routes.ts 不再註冊它），其 service 動作
-- `createEmployeeInTransaction` 保留給 `employees/onboarding` 呼叫（§0.4：沒有端點的業務動作
-- 一樣放入口檔）。
--
-- **停用方式是把 `status` 改成 `INACTIVE`，不是刪除這一列**：
--   1. 這個權限碼可能已經被指派給某些角色（`role_permissions`），直接 DELETE `permissions` 那一列
--      會撞外鍵（`role_permissions.permission_id → permissions.id`）。
--   2. 就算沒有任何角色用過它，稽核歷史（`audit_logs.action`）與既有的角色設定快照都可能引用過
--      這個權限碼的字串，刪掉那一列不會讓引用消失，只會讓「查這個碼的權限樹節點」從此查不到，
--      稽核歷史因此指向一個不存在的碼。
--   `status = 'INACTIVE'` 是本專案既有的停用機制（`db/schema/permissions.ts` 的 `PermissionStatus`）：
--   `modules/permissions/main/impl/permissions-main.list-tree.repository.ts` 的權限樹查詢只挑
--   `status = ACTIVE`，停用後不會再出現在勾選樹上；`permissions-main.check-assignable.service.ts`
--   同時檢查 `isAssignable` 與 `status`，停用後新角色也授不出這個碼——但已經指派過的
--   `role_permissions` 列原樣保留，不強制解除既有角色的授權（那是另一個决定，不在本支處理範圍）。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區再寫入時間（§6）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
SET time_zone = '+08:00';
--> statement-breakpoint
INSERT INTO `permissions`
	(`id`, `parent_id`, `code`, `name`, `description`, `status`, `is_assignable`, `sort_order`, `deleted_seq`, `created_at`, `updated_at`)
VALUES
	('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000501', 'employees.onboarding', '員工到職', '單頁一次建立員工、任職、部門、帳號與角色', 'ACTIVE', 0, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-000000000503', 'employees.onboarding.create', '新增員工（到職）', '單一交易內建立員工、任職、部門歸屬、扣繳設定、登入帳號及角色；任一步失敗整筆取消', 'ACTIVE', 1, 10, 0, NOW(), NOW());
--> statement-breakpoint
UPDATE `permissions`
SET `status` = 'INACTIVE', `updated_at` = NOW()
WHERE `code` = 'employees.main.create';
