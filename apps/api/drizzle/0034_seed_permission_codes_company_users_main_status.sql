-- 權限碼 seed：`company-users.main` 新增兩個對外端點——啟用／停用公司成員的登入帳號
-- （UI 定案 `docs/ui/20-employee-list.md` §3.5「可以管理登入帳號狀態」）。
--
-- `company-users.main`（id ...303）在 0031 建立時只開了一個葉節點 `reset-password`（...321）；
-- 這裡沿用同一個 `32x` 區塊，接續補上 `activate`（...322）與 `deactivate`（...323）。
-- `sort_order` 接續 `reset-password`（10），`activate` 訂為 20、`deactivate` 訂為 30——
-- 啟用排在停用之前，純粹是清單排序上的慣例，不代表兩者有先後依賴關係。
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0026／0027／0029／0033
-- 的檔頭都引用過同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
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
	('00000000-0000-4000-8000-000000000322', '00000000-0000-4000-8000-000000000303', 'company-users.main.activate', '啟用登入帳號', '啟用一個已停用的公司成員登入帳號；操作者不得對自己的帳號執行', 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000323', '00000000-0000-4000-8000-000000000303', 'company-users.main.deactivate', '停用登入帳號', '停用一個公司成員的登入帳號；操作者不得對自己的帳號執行', 'ACTIVE', 1, 30, 0, NOW(), NOW());
