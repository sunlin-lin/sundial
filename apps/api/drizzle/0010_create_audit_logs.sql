-- `audit_logs`：誰在什麼時候改了哪一筆資料，以及改了什麼
-- （資料字典 docs/schema/05-regulatory-system.md「稽核日誌」；實作計畫 docs/plans/02-audit-logs.md）。
--
-- 這張表只承載「資料異動」一種語意（計畫 §2）。登入行為、IP、User-Agent、系統執行 log、
-- 使用者瀏覽紀錄一律不放進來——稽核要求「一筆不少、永久保存、不可修改」，行為紀錄要求
-- 「量大、可過期清理、可取樣」，兩種保存策略互斥；混在同一張表就只能取其一，
-- 而通常取到的是後者，於是稽核紀錄跟著被清掉。
--
-- **與資料字典的出入只有一處**：
--   1. `subject_id` 字典標為 `uuid`，這裡是 `VARCHAR(64)`。全站主鍵型態不只一種——法規三表與
--      `company_regulatory_settings` 用 `BIGINT`，而後者正是稽核表要服務的第一個對象（計畫 §1）。
--      訂成 CHAR(36) 會讓它存不進去，且要到那個模組動工才會發現，屆時本表已上線、
--      已套用的 migration 不得修改（§4.1），只能再加一支 ALTER 並轉換既有資料。
--      語意因此訂為「主體主鍵的字串形式」：uuid 直接存，BIGINT 存十進位字串。
-- 其餘欄位逐欄與字典相符，逐欄理由寫在 src/db/schema/audit-logs.ts。
--
-- **明確不含 `updated_at`、`deleted_at`**（計畫 §3.4）：稽核紀錄一旦寫入就不得修改或刪除（§5.3），
-- 有這兩欄就等於在 schema 上宣告「這筆可以改」，而下一個人看到別的表都有、這張沒有，
-- 第一個念頭會是補上去。通用規範 §1.4 的補集已寫明本表屬於哪一類：append-only 的事件流水表
-- 只需 `created_at`，且不得有 `updated_at` 與 `deleted_at`。
--
-- **明確不含 `occurred_at`**（計畫 §3.3）：稽核與業務在同一交易內寫入（計畫 §5），
-- 「操作發生的時刻」與「這一列被建立的時刻」必然相同。兩個時間欄位並存的話，
-- 「哪一個才是真正的操作時間」會變成每次讀稽核都要重新想一次的問題，而它沒有意義。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區（§6，理由見 0009 檔頭）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
-- 本支只有 DDL、不寫入任何時間值，但仍然釘住——判準若變成「這一支有沒有寫時間」，
-- 每加一支 migration 就要重新判斷一次，而漏判的後果（時間靜靜偏移）沒有任何症狀。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` CHAR(36) NOT NULL,
	-- 所屬公司（§4.2：Tenant 資料必須可追溯至 Company）。下方三支索引全部以它開頭。
	`company_id` CHAR(36) NOT NULL,
	-- 1 公司成員、2 系統（排程／驗證器）。不使用 DB ENUM（通用規範 §1.4）：改 ENUM 要
	-- ALTER TABLE 重建，在大表上是鎖表操作，而這正是全系統最會長大的表之一。
	-- 代碼值的唯一來源是 schema 的 const object（AuditActorType）。
	-- 兩者必須分得出來：系統事件沒有人可以負責，記成某個人做的會讓稽核指向一個不在場的操作者。
	`actor_type_code` INT NOT NULL,
	-- 條件必填：actor_type_code=1 時必填，=2（系統）時為 NULL。
	-- 「條件必填」在資料庫層只能寫成 nullable——NOT NULL 會讓系統事件無值可填，
	-- 而塞一個假的成員 ID 進去比 NULL 糟得多：稽核會指向一個沒做過這件事的人。
	`actor_company_user_id` CHAR(36),
	-- 動作碼，由模組路徑推導（計畫 §4.1），例如 employees.main.update。不另編一套整數代碼：
	-- 那會讓每加一支端點就要做一次沒有標準答案的命名判斷（employee_update／update_employee／…）。
	-- 由路徑推導還讓它與權限碼是同一個字串——「誰被授權做」與「誰真的做了」可以直接對起來。
	`action` VARCHAR(150) NOT NULL,
	-- 資料主體所在的表，例如 employees。合法值就是欄位政策 AUDIT_FIELD_POLICY 的 key（計畫 §4.5），
	-- 不另外維護一份「哪些表會被稽核」的清單：多維護一份的下場是兩邊會少一邊，而少的那邊不會報錯。
	`subject_table` VARCHAR(64) NOT NULL,
	-- 見檔頭：主體主鍵的字串形式，這是與資料字典唯一的出入。
	`subject_id` VARCHAR(64) NOT NULL,
	-- 逐欄差異，例如 [{"field":"employeeCode","before":"E001","after":"E002"}]（計畫 §4.2）。
	-- 不存「前後兩包整筆資料」：那會把沒改動的欄位一起複製兩份，而 employees 沒改動的欄位裡
	-- 就有 identity_number_encrypted——光是改一個員工編號，整份身分證資料就跟著進了稽核表，
	-- 而那正是資料字典明文禁止的。逐欄的話，只有真的被改到的欄位才有機會進來，
	-- 且每一欄都會先過欄位政策（value／presence／excluded，計畫 §4.3）。
	`changes` JSON NOT NULL,
	-- 帶生效日的異動才有（部門異動、扣繳方式、投保設定），因此 nullable。
	-- date 存的是台北的日曆日，不做任何換算（§6）。
	`effective_date` DATE,
	-- 建立時間，即資料字典所稱的「操作時間」（計畫 §3.3）。
	-- datetime 存的就是台北牆鐘時間，不做任何換算（§6）。
	`created_at` DATETIME NOT NULL,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='稽核紀錄：誰在什麼時候改了哪一筆資料；append-only，寫入後不得修改或刪除';
--> statement-breakpoint
-- 「這筆資料被誰改過」——本表最主要的用途（計畫 §3.5）。四段的順序就是查詢條件的順序：
-- 先鎖公司範圍，再指定主體（表 + 主鍵），最後 created_at 供時間排序，不必額外排序一次。
CREATE INDEX `ix_audit_logs_company_subject` ON `audit_logs` (`company_id`,`subject_table`,`subject_id`,`created_at`);
--> statement-breakpoint
-- 「這家公司最近有哪些異動」。同時是 fk_audit_logs_company 的支撐索引——前綴正好是 company_id，
-- InnoDB 用得上它，因此不會自動長出一個只有 (company_id) 的索引
-- （自動長出來的索引除了不以 company_id 開頭，還有一個問題：它是隱形的，review 看不見）。
CREATE INDEX `ix_audit_logs_company_created` ON `audit_logs` (`company_id`,`created_at`);
--> statement-breakpoint
-- 「這個人做過什麼」。同時是下面那條複合外鍵的支撐索引：前綴 (company_id, actor_company_user_id)
-- 正是外鍵欄位組，明確建出來，InnoDB 就不會再自動補一個看不見的。
-- 三支索引全部以 company_id 開頭（§4.5）：所有查詢都必須帶公司範圍，索引前綴一致才不會有
-- 某一支查詢退化成全表掃描，而這張表會長到千萬列等級（計畫 §10）。
CREATE INDEX `ix_audit_logs_company_actor` ON `audit_logs` (`company_id`,`actor_company_user_id`,`created_at`);
--> statement-breakpoint
-- 這條在本表不能省，即使下面已經有一條複合外鍵指向 company_users。
-- refresh_tokens 與 company_user_roles 都省掉了這一條（company_id 由複合外鍵間接受約束），
-- 但那兩張表的成員欄位是 NOT NULL。本表的 actor_company_user_id 可以是 NULL（系統事件），
-- 而 InnoDB 的 MATCH SIMPLE 語意下，複合外鍵只要有任一欄為 NULL 就整條不檢查
-- ——於是 actor_type_code=2 的每一列，company_id 都會完全不受約束，可以寫進一個不存在的公司。
-- 系統事件（例如憑證重用偵測）正是最需要事後追查的那一類。
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_logs_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- 複合外鍵，帶上 company_id（比照 company_user_roles 的 assigned_by／revoked_by 與
-- refresh_tokens.company_user_id，計畫 §3.1）。單欄 actor_company_user_id → company_users.id 的話，
-- 一筆「A 公司的稽核紀錄」可以指向 B 公司的成員，而資料庫完全接受——查詢有回資料、沒有任何錯誤。
-- 稽核紀錄的可信度整個建立在「這個 ID 對得到本公司的人」上面，這個破口等於把它拆掉，而且沒有症狀。
-- actor_type_code=2（系統）時本欄為 NULL：MATCH SIMPLE 語意下，複合外鍵只要有任一欄為 NULL
-- 就不檢查，因此 NULL 是合法的——這與 company_user_roles.revoked_by 的先例一致。
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_logs_actor` FOREIGN KEY (`company_id`,`actor_company_user_id`) REFERENCES `company_users`(`company_id`,`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
