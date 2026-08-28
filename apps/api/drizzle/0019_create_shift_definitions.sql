-- `shift_definitions`：班別主檔，定義「一天怎麼上班」（資料字典 docs/schema/03-scheduling-attendance.md
-- 「排班 Schema」；實作計畫 docs/plans/04-shift-definitions.md）。
--
-- 與資料字典不同之處都寫在 src/db/schema/shift-definitions.ts 的欄位與索引註解裡，三處最重要的：
--   1. 新增 `deleted_seq`，字典的 `UNIQUE(company_id, code)` 改為
--      `UNIQUE(company_id, code, deleted_seq)`——本表同時有 `deleted_at` 軟刪除，而 MariaDB 的
--      UNIQUE 索引中 NULL 互不相等，單純的二欄唯一鍵配上軟刪除會讓「未刪除的資料」失去唯一性
--      （比照 employees／roles 既有的作法，§4.3）。
--   2. 新增 `UNIQUE(company_id, id)`：供日後 `employee_schedules` 建複合外鍵
--      `(company_id, shift_definition_id) → shift_definitions(company_id, id)` 指向，
--      理由與 roles／employees 相同——單欄外鍵會讓 A 公司的班表指向 B 公司的班別，資料庫完全接受。
--   3. `work_type_code` 的代碼值字典沒有定，本計畫定為 1 一般、2 輪班、3 彈性、4 責任制（計畫 §5.1、§10）。
--      跨日／分段／中空不是代碼值——那些是形狀，已由 `shift_work_periods.end_day_offset` 與
--      時段筆數表達，做成代碼會是第二份真相。
--
-- **`is_overnight` 與 `required_work_minutes` 是推導值**（計畫 §4.1，已定案）：兩者都由 service
-- 在寫入時依 `shift_work_periods`／`shift_breaks` 算出，request schema 裡沒有這兩個欄位，
-- 不是「收進來再驗算」而是「不收」。不一致的具體後果：`is_overnight=false` 但某段
-- `end_day_offset=1`，列表顯示「非跨日」、出勤判定卻按跨日處理——兩邊都不報錯，症狀是
-- 某些人的工時永遠差八小時。**為什麼要存而不是每次現算**：`attendance_results.scheduled_minutes`
-- 會引用 `required_work_minutes`，而規則改版不得覆蓋歷史——存下來的是那一版班別當時的應工作分鐘，
-- 現算的話，日後改了計算方式，所有歷史出勤判定的分母會跟著變。
--
-- **「班別被引用後不得覆蓋歷史」這條資料字典明文定案的規則，本輪刻意不實作**（計畫 §7）：
-- 沒有任何表引用 `shift_definitions`（排班那幾張表都還不存在），這個查詢的答案恆為否，
-- 寫一個永遠回 false 的檢查比不寫更糟。**這是必須被接住的欠帳，排班模組動工的第一件事就是補上。**
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區再寫入時間（§6）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `shift_definitions` (
	`id` CHAR(36) NOT NULL,
	`company_id` CHAR(36) NOT NULL,
	-- 班別代碼；可修改，但不得與同公司其他未刪除班別重複（見下方唯一鍵）。
	`code` VARCHAR(64) NOT NULL,
	`name` VARCHAR(128) NOT NULL,
	-- 工時管理方式：1 一般、2 輪班、3 彈性、4 責任制（計畫 §5.1、§10，資料字典未定，本計畫定案）。
	-- 不使用 DB ENUM（通用規範 §1.4）：改 ENUM 要 ALTER TABLE 重建，在大表上是鎖表操作，
	-- 而新增一個代碼值是業務常態。代碼值的唯一來源是 schema 的 const object（ShiftWorkType）。
	`work_type_code` INT NOT NULL,
	-- 推導值，不得由呼叫端送進來（計畫 §4.1）：由 service 依工作時段的 end_day_offset 算出。
	`is_overnight` BOOLEAN NOT NULL,
	-- 彈性班旗標。僅此一欄，彈性區間與核心工時本輪不做（計畫 §4.3、§10：已定案採甲案，
	-- 資料字典明文「不能直接塞入 shift_definitions」）。
	`is_flexible` BOOLEAN NOT NULL,
	-- 推導值，不得由呼叫端送進來（計畫 §4.1）：由 service 依工作與休息時段算出，
	-- 供 attendance_results.scheduled_minutes 引用；存下來是為了不讓規則改版覆蓋歷史。
	`required_work_minutes` INT NOT NULL,
	-- 用途或異動說明。資料字典標為必填，逐欄照抄。
	`description` TEXT NOT NULL,
	`is_active` BOOLEAN NOT NULL,
	-- datetime 存的就是台北牆鐘時間，不做任何換算（§6）。
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	`deleted_at` DATETIME,
	-- 見檔頭第 1 點：軟刪除下唯一鍵仍然成立的必要欄位（§4.3）。
	`deleted_seq` BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT `shift_definitions_id` PRIMARY KEY(`id`),
	-- 資料字典的 `UNIQUE(company_id, code)` 在軟刪除下的正確形式。
	CONSTRAINT `uq_shift_definitions_company_code` UNIQUE(`company_id`,`code`,`deleted_seq`),
	-- 見檔頭第 2 點：供日後其他表建複合外鍵指向；MariaDB 的外鍵必須指向被參照端的唯一索引。
	CONSTRAINT `uq_shift_definitions_company_id` UNIQUE(`company_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='班別主檔：定義一天怎麼上班，與誰上這個班（排班）完全無關';
--> statement-breakpoint
-- 這條外鍵不需要額外索引：uq_shift_definitions_company_code (company_id, code, deleted_seq)
-- 的前綴就是 company_id，InnoDB 用得上它，因此不會自動長出一個只有 (company_id) 的索引
-- （自動長出來的索引除了不以 company_id 開頭之外還有一個問題：它是隱形的，review 看不見）。
ALTER TABLE `shift_definitions` ADD CONSTRAINT `fk_shift_definitions_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- 班別清單依啟用狀態篩選是計畫 §6 明列的列表條件，比照 roles 的 ix_roles_company_status
-- （§4.5：帶 company_id 的表，索引必須以 company_id 開頭）。
CREATE INDEX `ix_shift_definitions_company_active` ON `shift_definitions` (`company_id`,`is_active`);
