-- 權限碼 seed：新的次目錄 `attendance.correction-requests`（實作計畫 docs/plans/06-attendance.md
-- §5 Stage 8：補打卡申請，本輪只做員工端）。節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0026／0027／0029／0033
-- 的檔頭都引用過同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 規律：延續 0037／0039／0041 已經開的 `attendance` 前綴序列（...0Fxx）。`attendance` 大目錄
-- 本身（f01）已在 0037 建立，這裡新增 `attendance.correction-requests` 次目錄（f05，sort_order
-- 40，接續 `attendance.settings`=10、`attendance.records`=20、`attendance.results`=30）與它底下
-- 三個葉節點（f41～f43，延續 `attendance.settings` 用 f1x、`attendance.records` 用 f2x、
-- `attendance.results` 用 f3x 的分段慣例，這裡用 f4x）。
--
-- **只有三個動作，配一般員工角色即可**：`submit`（提交）、`withdraw`（撤回）、`list-own`
-- （查詢自己的申請）範圍全部固定為 token 推出的呼叫者本人（service 內部由
-- `company_user → employee_id` 解出，不接受呼叫端指定 `employeeId`，比照
-- `attendance.records.revoke`／`attendance.records.list-own-by-date`／
-- `attendance.results.list-own` 的既有先例），因此可以安全地配給每一位一般員工的角色，不需要
-- 依賴人事／主管專用的權限碼。核准、退回、撤銷核准、撤銷退回四個動作（`attendance_correction_
-- reviews`）排在 Stage 9，屆時另開次目錄與權限碼，不在這裡預先保留代碼。
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
	-- ---- 新次目錄：補打卡申請（員工端） ----
	('00000000-0000-4000-8000-000000000f05', '00000000-0000-4000-8000-000000000f01', 'attendance.correction-requests', '補打卡申請', '員工端：提交、查詢自己的申請、撤回；審核（核准／退回／撤銷核准／撤銷退回）排在 Stage 9', 'ACTIVE', 0, 40, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f41', '00000000-0000-4000-8000-000000000f05', 'attendance.correction-requests.submit', '提交補打卡申請', 'employeeId／employmentId 由 token 推出的身分決定，不接受呼叫端指定；申請本身不寫入 attendance_records', 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f42', '00000000-0000-4000-8000-000000000f05', 'attendance.correction-requests.withdraw', '撤回補打卡申請', '只能撤回 token 推出的本人申請，且只有待審核狀態可以撤回', 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f43', '00000000-0000-4000-8000-000000000f05', 'attendance.correction-requests.list-own', '查詢本人的補打卡申請', '範圍固定為 token 推出的本人，不接受 employeeId；依年月＋狀態篩選', 'ACTIVE', 1, 30, 0, NOW(), NOW());
