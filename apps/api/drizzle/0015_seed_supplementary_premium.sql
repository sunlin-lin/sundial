-- 業務資料 seed：`dataset_code = 10` 健保補充保險費的第一個版本
-- （實作計畫 docs/plans/01-regulatory-dataset-versioning.md §3.1.1）。
--
-- **為什麼這一支要單獨開，不併進 0014**（計畫 §3.5）：它寫的是業務資料（一個法定費率），
-- 不是結構或權限樹。日後費率調整時要再發一支同類的 migration，兩者放在一起會讓
-- 「這個資料集現在是哪一版」要翻權限碼的 migration 才找得到。
--
-- ## 為什麼只有這一個資料集由 migration 帶入資料
--
-- 其餘九項全部自動同步，只有 10 是人工維護，而這個例外的理由是查證出來的，不是懶（計畫 §3.1.1）：
--
--   * 掃過全國法規資料庫全文（law.moj.gov.tw，1,346 部法律 ＋ 10,445 部命令）：《全民健康保險法》
--     §33 原文只寫「施行第一年以百分之二計算…其調整後之比率，由主管機關逐年公告」。
--     法條寫死的是初年的 2%，現行值依法就只存在於公告裡。
--   * 掃過 data.gov.tw 全量目錄（53,109 筆，健保署＋衛福部共 380 個資料集）：沒有任何資料集提供費率。
--   * 唯一的公開處是健保署網頁的內文純文字（「公式：計費所得或收入 ×費率2.11%」），
--     而那一頁沒有生效日，只有「最新110.01.01更新」這種敘述。爬得到值、爬不到日期，
--     因此不符合計畫 §7.2（推導不出生效日一律失敗，不得猜）。
--
-- 三個值（費率、計費下限、單次上限）放同一個資料集而不是拆開：它們是同一次公告裡的同一件事，
-- 分開維護必然漂移。
--
-- ## 日後費率變動時要做什麼
--
-- **新增一個版本，不是 UPDATE 這一列。** 覆寫的後果是實的：2026-03 用 2.11% 結算三月薪資、
-- 錢發出去了；2027-01 政府調成 2.3%，有人把數字改掉——回頭查 2026-03 的薪資單，
-- 系統說當時用的是 2.3%，但實際發出去的錢是照 2.11% 算的。對不起來，而且沒有任何地方會報錯。
-- 這正是資料字典「已結算 Payroll 鎖定實際版本，政府後續更新不得改寫」要防的事。
--
-- 調整介面的操作者會是平台管理員，而那個角色還不存在（計畫 D3），所以現在沒有畫面：
-- 在平台管理員做出來之前若費率變了，就發一支同形狀的 migration 新增版本
-- ——那一樣有 git 紀錄與 review，不比後台差。
--
-- 已套用的 migration 禁止修改或刪除（§4.1）：改寫已跑過的檔案，已經跑過的環境永遠不會再執行修正，
-- 於是開發機正常、正式機壞掉。要修正一律新增一支。

-- 明確釘住 session 時區再寫入時間（§6）：migration 由 CLI 以自己的連線執行，
-- 不會經過應用程式的連線設定，靠伺服器預設等於把時間正確性寄託在另一個地方的設定上。
-- 本支寫入 synced_at／created_at 與生效日，時區釘不住就是靜靜偏移。
SET time_zone = '+08:00';
--> statement-breakpoint
-- 版本本身。
--
-- **寫成 INSERT ... SELECT 而不是 VALUES，是為了讓 checksum 與 raw_data 出自同一個字面值**：
-- checksum 的定義是「原始內容的雜湊」，兩者各寫一次的話，日後有人調整說明文字卻忘了重算雜湊，
-- 就會產生一個「看起來有驗證、實際上驗不到東西」的欄位——而它不會報錯。
-- 這裡由資料庫當場 SHA2(raw, 256)，兩者不可能不一致。
--
-- 逐欄的取值理由：
--   dataset_code = 10        健保補充保險費（計畫 §3.1 的清單，唯一來源是那張表）
--   version_code = '2021-01' 自訂的穩定值。這個資料集沒有政府版本代碼可抄（它根本沒有來源），
--                            因此以生效年月命名；下一次調整就是 'YYYY-MM'，規則不必再想一次。
--   effective_from           民國 110/1/1，即西元 2021-01-01（行政院核定）。
--   effective_to = NULL      政府沒有明示失效日，因此不寫（計畫 §3.2 (d)）——
--                            這一欄不拿來記「下一版開始日的前一天」。
--   government_resource_id   NULL：沒有來源資源（見檔頭）。
--   source_modified_at       NULL：健保署網頁只有「最新110.01.01更新」這種敘述，不是可信的時戳。
--   synced_at = NOW()        這一版不是從政府端點抓來的，它的「取得時間」就是這支 migration
--                            執行的時間。欄位 NOT NULL，而填一個假的政府時間比填執行時間糟得多。
--   raw_format_code = 5      純文字（RegulatoryRawFormat.Text）：raw_data 是人工輸入時依據的
--                            來源說明，不是政府檔案。
--   record_count = 3         下一段寫入的三筆。
INSERT INTO `regulatory_dataset_versions`
	(`dataset_code`, `version_code`, `effective_from`, `effective_to`, `government_resource_id`,
	 `source_modified_at`, `synced_at`, `checksum`, `record_count`, `raw_format_code`, `raw_data`, `created_at`)
SELECT
	10, '2021-01', '2021-01-01', NULL, NULL,
	NULL, NOW(), SHA2(s.`raw`, 256), 3, 5, s.`raw`, NOW()
FROM (
	SELECT '健保補充保險費（dataset_code=10）人工維護版本，生效日 民國110年1月1日（西元2021-01-01）。

【本版內容】
費率：2.11%（0.0211）
計費下限：單次給付金額達新臺幣 20,000 元始計收
單次上限：單次給付金額以新臺幣 10,000,000 元為上限

【依據】
1. 全民健康保險法 第33條：「補充保險費率，於本法中華民國一百年一月四日修正之條文施行第一年
   以百分之二計算；自第二年起，應依本保險保險費率之成長率調整，其調整後之比率，由主管機關逐年公告。」
   ——法條寫死的是施行第一年的 2%，現行值依法只存在於主管機關的逐年公告中。
2. 現行費率 2.11% 自民國110年1月1日起適用（行政院核定）。衛生福利部中央健康保險署網頁載明
   計算公式為「計費所得或收入 ×費率2.11%」，惟該頁面未標示生效日，僅有「最新110.01.01更新」之敘述。
3. 全民健康保險扣取及繳納補充保險費辦法 第4條：單次給付金額之計費下限與上限。

【為什麼是人工維護（計畫 §3.1.1）】
a. 已掃描全國法規資料庫全文 API（law.moj.gov.tw/api/Ch/Order/JSON，1,346 部法律 ＋ 10,445 部命令），
   法條本文不含現行費率。
b. 已掃描 data.gov.tw 全量目錄（53,109 筆，健保署與衛生福利部共 380 個資料集），
   無任何資料集提供補充保險費率。
c. 唯一可取得數值之公開處為健保署網頁內文純文字，但該頁無生效日；爬得到值、爬不到日期，
   不符合計畫 §7.2「推導不出生效日一律失敗，不得猜」。

【維護方式】
費率調整時新增一個版本（新的 version_code 與 effective_from），不得覆寫本列。' AS `raw`
) AS s;
--> statement-breakpoint
-- 三筆 records。
--
-- **金額與費率一律寫進 DECIMAL 欄位**（rate／amount），不是只塞進 data（§4.7、計畫 §6.1）：
-- 這樣「級距與費率的比較與運算」才走得到 DECIMAL 這條路。字面值一律加引號，
-- 讓它以字串形式進入 DECIMAL，不經過任何浮點表示。
--
-- data 裡的同一個值也是**字串**，不是 JSON number：JSON number 在多數解析器裡就是 double，
-- 0.0211 這種值一進去就不是原來那個數了，而且不會報錯。
--
-- record_key 用語意名稱而不是流水號：同一筆內容在不同版本之間必須拿到同一個 key，
-- 「這一項在新版變成多少」才比對得出來。
--
-- 三筆共用同一個 dataset_version_id，以 (dataset_code, version_code) 反查而不是用 LAST_INSERT_ID()：
-- 前者在任何執行順序下都指向同一列，後者一旦有人日後在中間插入別的 INSERT 就會靜靜地指錯。
INSERT INTO `regulatory_records`
	(`dataset_version_id`, `record_key`, `code`, `name`, `range_from`, `range_to`, `amount`, `rate`, `data`, `sort_order`, `created_at`)
SELECT v.`id`, 'rate', NULL, '補充保險費率', NULL, NULL, NULL, '0.0211',
	JSON_OBJECT('item', 'rate', 'rate', '0.0211'), 10, NOW()
FROM `regulatory_dataset_versions` v WHERE v.`dataset_code` = 10 AND v.`version_code` = '2021-01'
UNION ALL
-- 計費下限：單次給付金額達 20,000 元才計收。放 amount 而不是 range_from——
-- 它是「門檻值」而不是某一級的下界，本資料集沒有級距。
SELECT v.`id`, 'charge-lower-bound', NULL, '單次給付計費下限', NULL, NULL, '20000', NULL,
	JSON_OBJECT('item', 'chargeLowerBound', 'amount', '20000'), 20, NOW()
FROM `regulatory_dataset_versions` v WHERE v.`dataset_code` = 10 AND v.`version_code` = '2021-01'
UNION ALL
-- 單次上限：單次給付金額以 10,000,000 元為上限。
SELECT v.`id`, 'single-payment-upper-limit', NULL, '單次給付計費上限', NULL, NULL, '10000000', NULL,
	JSON_OBJECT('item', 'singlePaymentUpperLimit', 'amount', '10000000'), 30, NOW()
FROM `regulatory_dataset_versions` v WHERE v.`dataset_code` = 10 AND v.`version_code` = '2021-01';
