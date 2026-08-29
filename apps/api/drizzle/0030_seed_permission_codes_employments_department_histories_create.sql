-- 權限碼 seed：補上 `employments.department-histories.create` 這一個葉節點。
--
-- 分類節點 `employments.department-histories`（id ...903）已在 0026 建立，當時只 seed 了
-- `list`（id ...921），因為那一輪的部門歷史只交付查詢端點（0026 的檔頭有說明）。本輪
-- （後端 Stage 6 前端撞到的缺口二）補上對外的 `create` 端點——UI 定案 `docs/ui/
-- 20-employee-list.md` §3.3「可以修改部門、職稱及一個或多個職務」需要它，形狀比照
-- `employments.job-title-histories.create`（0029 已經開過的同一種葉節點）。
--
-- id 沿用 0026 已經開出的 `092x` 區塊（`921` = list），接續用 `922`。
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
	('00000000-0000-4000-8000-000000000922', '00000000-0000-4000-8000-000000000903', 'employments.department-histories.create', '新增部門歷史', '同一任職同一時間僅一筆有效部門', 'ACTIVE', 1, 20, 0, NOW(), NOW());
