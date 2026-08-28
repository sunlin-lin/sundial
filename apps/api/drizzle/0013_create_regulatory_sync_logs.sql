-- `regulatory_sync_logs`：每次自動排程或人工同步的結果
-- （資料字典 docs/schema/05-regulatory-system.md；實作計畫 docs/plans/01-regulatory-dataset-versioning.md §3.4）。
--
-- 資料字典的設計理由：「同步紀錄獨立保存每次下載、驗證與套用結果，讓失敗可追查且不影響已生效資料，
-- 亦不以最後同步時間取代完整歷程」。不是在版本表上加一個 last_synced_at——那樣
-- 「為什麼那三天沒同步」永遠答不出來，因為失敗的那幾次根本沒有留下任何一列。
--
-- **與資料字典的唯一出入：多一欄 heartbeat_at**（計畫 §3.4，決策 D2）。這是本計畫對資料字典
-- 唯一的欄位增補，補的是字典沒有處理的一個失敗模式：同步程序被殺掉（部署、OOM、機器重啟）之後，
-- 那一筆會永遠停在 status_code=1 執行中，而下一次排程看到「已有執行中的同步」就會跳過
-- ——從此再也不同步，且沒有任何錯誤：沒有失敗紀錄、沒有告警，log 裡只有一筆安靜的「執行中」。
-- 要到政府調了費率、系統還在用舊版才會發現。判定規則寫在該欄位的註解。
--
-- 主鍵、沒有 company_id 兩件事的理由見 0011 的檔頭（同一批三張表共用）。
--
-- **本表有 created_at ＋ updated_at，與同批另外兩張表不同。** 0011 與 0012 是 append-only
-- （寫入之後永遠不會被修改），適用通用規範 §1.4 的補集，只有 created_at。本表不在那個補集裡：
-- 它的列會被 UPDATE——status_code 由 1 變成 2／3／4、heartbeat_at 每 60 秒一次、
-- finished_at 在結束時寫入。§1.4 的判準是純機械的「這張表的列在寫入之後會不會被修改」，
-- 本表的答案是「會」，於是「主檔表必備 created_at、updated_at」照常適用。
-- updated_at 與 heartbeat_at、finished_at 語意重疊，仍然保留，理由見該欄位的註解。
--
-- 沒有 deleted_at：同步歷程不刪除。「為什麼那三天沒同步」的線索一旦可以被刪掉，這張表就白建了。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區（§6，理由見 0009 檔頭）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `regulatory_sync_logs` (
	`id` BIGINT AUTO_INCREMENT NOT NULL,
	-- 本次同步的法規資料集代碼，合法值見 src/modules/regulatory/datasets/domain/regulatory-dataset-code.ts。
	-- 刻意不設外鍵指向版本表的 dataset_code：同步失敗時本表要留下紀錄，而那正是
	-- 「這個資料集一個版本都還沒有」的情況——有外鍵的話，第一次失敗就寫不進去，
	-- 於是最需要留紀錄的那一次反而沒有紀錄。
	`dataset_code` INT NOT NULL,
	-- 1 自動排程、2 人工觸發。不使用 DB ENUM（通用規範 §1.4），代碼值的唯一來源是 schema 的
	-- const object（RegulatorySyncTriggerType）。兩者必須分得出來：排程失敗要進告警，
	-- 人工觸發失敗是操作者當場就看得到的事。
	-- （人工觸發的端點 /regulatory/sync/trigger 目前刻意不開放，見計畫 D3——按一次會影響全平台
	--   每一家公司的 Payroll 版本，而目前沒有平台管理員這個角色。代碼值先留著，因為匯入 script
	--   在伺服器上跑的那條路徑就是「人工」。）
	`trigger_type_code` INT NOT NULL,
	-- 同步開始時間。台北牆鐘時間，不做任何換算（§6）。
	`started_at` DATETIME NOT NULL,
	-- 同步結束時間；status_code=1 執行中時為 NULL。
	`finished_at` DATETIME,
	-- 1 執行中、2 更新成功、3 失敗、4 無異動。不使用 DB ENUM（通用規範 §1.4），
	-- 代碼值的唯一來源是 schema 的 const object（RegulatorySyncStatus）。四個值逐一都有
	-- 事後追查上的意義，不可合併：
	--   1 是唯一一個「還沒有結論」的狀態，也是心跳機制唯一的守備範圍；
	--   4 與 2 分開，是因為「跑了但政府沒改」與「跑了而且寫入新版本」在「為什麼沒有新版本」
	--     這個問題上答案完全不同，合併成「成功」之後那個問題就只能靠比對版本表才回答得出來；
	--   3 必須留下來（配 error_message），這是計畫 §7.2「推導不出生效日一律失敗，不得猜」的落點：
	--     寧可有一筆失敗紀錄讓人去看，也不要一個安靜生效的錯誤版本。
	`status_code` INT NOT NULL,
	-- 本次成功產生／辨識出的版本（FK 見下方）。失敗與執行中時為 NULL；
	-- status_code=4 無異動時指向既有的那一版——「這次同步確認了現行版本仍然是最新的」，
	-- 那個資訊比 NULL 有用。
	`dataset_version_id` BIGINT,
	-- 本次實際使用的政府資源識別碼。失敗時特別有用：resource discovery 抓到的是哪一個。
	`government_resource_id` VARCHAR(150),
	-- 本次收到／解析筆數；選填（在解析之前就失敗時沒有值）。
	`records_received` INT,
	-- 失敗原因。status_code=3 時必填（應用層保證，資料庫層是 nullable——「條件必填」在 DDL 上
	-- 寫不出來，同 audit_logs.actor_company_user_id 的處置）。心跳逾時被判死的那一筆也要寫進這裡。
	`error_message` TEXT,
	-- 同步程序存活訊號。資料字典沒有這一欄，是本計畫唯一的欄位增補（計畫 §3.4、決策 D2）。
	-- 判定規則（三條一起才成立）：
	--   1. 執行中的同步每 60 秒更新一次本欄。
	--   2. 下一次同步啟動時，若同一 dataset_code 有 status_code=1 且 heartbeat_at 落後超過 3 分鐘
	--      （三個心跳週期），視為該程序已死。
	--   3. 視為死亡時要把它改成 status_code=3 失敗並寫入 error_message（心跳逾時），不是直接忽略
	--      ——資料字典要求「獨立保存每次下載、驗證與套用結果」，靜靜略過等於少了一次失敗紀錄，
	--      而那正是事後要查「為什麼那三天沒同步」時唯一的線索。
	-- 為什麼是心跳而不是「started_at 超過 N 分鐘就當失敗」：固定逾時要猜一個「同步最久會跑多久」
	-- 的數字，猜小了會把還活著的程序判死（於是兩個程序同時寫同一個版本），猜大了則卡死的紀錄
	-- 要等很久才會被清掉。心跳量的是「程序還在不在」，不是「跑了多久」，不需要猜。
	-- 為什麼是三個週期而不是一個：漏掉一次心跳可能只是 GC 或 IO 卡住；連續三次沒更新，
	-- 程序基本上不可能還活著。
	-- 心跳必須由獨立計時器驅動，不得綁在工作步驟上：Bun 是單一事件迴圈，任何一個長步驟
	-- ——政府端點回應緩慢的單一 await fetch()、或扣繳稅額表（dataset_code=9）那種 CPU 密集的
	-- 同步解析——只要超過 180 秒，心跳就不會動，於是一個活得好好的程序被判死，第二個程序接手
	-- 同時寫入；若兩者算出的 version_code 不同，就會產生兩個並存的合法版本，直接餵給 §3.2 的排序問題。
	-- 必填：允許 NULL 的話，判定就得多寫一條「NULL 算不算逾時」，而漏寫那一條的後果，
	-- 正好是這一欄要防的那個狀態（永遠停在執行中）。建立紀錄時與 started_at 同值。
	`heartbeat_at` DATETIME NOT NULL,
	-- 建立時間，即這次同步被登記的時刻。台北牆鐘時間，不做任何換算（§6）。
	`created_at` DATETIME NOT NULL,
	-- 這一列最後被寫入的時刻。台北牆鐘時間，不做任何換算（§6）。
	-- 本表有三個「最近一次」性質的時間欄位，語意各不相同：
	--   heartbeat_at  同步程序還活著嗎——只在 status_code=1 期間由獨立計時器推進
	--   finished_at   這次同步是什麼時候結束的——只在轉成 2／3／4 那一刻寫入，之後不再變
	--   updated_at    這一列最後被寫是什麼時候——任何一次 UPDATE 都推進
	-- 三者確實語意重疊：正常流程下 updated_at 的值不是等於 heartbeat_at（執行中）就是等於
	-- finished_at（已結束），它不會提供前兩欄答不出來的資訊。
	-- **即使如此仍然保留，理由不在這一欄的用途，而在規則的形狀**：通用規範 §1.4 是
	-- 「主檔表必備 created_at、updated_at」，其補集只豁免 append-only 的表，判準是純機械的
	-- 「這張表的列在寫入之後會不會被修改」。本表的列會被修改，因此不在補集裡，規則照常適用。
	-- 反過來說，如果為它開一個「狀態變更已由具名欄位完整表達，故可免 updated_at」的例外，
	-- 那條規則就從機械判定退化成需要判斷——而「這張表的狀態變更算不算已被完整表達」沒有標準答案，
	-- 下一張表就會有人給出不同答案，然後兩張表的欄位長得不一樣而誰都說得通（通用規範 §7.6）。
	-- 一個略顯冗餘的欄位，比一條邊緣模糊的規則便宜。
	-- 實務上的讀法：判斷程序死活看 heartbeat_at（那是唯一有此語意的欄位），
	-- 看這次同步跑多久看 finished_at - started_at。updated_at 不進任何業務判定。
	`updated_at` DATETIME NOT NULL,
	CONSTRAINT `regulatory_sync_logs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='政府法規資料同步歷程；含心跳欄位，供判定被殺掉而永遠停在「執行中」的程序';
--> statement-breakpoint
ALTER TABLE `regulatory_sync_logs` ADD CONSTRAINT `fk_regulatory_sync_logs_version` FOREIGN KEY (`dataset_version_id`) REFERENCES `regulatory_dataset_versions`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- 同步歷程列表（/regulatory/sync/list，計畫 §4.2）的支撐索引：「這個資料集最近幾次同步的結果」。
-- 兩段的順序就是查詢條件的順序——先鎖資料集，再由 started_at 遞減排序，不必額外排序一次。
CREATE INDEX `ix_regulatory_sync_logs_dataset_started` ON `regulatory_sync_logs` (`dataset_code`,`started_at`);
--> statement-breakpoint
-- 心跳逾時判定（見 heartbeat_at 的註解）的支撐索引：「這個資料集有沒有 status_code=1 且
-- heartbeat_at 落後超過 3 分鐘的紀錄」。這支查詢每次同步啟動時都會先跑一次，而且它是同步流程的
-- 第一步——它慢，每一次同步都跟著慢。三段順序即條件順序：資料集 → 狀態 → 心跳時間比較。
CREATE INDEX `ix_regulatory_sync_logs_dataset_status` ON `regulatory_sync_logs` (`dataset_code`,`status_code`,`heartbeat_at`);
--> statement-breakpoint
-- 上面那條外鍵需要自己的支撐索引：dataset_version_id 不是前兩支索引的前綴，不明確建出來的話
-- InnoDB 會自動補一個——而自動補的索引在 review 上是隱形的（同 audit_logs 與 employees 的處置）。
CREATE INDEX `ix_regulatory_sync_logs_version` ON `regulatory_sync_logs` (`dataset_version_id`);
