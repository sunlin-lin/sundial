-- 權限碼 seed：新的次目錄 `attendance.records`（實作計畫 docs/plans/06-attendance.md §5 Stage 3）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- 權限碼 seed 與端點在同一批進，不留到後面補（0009／0014／0019／0024／0026／0027／0029／0033
-- 的檔頭都引用過同一個教訓：0009 補 seed 那次的症狀是「登入之後員工功能一律 403」）。
--
-- id 規律：延續 0037 已經開的 `attendance` 前綴序列（...0Fxx）。`attendance` 大目錄本身
-- （f01）與 `attendance.settings`（f02）已在 0037 建立，這裡新增 `attendance.records`
-- 次目錄（f03）與它底下的節點。
--
-- **`attendance.records.view-all` 是本次唯一一個不對應任何路由的葉節點**（is_assignable = 1，
-- 但沒有一支 `/attendance/records/*` 端點的權限碼是它）。它是計畫 §4.2 定案的細粒度旗標：
-- 查看別人的打卡座標時，`get` 端點在執行期查詢操作者的權限碼集合，比對是否含有
-- `attendance.records.view-all` 或 `attendance.records.revoke-other` 任一者，兩者皆無才隱藏
-- 座標欄位（見 src/modules/attendance/records/domain/attendance-record-visibility.ts）。
-- 這不違反「權限碼由路徑機械推導」的規則（§5.2.2）——那條規則管的是「端點的權限碼」，
-- 這一碼從一開始就不是任何端點的權限碼，是角色可以額外指派的一項獨立能力。
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
	-- ---- 新次目錄：打卡與撤銷 ----
	('00000000-0000-4000-8000-000000000f03', '00000000-0000-4000-8000-000000000f01', 'attendance.records', '打卡與撤銷', '打卡事件與撤銷；每日全員打卡明細（Stage 6）的查看與撤銷操作也走這裡的權限碼', 'ACTIVE', 0, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f21', '00000000-0000-4000-8000-000000000f03', 'attendance.records.create', '打卡', '上班卡或下班卡；employeeId／employmentId 由 token 推出的身分決定，不接受呼叫端指定', 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f22', '00000000-0000-4000-8000-000000000f03', 'attendance.records.revoke', '撤銷自己的打卡', '本人撤銷，軟刪除，不寫稽核；只能撤銷 token 推出的本人記錄', 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f23', '00000000-0000-4000-8000-000000000f03', 'attendance.records.revoke-other', '撤銷他人的打卡', '他人撤銷，標記作廢並寫入 audit_logs；同時是查看他人座標的權限碼之一', 'ACTIVE', 1, 30, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f24', '00000000-0000-4000-8000-000000000f03', 'attendance.records.get', '查詢單筆打卡明細', '座標依呼叫者身分決定回不回，見 attendance.records.view-all', 'ACTIVE', 1, 40, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000f25', '00000000-0000-4000-8000-000000000f03', 'attendance.records.list-by-date', '依日期查全公司打卡', '每日全員打卡明細（Stage 6）使用；列表恆不含座標', 'ACTIVE', 1, 50, 0, NOW(), NOW()),
	-- 見檔頭：這一碼不對應任何端點，是 get 端點在執行期查詢比對的細粒度旗標。
	('00000000-0000-4000-8000-000000000f26', '00000000-0000-4000-8000-000000000f03', 'attendance.records.view-all', '查看他人打卡座標', '不對應任何端點；get 查詢別人的明細時，具備此碼或 attendance.records.revoke-other 任一者才回傳座標', 'ACTIVE', 1, 60, 0, NOW(), NOW());
