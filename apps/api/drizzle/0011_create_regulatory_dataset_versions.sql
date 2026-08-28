-- `regulatory_dataset_versions`：平台共用的政府資料歷史版本與原始 Snapshot
-- （資料字典 docs/schema/05-regulatory-system.md「法規四表定案」；
--   實作計畫 docs/plans/01-regulatory-dataset-versioning.md §3.2）。
--
-- 這張表存在的唯一理由：Payroll 結算時要依「法規適用基準日」取得當時的費率與級距，
-- 而政府事後更新不得改寫已結算的結果（資料字典「Payroll 邊界」）。只保存一份「目前值」做不到
-- ——補算去年 12 月的薪資時，那一份值早就被今年的新值覆蓋掉了，而覆蓋不會留下任何痕跡。
--
-- **本批三張表與全站其他表不同的三件事，每一件都是刻意的：**
--
--   1. **主鍵是 BIGINT AUTO_INCREMENT，這是全站第一批不用 uuid 的表**（計畫 §3.2 (a)）。
--      資料字典就是這樣定的，理由也站得住：這三張表是「平台全域」資料（不屬於任何公司）、只增不改，
--      而 regulatory_records 的列數會到「數千 × 版本數」。uuid 主鍵的三個好處在這裡一個都用不到
--      ——不需要在客戶端先產生 ID、不需要隱藏列數、不會有跨公司合併資料的需求
--      ——剩下的就只有 CHAR(36) 對 BIGINT 的 36 bytes 換 8 bytes，而且每一支二級索引都要多背一次。
--      寫進 audit_logs.subject_id 時是十進位字串（見 0010 的檔頭）。
--
--   2. **沒有 company_id，因此不進 CompanyScopedTable**（計畫 §3.2 (b)）。法規是全國法定值，
--      全平台共用一份；走的是裸 db client 那條路（§4.2），和 users、permissions 同一類。
--      這件事在 src/db/schema/index.ts 也寫了一次，因為那裡才是下一個人會誤以為「漏加」的地方。
--      公司層真正的「選擇」（這家公司用哪一個職災行業別）在 company_regulatory_settings，
--      那張表有 company_id，不在本批範圍。
--
--   3. **沒有 updated_at、deleted_at**：版本是 append-only 的事實流水——某一版在某段期間有效，
--      這件事發生過就不會變。通用規範 §1.4 的補集正是這一類（同 audit_logs）。
--      「政府改了費率」不是 UPDATE，是新增一個版本（計畫 §3.1.1）。覆寫的後果是實的：
--      2026-03 用 2.11% 結算、錢發出去了，2027-01 有人把數字改成 2.3%，
--      回頭查 2026-03 的薪資單，系統說當時用的是 2.3%——對不起來，而且沒有任何地方會報錯。
--
-- **本表禁止 SELECT ***（計畫 §3.2 (c)）：raw_data 是 LONGTEXT。MariaDB 把 LONGTEXT 存在頁外、
-- 不選就不讀，所以只要 repository 逐欄列出就沒有代價；但只要有人寫了一次 SELECT *，
-- 列版本清單就會順手拖出每一版的完整 Snapshot，而症狀是「列表偶爾很慢」，不是錯誤
-- ——沒有任何測試會因此變紅。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區（§6，理由見 0009 檔頭）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
-- 本支只有 DDL、不寫入任何時間值，但仍然釘住——判準若變成「這一支有沒有寫時間」，
-- 每加一支 migration 就要重新判斷一次，而漏判的後果（時間靜靜偏移）沒有任何症狀。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `regulatory_dataset_versions` (
	-- 見檔頭第 1 點：全站第一批 BIGINT AUTO_INCREMENT 主鍵。
	`id` BIGINT AUTO_INCREMENT NOT NULL,
	-- 法規資料集代碼，合法值見 src/modules/regulatory/datasets/domain/regulatory-dataset-code.ts（計畫 §3.1）。
	-- 一旦有版本資料寫進去就不能改：改了等於歷史資料指向另一個資料集，而且不會有任何地方報錯
	-- ——假設 4 與 5 對調，Payroll 算勞保時拿到的是健保費率，算出一個看起來完全正常的保費，
	-- 要到有人核對薪資單才會發現，而那時已經結算好幾期。守這件事的是掃描器 check:dataset-code（§3.1.2）。
	-- 不使用 DB ENUM（通用規範 §1.4）：改 ENUM 要 ALTER TABLE 重建，而新增一個資料集是業務常態。
	`dataset_code` INT NOT NULL,
	-- 西元版本代碼，例如 2026-01。同一資料集內不重複（見下方唯一鍵），
	-- 但它完全不保證 effective_from 不重複——見唯一鍵的註解。
	`version_code` VARCHAR(30) NOT NULL,
	-- 版本生效日。date 存的是台北的日曆日，不做任何換算（§6）。
	-- 推導不出生效日時一律讓同步失敗，不得猜（計畫 §7.2）：不得以同步當天、上一版生效日
	-- 或任何推測值 fallback。任何日期看起來都是合理的日期，沒有一個斷言能說它不對。
	`effective_from` DATE NOT NULL,
	-- 版本失效日。**只在「政府明示失效日」時才寫入**（計畫 §3.2 (d)），
	-- 不拿來記「下一版開始日的前一天」——這是本表最容易寫錯的地方。
	-- 資料字典寫它「可由下一版本推導」，推導，不是寫入：如果新增一版時要順手 UPDATE 前一版的
	-- effective_to，那個 UPDATE 漏掉不會有任何錯誤，只會讓兩個版本同時宣稱自己在某一天有效，
	-- 而 resolve 挑到哪一版取決於 ORDER BY 的巧合。因此絕大多數列的這一欄是 NULL。
	`effective_to` DATE,
	-- 本次取得的政府資源識別碼；不視為永久固定 URL（資料字典明文）。
	-- 每次同步都要先打 data.gov.tw 的 metadata API 重新探索資源網址（計畫 §7.0）：
	-- 實測勞動部的資源網址帶隨機尾碼（A17000000J-020014-Uy8），硬編一定會壞。
	-- 這一欄記的是「這一版當時是從哪個資源抓到的」，供事後追查，不是下次要去打的位址。
	`government_resource_id` VARCHAR(150),
	-- 政府來源標示的修改時間；選填（不是每個來源都有）。datetime 存的就是台北牆鐘時間（§6），
	-- 而來源的時區未必是台北——一律在解析階段轉成台北再寫入，轉換規則寫在各資料集的解析器裡，
	-- 不是寫在資料表上（計畫 §3.2）。寫在表上的話，每個解析器都要記得自己有沒有轉過，
	-- 而漏轉的症狀是時間差 8 小時、不報錯。
	`source_modified_at` DATETIME,
	-- 同步完成時間。台北牆鐘時間，不做任何換算（§6）。
	`synced_at` DATETIME NOT NULL,
	-- 原始內容雜湊，用於判斷內容是否改變（相同即 status_code=4 無異動，計畫 §7.1）。
	-- 長度 128 與資料字典一致，容得下 SHA-512 的十六進位字串。
	`checksum` VARCHAR(128) NOT NULL,
	-- 解析後筆數；選填（同步失敗或尚未解析時沒有值）。
	`record_count` INT,
	-- 原始資料格式代碼。不使用 DB ENUM（通用規範 §1.4），代碼值的唯一來源是 schema 的 const object
	-- （RegulatoryRawFormat）：1 CSV、2 JSON、3 XML、4 HTML、5 純文字。
	-- 這一欄記的是 raw_data 那串位元組原本是什麼格式，用途是日後重跑解析器時知道該用哪一個 parser
	-- ——Snapshot 保存下來卻不知道怎麼解讀它，等於沒保存。
	`raw_format_code` INT NOT NULL,
	-- 政府原始資料 Snapshot。LONGTEXT，因此本表禁止 SELECT *（見檔頭）。
	-- 保存原始位元組而不是只留解析結果，是為了「解析器改了之後可以重跑」：政府資料格式變動時，
	-- 沒有 Snapshot 就只能重新去抓，而舊資源網址那時多半已經失效。
	`raw_data` LONGTEXT NOT NULL,
	-- 建立時間。台北牆鐘時間，不做任何換算（§6）。
	-- 與 synced_at 刻意並存：synced_at 是「這份政府資料是什麼時候取得的」，
	-- created_at 是「這一列是什麼時候寫進來的」。匯入 script 補錄歷史版本時兩者會差很多
	-- （計畫 §7.0：dataset_code 2、5、9 可以一次回補十幾年的歷史版本）。
	`created_at` DATETIME NOT NULL,
	-- 這裡刻意沒有 is_current（資料字典明確把它列在「被推翻方案」）：「目前版本」由生效區間判定，
	-- 不由旗標判定。旗標的失敗模式是新增一版時要把舊版的旗標關掉，那個 UPDATE 漏掉就會有兩版
	-- 同時是「目前」，而漏掉不會報錯；更根本的是旗標答不出「去年 12 月適用的是哪一版」，
	-- 而那正是 Payroll 補算時唯一會問的問題。
	CONSTRAINT `regulatory_dataset_versions_id` PRIMARY KEY(`id`),
	-- 資料字典的約束：同一資料集內版本代碼不重複。
	-- **它只保證版本代碼不重複，完全不保證 effective_from 不重複**（計畫 §3.2 (d)）：
	-- 版本補錄、或 checksum 誤判導致同一份資料重新寫成新版本，都會產生兩筆同日生效的紀錄。
	-- 因此 resolve 的 ORDER BY 必須帶次要排序鍵 id DESC（語意是「同日生效時，後寫入的版本優先」），
	-- 那不是保險，是必要的：少了它，挑到哪一筆由實體儲存順序與執行計畫決定——這次跑出版本 A，
	-- 重建索引或升級 MariaDB 之後跑出版本 B，兩版的費率都是正常數字，沒有錯誤訊息，而且不可重現。
	CONSTRAINT `uq_regulatory_dataset_versions_code` UNIQUE(`dataset_code`,`version_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='政府法規資料集的歷史版本與原始 Snapshot；平台全域共用，append-only，禁止 SELECT *';
--> statement-breakpoint
-- resolve（依基準日取適用版本）的唯一熱點（計畫 §3.2）。那支查詢固定長這樣、永遠只回一筆：
--   WHERE dataset_code = ? AND effective_from <= :asOfDate
--     AND (effective_to IS NULL OR effective_to >= :asOfDate)
--   ORDER BY effective_from DESC, id DESC LIMIT 1
-- 兩段的順序就是查詢條件的順序：先鎖資料集，再以 effective_from 做範圍比較與遞減排序。
-- 這支查詢是 Payroll 每算一個人的每一種保險都會打一次的查詢，退化成全表掃描不會有錯誤，
-- 只會讓結算愈跑愈慢。
-- 本表沒有以 company_id 開頭的索引（§4.5 那條規則的前提是「帶 company_id 的表」），
-- 因為它根本沒有那一欄——見檔頭第 2 點。
CREATE INDEX `ix_regulatory_dataset_versions_effective` ON `regulatory_dataset_versions` (`dataset_code`,`effective_from`);
