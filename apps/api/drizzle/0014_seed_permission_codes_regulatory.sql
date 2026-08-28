-- 權限碼 seed：大目錄 `regulatory`（實作計畫 docs/plans/01-regulatory-dataset-versioning.md §4.3）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- **權限碼 seed 與表在同一批進，不留到後面補**（計畫 §3.5）。0009 是補的，那次的症狀是
-- 「登入之後員工功能一律 403」——identity-guard 由路徑推導出 employees.main.list，
-- 權限樹裡卻沒有這個碼，於是任何角色都不可能被授予它。測試全綠、路由掛得上、沒有任何地方會變紅，
-- 只有真的拿帳號去點才會發現。
--
-- **這一支刻意不 seed `regulatory.sync` 與 `regulatory.sync.list`**，即使計畫 §4.3 的表列了它們。
-- 理由是同一條規則的另一面：§3.5 要防的是「端點已上線、權限碼卻不存在」，而 sync 次目錄
-- （Stage 3）連端點都還不存在。先把碼建進去的話，權限設定畫面上會出現一個可以勾、
-- 勾了卻什麼都授不出去的葉節點——而下一個人無從判斷那是「還沒做」還是「壞了」。
-- Stage 3 開工時與 sync 的路由同一批 seed，那時兩者才對得起來。
-- 同理，計畫 D3 明確不開放的兩支端點（/regulatory/datasets/raw、/regulatory/sync/trigger）
-- 也沒有預留碼，屆時再 seed。
--
-- id 沿用既有規律，接在 employees 的 ...05xx 之後用 ...06xx（0001=01xx roles、0002=02xx permissions、
-- 0003=03xx company-users、0008=04xx sessions、0009=05xx employees）。
-- 大目錄 sort_order 同樣遞增：10、20、30、40、50 之後是 60。
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
	('00000000-0000-4000-8000-000000000601', NULL, 'regulatory', '法規資料', '政府法規資料集的版本與同步', 'ACTIVE', 0, 60, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000601', 'regulatory.datasets', '法規資料集', '版本清單、版本內容與適用版本解析（唯讀）', 'ACTIVE', 0, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000602', 'regulatory.datasets.list', '查詢版本清單', NULL, 'ACTIVE', 1, 10, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000612', '00000000-0000-4000-8000-000000000602', 'regulatory.datasets.get', '查詢單一版本', '回應不含政府原始 Snapshot（raw_data）', 'ACTIVE', 1, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000613', '00000000-0000-4000-8000-000000000602', 'regulatory.datasets.resolve', '解析適用版本', '依 datasetCode 與 asOfDate 取適用版本及其 records；asOfDate 必填，不預設今天', 'ACTIVE', 1, 30, 0, NOW(), NOW());
