-- 權限碼 seed：`sessions.main.context`（任務三：身分脈絡端點）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- **權限碼 seed 與端點在同一批進，不留到後面補**（0014 的檔頭引用的教訓：0009 補 seed 那次的
-- 症狀是「登入之後員工功能一律 403」）。這一支與 `/sessions/main/context` 的路由同一個 PR 送出。
--
-- 身分脈絡端點同時解決「重新整理會掉線」與「前端拿不到權限碼」兩個症狀。id 接在
-- `sessions.main` 底下既有的兩個葉節點（...0411／0412）之後，用 ...0413；
-- sort_order 接在 `logout-all`（20）之後，用 30。
--
-- 為什麼這支端點也免不了要權限碼：權限碼由路徑機械推導，沒有例外分支（§5.2.2）。
-- 理由見 0008 的檔頭——開一個「這支特殊」的口子，「權限碼必須等於路徑轉換結果」這條檢查
-- 就會被靜默繞過。
--
-- **這一支與 0017（`regulatory.datasets.overview`）分屬兩個不同大目錄，因此拆成兩支**
-- （0001 的檔頭：一個大目錄一支 migration，不集中成一支）：兩支端點是同一輪任務一起做的，
-- 但它們各自的權限碼歷史不該綁在一起——日後查「sessions 的權限碼是哪一支 migration 建的」，
-- 答案必須乾淨地指向這一支，不是一支名字只對一半的合併檔。
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
	('00000000-0000-4000-8000-000000000413', '00000000-0000-4000-8000-000000000402', 'sessions.main.context', '查詢身分脈絡', '回目前登入者的身分（user／company）與這個成員在這家公司實際擁有的權限碼', 'ACTIVE', 1, 30, 0, NOW(), NOW());
