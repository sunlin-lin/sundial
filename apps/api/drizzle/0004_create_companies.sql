-- `companies`：SaaS Tenant 根節點（資料字典 docs/schema/01-company-access-organization.md 第 12–46 行）。
--
-- 與資料字典不同之處都寫在 src/db/schema/companies.ts 的欄位註解裡，最重要的一處是唯一鍵：
-- 字典寫 `UNIQUE(company_code)`，這裡是 `UNIQUE(company_code, deleted_seq)`——本表同時有
-- `deleted_at` 軟刪除，而 MariaDB 的 UNIQUE 索引中 NULL 互不相等，單欄唯一鍵配上軟刪除
-- 會讓「未刪除的資料」失去唯一性（§4.3 已定案的作法）。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

CREATE TABLE `companies` (
	`id` CHAR(36) NOT NULL,
	`company_code` VARCHAR(32) NOT NULL,
	`company_type` VARCHAR(32) NOT NULL,
	`legal_type` VARCHAR(32) NOT NULL,
	-- 條件必填（公司型主體使用）。MariaDB 沒有部分 NOT NULL，該條件由 service 層維持。
	`tax_id` VARCHAR(16),
	`name` VARCHAR(128) NOT NULL,
	`short_name` VARCHAR(64),
	-- 三組地址（登記／實際／發票）直接展開在主檔：目前只確認這三種，
	-- 通用地址子表會讓每次讀公司資料多一次 join，卻換不到目前需要的彈性。
	`registered_postal_code` VARCHAR(16),
	`registered_city` VARCHAR(32),
	`registered_district` VARCHAR(32),
	`registered_address` VARCHAR(255),
	`actual_postal_code` VARCHAR(16),
	`actual_city` VARCHAR(32),
	`actual_district` VARCHAR(32),
	`actual_address` VARCHAR(255),
	`invoice_postal_code` VARCHAR(16),
	`invoice_city` VARCHAR(32),
	`invoice_district` VARCHAR(32),
	`invoice_address` VARCHAR(255),
	`status` VARCHAR(32) NOT NULL,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	`deleted_at` DATETIME,
	`deleted_seq` BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`),
	-- 資料字典的 `UNIQUE(company_code)` 在軟刪除下的正確形式；理由見檔頭與 schema 註解（§4.3）
	CONSTRAINT `uq_companies_company_code` UNIQUE(`company_code`,`deleted_seq`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SaaS Tenant／公司或個人雇主主檔，保存法定識別、三組地址及系統狀態';
--> statement-breakpoint
-- 本表沒有 company_id（它的 id 就是公司範圍本身），因此不適用 §4.5「索引以 company_id 開頭」，
-- 情況與全域表 users、permissions 相同。
--
-- 統編刻意「不是」唯一索引：company_code ＝統編＋3 碼流水號，代表同一統編底下允許多家公司；
-- 設成唯一，第二家永遠建不起來。而配號時必須先問「這個統編用到第幾號」，沒有索引就是每建一家全表掃描一次。
CREATE INDEX `ix_companies_tax_id` ON `companies` (`tax_id`,`deleted_seq`);
--> statement-breakpoint
-- 平台端依狀態列出公司。帶 deleted_seq 是因為 §4.3 要求查詢一律排除已刪除，
-- 那個條件不在索引裡的話，篩出來的列還要逐列回表判斷 deleted_at。
CREATE INDEX `ix_companies_status` ON `companies` (`status`,`deleted_seq`);
