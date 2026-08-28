-- `departments`：公司部門樹（資料字典 docs/schema/01-company-access-organization.md「departments」節，
-- 及該節之下「定案：樹的四條規則 ＋ 六項待定的處置」；實作計畫 docs/plans/05-employee-onboarding.md §5）。
--
-- 與資料字典不同之處：
--   1. 複合外鍵 `(company_id, parent_id) → departments(company_id, id)`，不是字典寫的單欄
--      `parent_id → departments.id`。單欄外鍵下，A 公司的部門可以掛在 B 公司底下而**資料庫完全
--      接受**——查詢有回資料、沒有任何錯誤。需要配套的 `UNIQUE(company_id, id)`（理由與 roles／
--      shift_definitions 對其他表的複合外鍵相同）。
--   2. 新增 `deleted_seq`：`UNIQUE(company_id, code, deleted_seq)` 取代字典的
--      `UNIQUE(company_id, code)`（軟刪除配套，比照 employees／roles／shift_definitions，§4.3）。
--   3. `fk_departments_parent` 訂為 `ON DELETE CASCADE`（其餘外鍵一律 `NO ACTION`，這裡是唯一
--      例外，理由必須寫清楚）：應用層**永遠不會**對這張表下真正的 DELETE——刪除一律走
--      `deleted_at`／`deleted_seq` 的軟刪除（§4.3），而且「有子部門不得刪除」的規則本身就保證
--      軟刪除發生的當下這一列沒有任何子列。CASCADE 只在**清空整間公司**的維運腳本
--      （`companyScopedTablesInDeleteOrder` 清理，見 apps/api/src/db/schema/index.ts）真的執行
--      實體 DELETE 時才會被觸發：對一張自我參照的表，單一陳述式刪光同一家公司所有列時，InnoDB
--      是逐列檢查外鍵，父列若在同一陳述式中排在子列之前被處理就會撞 errno 1451，而刪除順序不受
--      應用層控制。NO ACTION 在這裡不是「更安全」，是「這支腳本會直接失敗」；CASCADE 換來的是
--      清理腳本一定能跑完，而業務流程完全不會走到這條路徑（業務層從不下 DELETE）。
--
-- 四條樹規則裡，只有「不得跨公司」是這裡的複合外鍵擋的；「不得成環」「有子部門不得刪除」
-- 「搬移不改寫歷史」三條資料庫層完全擋不住，實作在 apps/api/src/modules/departments/main/
-- （domain/department-tree.ts 的 wouldCreateCycle、service 層的 has-children 檢查、update
-- service 對「不碰任何員工部門歷史表」的顯式不作為）。
--
-- 不含部門主管欄位，這是刻意的，不是遺漏（資料字典「定案」表已詳述）：這套系統的權限模型是
-- 扁平的（角色 ＋ 權限碼，不看部門）。一旦有主管欄位，下一步一定有人拿它做權限判斷，長出一套
-- 不受任何權限碼檢查約束的第二套授權邏輯。同理不含排序欄位（樹狀按名稱排）與主管任期。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區再寫入時間（§6）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
SET time_zone = '+08:00';
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` CHAR(36) NOT NULL,
	`company_id` CHAR(36) NOT NULL,
	-- 根部門為 NULL（字典定案）。
	`parent_id` CHAR(36),
	-- 公司內部門代碼；可修改，但不得與同公司其他未刪除部門重複（見下方唯一鍵）。
	`code` VARCHAR(64) NOT NULL,
	`name` VARCHAR(128) NOT NULL,
	`description` VARCHAR(255),
	-- 部門狀態，不用 DB ENUM（通用規範 §1.4）。停用只影響「能不能被選為新部門」，不動歷史
	-- （字典「定案」表）：本欄不需要表達那條規則，規則落在查詢「可選部門」的業務邏輯裡。
	`status` VARCHAR(32) NOT NULL,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	`deleted_at` DATETIME,
	-- 見檔頭第 2 點：軟刪除下唯一鍵仍然成立的必要欄位（§4.3）。
	`deleted_seq` BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT `departments_id` PRIMARY KEY(`id`),
	-- 資料字典的 `UNIQUE(company_id, code)` 在軟刪除下的正確形式。
	CONSTRAINT `uq_departments_company_code` UNIQUE(`company_id`,`code`,`deleted_seq`),
	-- 見檔頭第 1 點：供下方複合外鍵指向；MariaDB 的外鍵必須指向被參照端的唯一索引。
	CONSTRAINT `uq_departments_company_id` UNIQUE(`company_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司部門樹，以 (company_id, parent_id) 複合外鍵防止跨公司掛接；刻意不含部門主管／排序欄位（見模組註解）';
--> statement-breakpoint
ALTER TABLE `departments` ADD CONSTRAINT `fk_departments_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- 複合外鍵：見檔頭第 1、3 點。ON DELETE CASCADE 是本表唯一的例外，理由見檔頭第 3 點。
ALTER TABLE `departments` ADD CONSTRAINT `fk_departments_parent` FOREIGN KEY (`company_id`,`parent_id`) REFERENCES `departments`(`company_id`,`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
-- 供「這個部門底下有沒有子部門」查詢（刪除前檢查）與整棵樹查詢使用；同時是上面複合外鍵的支撐索引
-- （前綴 (company_id, parent_id) 正是外鍵欄位組，明確建出來，InnoDB 就不會再自動補一個看不見的）。
CREATE INDEX `ix_departments_company_parent` ON `departments` (`company_id`,`parent_id`);
