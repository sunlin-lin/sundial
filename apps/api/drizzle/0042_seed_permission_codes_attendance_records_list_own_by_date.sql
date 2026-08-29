-- 權限碼 seed：新端點 `attendance.records.list-own-by-date`（Stage 5 Dashboard 缺口二，
-- 實作計畫 `docs/plans/06-attendance.md` §4.3、§4.7 的延伸——查詢本人某一天的打卡記錄，
-- 供「今日打卡狀態」重新整理後仍能還原，日後「我的出勤」亦可沿用同一支端點查詢別天）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0026／0027／0029／0033
-- 的檔頭都引用過同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 規律：延續 0039 已經開的 `attendance.records` 分段（f2x）。f21~f26 已用
-- （create／revoke／revoke-other／get／list-by-date／view-all），這裡接續用 f27，
-- sort_order 接續 list-by-date=50、view-all=60，這裡是 70。
--
-- **為什麼不能沿用既有的 `attendance.records.list-by-date`：** 那一碼在架構意圖上是人事／主管
-- 專用（0039 的節點說明「每日全員打卡明細（Stage 6）使用」），不保證配給每一位一般員工的角色；
-- 拿它當自助查詢，等於把 Dashboard「今日打卡狀態」這種每個員工都要用得到的功能，綁在一個不保證
-- 每個員工都有的權限碼上。這一碼（`list-own-by-date`）的範圍固定是 token 推出的呼叫者本人
-- （service 內部由 `company_user → employee_id` 解出，不接受呼叫端指定 `employeeId`，比照
-- `attendance.records.revoke` 與 `sessions-main.logout-all.service.ts` 的既有先例），因此可以
-- 安全地配給一般員工角色，不會讓員工查到別人的打卡。
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
	('00000000-0000-4000-8000-000000000f27', '00000000-0000-4000-8000-000000000f03', 'attendance.records.list-own-by-date', '查詢本人某一天的打卡記錄', '範圍固定為 token 推出的本人，不接受 employeeId；列表恆不含座標。供 Dashboard 今日打卡狀態重建，日後「我的出勤」查詢別天亦可沿用', 'ACTIVE', 1, 70, 0, NOW(), NOW());
