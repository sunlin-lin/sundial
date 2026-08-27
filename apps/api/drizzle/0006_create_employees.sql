-- `employees`：員工個人主檔（資料字典 docs/schema/02-employee-payroll-cost.md 第 12–46 行）。
--
-- 與資料字典不同之處都寫在 src/db/schema/employees.ts 的欄位與索引註解裡，每一處都附了為什麼。
-- 三處最重要的：
--   1. 新增 `deleted_seq`，字典的 `UNIQUE(company_id, employee_code)` 改為
--      `UNIQUE(company_id, employee_code, deleted_seq)`——本表同時有 `deleted_at` 軟刪除，
--      而 MariaDB 的 UNIQUE 索引中 NULL 互不相等，單純的二欄唯一鍵配上軟刪除會讓
--      「未刪除的資料」失去唯一性（§4.3 已定案的作法）。
--   2. 新增 `UNIQUE(company_id, identity_number_hash, deleted_seq)`：字典沒有規定身分證唯一，
--      但同一家公司不可能有兩位員工是同一個人。建在 hash 而不是加密值上——加密值每次的 IV 都不同，
--      同一個身分證寫兩次會得到兩串不同的位元組，唯一鍵一次也擋不到（而且看起來是有設的）。
--   3. 新增 `UNIQUE(company_id, id)`：比照 roles，供日後其他表建複合外鍵
--      `(company_id, employee_id) → employees(company_id, id)` 指向。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

CREATE TABLE `employees` (
	`id` CHAR(36) NOT NULL,
	`company_id` CHAR(36) NOT NULL,
	-- 公司內員工編號；可修改，但不得與同公司其他員工重複（見下方唯一鍵）。
	`employee_code` VARCHAR(64) NOT NULL,
	-- 姓名與員工編號是 keyword 唯一能比對的兩個欄位——其餘個資都加密了，LIKE 不了。
	`name` VARCHAR(128) NOT NULL,
	-- 不使用 DB ENUM（通用規範 §1.4）：改 ENUM 要 ALTER TABLE 重建，在大表上是鎖表操作，
	-- 而新增一個代碼值是業務常態，不該變成 DDL 變更。代碼值的唯一來源是 schema 的 const object。
	`gender` VARCHAR(32) NOT NULL,
	-- 以下 *_encrypted 欄位為 AES-256-GCM 密文，位元組排列見 src/db/field-encryption.ts：
	--   版本(1) + 金鑰代號長度(1) + 金鑰代號(≤32) + IV(12) + 驗證碼(16) + 密文
	-- 寬度 = 明文最大 UTF-8 位元組數 + 62（上述額外開銷的上限）。
	-- IV 與驗證碼與密文存在同一欄，不另開欄位：三者少一個就解不開也驗不了，
	-- 分欄之後任何一次只更新其中一欄的寫入都會產生永遠解不開的資料，而且不會報錯。
	-- 金鑰代號隨密文一起存，是日後輪替金鑰的前提（本次不做輪替，只留格式）。
	`identity_number_encrypted` VARBINARY(94) NOT NULL,
	-- blind index（HMAC-SHA256，固定 32 位元組）：加密值每次的 IV 都不同，密文無法比對相等，
	-- 「這個身分證是不是已經存在」只能靠這一欄。§5.1 禁止另存明文欄位或明文索引。
	`identity_number_hash` BINARY(32) NOT NULL,
	`birthday_encrypted` VARBINARY(78) NOT NULL,
	`phone_encrypted` VARBINARY(94) NOT NULL,
	-- 資料字典標為選填，因此 nullable。
	`email_encrypted` VARBINARY(316),
	`address_encrypted` VARBINARY(1082) NOT NULL,
	-- datetime 存的就是台北牆鐘時間，不做任何換算（§6）。
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	`deleted_at` DATETIME,
	-- 見檔頭第 1 點：軟刪除下唯一鍵仍然成立的必要欄位（§4.3）。
	`deleted_seq` BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT `employees_id` PRIMARY KEY(`id`),
	-- 資料字典的 `UNIQUE(company_id, employee_code)` 在軟刪除下的正確形式。
	CONSTRAINT `uq_employees_company_code` UNIQUE(`company_id`,`employee_code`,`deleted_seq`),
	-- 身分證重複由資料庫擋，不做「先 SELECT 再 INSERT」（§4.3）：
	-- 兩個併發請求會同時查到「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現。
	CONSTRAINT `uq_employees_company_identity` UNIQUE(`company_id`,`identity_number_hash`,`deleted_seq`),
	-- 供日後其他表建複合外鍵指向；MariaDB 的外鍵必須指向被參照端的唯一索引。
	CONSTRAINT `uq_employees_company_id` UNIQUE(`company_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='員工個人主檔；只保存人員身分與個資，不含在職狀態、到離職、部門、職稱、職務與薪資';
--> statement-breakpoint
-- 這條外鍵不需要額外索引：uq_employees_company_code (company_id, employee_code, deleted_seq)
-- 的前綴就是 company_id，InnoDB 用得上它，因此不會自動長出一個只有 (company_id) 的索引
-- （自動長出來的索引不以 company_id 開頭之外還有一個問題：它是隱形的，review 看不見）。
ALTER TABLE `employees` ADD CONSTRAINT `fk_employees_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- 員工清單的支撐索引（§4.5：帶 company_id 的表，索引必須以 company_id 開頭）。
-- deleted_seq 排第二是因為 §4.3 要求每一次查詢都排除已刪除，那個條件若不在索引裡，
-- 篩出來的列還要逐列回表判斷 deleted_at。第三段 name 供依姓名排序與關鍵字比對使用。
CREATE INDEX `ix_employees_company_name` ON `employees` (`company_id`,`deleted_seq`,`name`);
