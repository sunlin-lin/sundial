-- 權限碼 seed：`regulatory.sync` 節點與 `regulatory.sync.list`
-- （實作計畫 docs/plans/01-regulatory-dataset-versioning.md §4.3）。
-- 節點規則見 0001 的檔頭說明：
--   `<大目錄>`                    分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>`           分類節點，is_assignable = 0
--   `<大目錄>.<次目錄>.<動作>`    端點葉節點，is_assignable = 1
--
-- **為什麼是現在才 seed，而不是在 0014 一起進。** 0014 的檔頭寫了理由：§3.5 要防的是
-- 「端點已上線、權限碼卻不存在」（0009 補 seed 那次的症狀是「登入之後員工功能一律 403」），
-- 而當時 sync 次目錄連端點都還不存在——先建碼的話，權限設定畫面上會出現一個可以勾、
-- 勾了卻什麼都授不出去的葉節點，而下一個人無從判斷那是「還沒做」還是「壞了」。
-- 這一支與 `/regulatory/sync/list` 的路由同一批進，兩者才對得起來。
--
-- **刻意不 seed `regulatory.sync.trigger`**（計畫 D3）：人工觸發同步的端點不開放。
-- 觸發全平台同步不該由某一家公司的管理者做——`晷光示範股份有限公司` 的管理者按一次，
-- 效果是重抓政府資料、寫入新版本，**平台上每一家公司的 Payroll 都跟著換版本**。
-- 目前的權限模型是「公司成員 ＋ 角色」，沒有平台管理員這個概念，而那個角色定案之前，
-- 這個碼存在只會讓人以為它是可以授出去的。`regulatory.datasets.raw` 同理，也沒有預留。
--
-- id 規律沿用既有慣例（見 0008、0009、0014）：**節點用 `xx0n`、葉節點用 `xx1n`**。
-- 因此 `regulatory.sync` 這個節點接在 `regulatory.datasets`（...0602）之後用 ...0603，
-- 葉節點 `regulatory.sync.list` 接在 `regulatory.datasets.resolve`（...0613）之後用 ...0614。
-- 次目錄的 sort_order 同樣遞增：datasets 是 10，sync 是 20。
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
	('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000601', 'regulatory.sync', '法規同步', '政府法規資料的自動同步歷程', 'ACTIVE', 0, 20, 0, NOW(), NOW()),
	('00000000-0000-4000-8000-000000000614', '00000000-0000-4000-8000-000000000603', 'regulatory.sync.list', '查詢同步歷程', '每次同步的結果、失敗原因與心跳；人工觸發同步的端點依決策 D3 不開放', 'ACTIVE', 1, 10, 0, NOW(), NOW());
