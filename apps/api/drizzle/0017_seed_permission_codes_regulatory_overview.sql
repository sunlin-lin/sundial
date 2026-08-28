-- 權限碼 seed：`regulatory.datasets.overview`（實作計畫 03 §3、任務一）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- **權限碼 seed 與端點在同一批進，不留到後面補**（0014 的檔頭引用的教訓：0009 補 seed 那次的
-- 症狀是「登入之後員工功能一律 403」）。這一支與 `/regulatory/datasets/overview` 的路由同一個 PR 送出。
--
-- 總覽端點答的是「九個資料集各自現在是哪一版」。id 接在 `regulatory.datasets` 底下既有的三個
-- 葉節點（...0611／0612／0613）之後，用 ...0615（...0614 已被 `regulatory.sync.list` 用掉，
-- 見 0016）；sort_order 接在 `resolve`（30）之後，用 40。
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
	('00000000-0000-4000-8000-000000000615', '00000000-0000-4000-8000-000000000602', 'regulatory.datasets.overview', '資料集總覽', '九個資料集在某一基準日各自的版本、維護方式與最近一次同步狀態，不回 records', 'ACTIVE', 1, 40, 0, NOW(), NOW());
