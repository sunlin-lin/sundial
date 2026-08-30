-- 權限碼 seed：新端點 `attendance.results.list`／`attendance.results.list-own`
-- （實作計畫 docs/plans/06-attendance.md §5 Stage 7：全體出勤／我的出勤，UI 09／12）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0026／0027／0029／0033
-- 的檔頭都引用過同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 規律：延續 0041 已經開的 `attendance.results` 分段（f3x）。f31（recalculate-no-schedule）
-- 已用，這裡接續用 f32／f33，sort_order 接續 recalculate-no-schedule=10，這裡分別是 20／30。
--
-- **`list` 與 `list-own` 是兩支不同權限碼，不是一支端點內部判斷分支**（計畫 §5 Stage 7 明文兩支
-- 端點的分工）：
--   - `attendance.results.list`：公司範圍，全體出勤（UI 09），配人事／主管角色。可依部門／人員
--     篩選，部門顯示與篩選依查詢當日的有效部門歷史，不是員工目前部門。
--   - `attendance.results.list-own`：本人範圍，我的出勤（UI 12），**每一位員工都會有的權限碼**
--     ——範圍固定為 token 推出的本人（service 內部由 company_user → employee_id 解出，不接受
--     呼叫端指定 employeeId），因此可以安全地配給一般員工角色，這一點與 0042 的
--     `attendance.records.list-own-by-date` 是同一個判準：「本人範圍、不可能查到別人」的端點
--     才能配給每一位員工，「公司範圍」的端點只能配給人事／主管。
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
	('00000000-0000-4000-8000-000000000f32', '00000000-0000-4000-8000-000000000f04', 'attendance.results.list', '查詢全體出勤', '依年月查詢公司範圍的出勤判定結果，可依部門／人員篩選；部門顯示與篩選依查詢當日的有效部門歷史，不是員工目前部門；列表恆不含座標', 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f33', '00000000-0000-4000-8000-000000000f04', 'attendance.results.list-own', '查詢本人出勤', '依年月查詢呼叫者本人範圍的出勤判定結果；不接受 employeeId；每一位員工都會有的權限碼，範圍固定為 token 推出的本人；列表恆不含座標', 'ACTIVE', 1, 30, 0, NOW(), NOW());
