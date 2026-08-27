-- `refresh_tokens`：refresh token 的伺服器端存放處，同時是整個 session 的權威狀態（§5.4）。
--
-- **這張表是資料模型文件裡還沒有的新表**，因此欄位定義需回寫 docs/schema/（§9 第 6 項）。
-- 每一欄對應哪一條規則、為什麼少一欄就有一條規則寫不出來，逐欄寫在 src/db/schema/refresh-tokens.ts。
-- 這裡只重複三件最容易被「順手改掉」的事：
--   1. `session_id` 是「一次登入」（§5.4.7）。一條輪替鏈共用同一個值，輪替時原樣沿用。
--      沒有它，「整條鏈作廢」在資料上推不出來——只能逐張回溯，而輪替一旦刪掉舊列就斷了。
--   2. `active_session_id`（有效時＝session_id，作廢時＝NULL）是「一條鏈同時只能有一列有效」
--      這條約束唯一寫得出來的形式。**這裡刻意不套 §4.3 的 revoked_seq 慣例**，因為那個慣例解的是
--      另一個形狀的問題：那裡的 NULL 出現在「有效」列上而必須被消除，這裡則是「作廢」列必須
--      彼此不衝突（一條鏈會累積很多張作廢的票），而 UNIQUE 索引中 NULL 互不相等正是要的性質。
--      反過來套 revoked_seq 的話，同一條鏈裡每一張作廢的票都得有不同的序號，而時間戳做不到
--      ——同一次登出可以在同一毫秒作廢多張票。這不是理論風險，實作時第一次跑測試就撞上了。
--   3. `access_expires_at` 讓 access token 的滑動視窗與即時撤銷（§5.4.1、§5.4.6）成立。
--      access token 本身**不帶到期時間**：envelope 沒有任何欄位可以把新票帶回前端（§1.3），
--      因此「每次請求續期」只可能由伺服器端的截止時刻表達。
--
-- 已作廢的列**保留不刪**：偷用偵測（§5.4.2）靠的就是「舊票再次出現時查得到它、也看得出它已作廢」。
-- 刪掉舊列之後，重複使用一張已換掉的票會與「這張票根本不存在」長得一模一樣，偵測就此消失。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

CREATE TABLE `refresh_tokens` (
	`id` CHAR(36) NOT NULL,
	`company_id` CHAR(36) NOT NULL,
	-- 一次登入（§5.4.7）；整條鏈的作廢以這一欄辨識，鏈中每一列共用同一個值。
	`session_id` CHAR(36) NOT NULL,
	-- 全域帳號。刻意不建 FK → users.id：那條 FK 會讓 InnoDB 自動長出一個只有 (user_id) 的索引，
	-- 而 §4.5 要求本表索引一律以 company_id 開頭，且自動長出來的索引是隱形的、review 看不見。
	`user_id` CHAR(36) NOT NULL,
	-- 作廢範圍以公司成員為單位：本表帶 company_id，以全域帳號為範圍的作廢會是一次
	-- 不帶公司條件的寫入，而那是 §4.2 明文禁止、優先度最高的一條規則。
	`company_user_id` CHAR(36) NOT NULL,
	-- refresh token 原值的 SHA-256。DB 存 hash 不存原值：簽章證明「這串字是我們發的」，
	-- hash 證明「這串字就是我們發給這一列的那一串」——簽章金鑰外洩時，後者才擋得住偽造。
	`token_hash` BINARY(32) NOT NULL,
	-- datetime 存的就是台北牆鐘時間，不做任何換算（§6）。
	`issued_at` DATETIME NOT NULL,
	-- 這條鏈的絕對截止（§5.4.1 的 30 天）。輪替時原樣沿用，不重新計算——
	-- 每次輪替都重新給 30 天的話，只要持續使用鏈就無限延長，30 天這個數字永遠不會到期。
	`expires_at` DATETIME NOT NULL,
	-- access token 的滑動視窗截止（§5.4.1 的 2 小時）。每個通過驗證的請求把它往後推（§1.3 的續期）。
	`access_expires_at` DATETIME NOT NULL,
	-- 見檔頭第 2 點：有效時等於 session_id，作廢時寫成 NULL。這一欄是唯一鍵的載體。
	`active_session_id` CHAR(36),
	`revoked_at` DATETIME,
	-- ROTATED / LOGOUT / LOGOUT_ALL / REUSE_DETECTED。不用 DB ENUM（通用規範 §1.4），
	-- 代碼值的唯一來源是 schema 的 const object。四種必須分得出來：REUSE_DETECTED 是
	-- 唯一一種系統自己偵測到的安全事件（§5.4.2 要求寫稽核與告警），混進「已作廢」就把訊號丟了。
	`revoked_reason` VARCHAR(32),
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	-- 同一張票的原值不可能對應兩列；同時是「拿票換身分」那支查詢的支撐索引（以 company_id 開頭，§4.5）。
	CONSTRAINT `uq_refresh_tokens_company_token` UNIQUE(`company_id`,`token_hash`),
	-- 一條鏈同時只能有一列有效。作廢的列 active_session_id 是 NULL，而 UNIQUE 索引中 NULL 互不相等，
	-- 因此一條鏈可以累積任意多張作廢的票（偷用偵測需要它們），卻不可能同時有兩張有效票。
	-- 它同時是憑證驗證器那支查詢的支撐索引，而那是每一個已登入請求都會跑一次的查詢
	-- ——沒有索引就是每個請求一次全表掃描。
	CONSTRAINT `uq_refresh_tokens_active_session` UNIQUE(`company_id`,`active_session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='refresh token 與 session 的伺服器端權威狀態；一條輪替鏈同時至多一列有效';
--> statement-breakpoint
-- 複合外鍵一律帶上 company_id（比照 company_user_roles 的四條外鍵）：只指向 company_users.id 的話，
-- 一列「A 公司的 session」可以指向 B 公司的成員，資料庫完全接受——而這張表決定的是
-- 「誰能拿到哪一家公司的 access token」，寫錯一列就是一張進錯公司的票。
-- 這條外鍵用得上下面的 ix_refresh_tokens_company_member（前綴為 company_id, company_user_id），
-- 因此 InnoDB 不會再自動補一個看不見的索引。
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `fk_refresh_tokens_company_user` FOREIGN KEY (`company_id`,`company_user_id`) REFERENCES `company_users`(`company_id`,`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
-- 「登出所有裝置」與偷用偵測的全鏈作廢：以成員為範圍一次更新（§4.5：以 company_id 開頭）。
-- 第三段 active_session_id 讓「只挑還有效的列」這個條件也落在索引裡。
CREATE INDEX `ix_refresh_tokens_company_member` ON `refresh_tokens` (`company_id`,`company_user_id`,`active_session_id`);
