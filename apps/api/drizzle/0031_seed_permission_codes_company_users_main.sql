-- 權限碼 seed：新增 `company-users.main` 次目錄分類節點與其第一個葉節點
-- `company-users.main.reset-password`（管理者重設公司成員的登入密碼，UI 定案 `docs/ui/
-- 20-employee-list.md` §3.5）。
--
-- `company-users`（id ...301）在 0003 建立時只開了一個次目錄 `company-users.roles`
-- （id ...302，葉節點 ...311~313）；`main` 這個次目錄當時完全不存在——`company-users/main`
-- 底下的兩支業務動作（建立帳號、離職停用帳號）都沒有對外端點，因此不需要權限碼。本輪起
-- `main` 有了第一支對外端點，需要補上這個次目錄本身與它的第一個葉節點。
--
-- id 沿用 0003 的 `30x`／`31x` 區塊規律：`company-users`＝301、`company-users.roles`＝302，
-- 這裡的 `company-users.main`＝303（分類節點，接續使用下一個十位數）；葉節點沿用
-- `company-users.roles` 已經用掉的 `31x` 之後，開新的 `32x` 區塊，`company-users.main.
-- reset-password`＝321（同一種「次目錄借一個十位區塊」的規律，比照 0026／0029 的說明）。
-- `company-users.main` 的 `sort_order` 訂為 20，排在 `company-users.roles`（10）之後。
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0027 的檔頭都引用過
-- 同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
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
	('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000301', 'company-users.main', '公司成員帳號', '公司成員的登入帳號管理：重設密碼', 'ACTIVE', 0, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000321', '00000000-0000-4000-8000-000000000303', 'company-users.main.reset-password', '重設密碼', '管理者直接輸入新密碼；不寄送 Email、簡訊或系統通知', 'ACTIVE', 1, 10, 0, NOW(), NOW());
