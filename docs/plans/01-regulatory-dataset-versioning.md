# 實作計畫：政府法規資料版本化

> Schema 依據：[docs/schema/05-regulatory-system.md](../schema/05-regulatory-system.md)
> 開發規範依據：[dev-standards-backend.md](../dev-standards-backend.md)（§ 編號皆指這份）

## 1. 這個計畫要交付什麼

**把政府法規資料（勞保／健保／勞退／職災費率與分級表、基本工資、扣繳稅額表）版本化地存進系統，並提供「某一天適用的是哪一版」的查詢。**

Payroll 結算時依**法規適用基準日**取得當時的費率與級距；政府事後更新不得改寫已結算的結果。這是 `docs/schema/05` 的核心約束，也是本模組存在的唯一理由：

> 已結算 Payroll 鎖定勞保、健保、勞退、職災與所得稅實際版本；政府後續更新不得改寫。

交付三張表與一個模組：

| 表 | 責任 |
|---|---|
| `regulatory_dataset_versions` | 版本、生效日、原始 Snapshot |
| `regulatory_records` | 解析後供查詢的標準化資料 |
| `regulatory_sync_logs` | 每次同步的結果 |

## 2. 明確不在本計畫內

| 項目 | 為什麼不做 | 什麼時候做 |
|---|---|---|
| **員工加保／退保／投保薪資級距** | 資料字典裡沒有這張表，等於要現場設計；而它在概念上綁的是**任職**（`employee_employments`），那張表也還沒建 | 員工模組 |
| **`company_regulatory_settings`**（公司職災行業別、投保單位類別） | 它保存的是**公司的選擇**，不是政府資料的版本化。而且它的合法值來自本計畫的資料集，順序上本來就該在後面 | 本計畫完成後，緊接著 |
| **保費計算** | `docs/schema/05`「Payroll 邊界」明確劃出去：法規模組提供歷史資料，Payroll 負責計算 | Payroll 模組 |
| **前端** | `docs/ui/` 沒有法規設定那一頁，沒有已定案的 UI 規格 | UI 定案後 |

---

## 3. 資料表

### 3.1 `dataset_code`（已定案）

`integer`，**一旦有版本資料寫進去就不能改**——改了等於歷史資料指向另一個資料集，而且不會有任何地方報錯：假設 `4` 與 `5` 對調，Payroll 算勞保時拿到的是健保費率，算出一個看起來完全正常的保費，要到有人核對薪資單才會發現，而那時已經結算好幾期。

清單如下，**本清單即為唯一來源**，程式碼中的 `datasets/domain/regulatory-dataset-code.ts` 必須與它逐項一致，**並由 `bun run check:dataset-code` 掃描比對**（見 §3.1.1）：

| code | 資料集 | 備註 |
|---|---|---|
| 1 | 勞工保險投保薪資分級表 | 級距，用 `range_from`／`range_to`／`amount` |
| 2 | 全民健康保險投保金額分級表 | 級距 |
| 3 | 勞工退休金月提繳工資分級表 | 級距 |
| 4 | 勞工保險費率 | 費率，用 `rate` |
| 5 | 全民健康保險費率（含補充保費） | 費率 |
| 6 | 職業災害保險行業別費率 | 依行業別代碼，用 `code`＋`rate` |
| 7 | 投保單位類別 | 代碼表，用 `code`＋`name` |
| 8 | 基本工資 | 月薪與時薪兩筆 |
| 9 | 薪資所得扣繳稅額表 | 結構特殊，`docs/schema/05` 已定案「先放 `data`，暫不另拆表」 |

`6` 與 `7` 之所以做成資料集而不是程式常數：**行業別代碼政府會改**。做成常數的話每次改都要發版，而且舊資料會失去它當時對應的名稱——`company_regulatory_settings` 存的是代碼，代碼的意義換了，歷史就跟著被改寫。

#### 3.1.1 用掃描器守，不是用註解守

新增 `bun run check:dataset-code`，掛進 `ci`：以上表為唯一來源，比對 `regulatory-dataset-code.ts` 的每一組「代碼 ↔ 名稱」，任一項不一致即失敗；並含掃描項數的下限自我檢查（通用規範 §7.2）。

**這條規則不能只靠註解，理由就在上一段。** 稽核計畫用掃描器守欄位分類，這裡守的是一份後果更嚴重的清單，卻只寫一句「必須逐項一致」，那是不一致的處置。

具體會怎麼失守：有人整理常數檔時把列舉值改成按字母排序，`4`（勞保費率）與 `5`（健保費率）對調，PR 描述寫「僅整理常數排序，無邏輯變更」——這種 PR 幾乎必然被放行。而資料庫裡既有的資料**不會跟著改**，於是 Payroll 要算勞保時拿到的是健保費率，算出一個看起來完全正常的保費。

### 3.2 `regulatory_dataset_versions`

依字典逐欄實作，四點要寫進 migration 註解：

**(a) 主鍵用 `bigint` auto-increment，這是全站第一張不用 uuid 的表。** 字典就是這樣定的，而且理由站得住：這三張表是**平台全域**資料（不屬於任何公司）、只增不改、`regulatory_records` 的列數會到數千乘以版本數。CHAR(36) 對它是 36 bytes 換 8 bytes 的純浪費。

**(b) 不進 `CompanyScopedTable`。** 它沒有 `company_id`，走的是裸 db client 那條路（§4.2），和 `users`、`permissions` 同一類。這件事要在 `db/schema/index.ts` 的註解裡講一句，否則下一個人會以為是漏加。

**(c) `raw_data` 是 LONGTEXT，因此本表禁止 `SELECT *`。** MariaDB 把 LONGTEXT 存在頁外、不選就不讀，所以只要 repository 逐欄列出就沒有代價；但只要有人寫了一次 `SELECT *`，列版本清單就會順手拖出每一版的完整 Snapshot，而症狀是「列表偶爾很慢」，不是錯誤。

**(d) `effective_to` 只在「政府明示失效日」時才寫入，不拿來記「下一版開始日的前一天」。**

這是本表最容易寫錯的地方。字典說 `effective_to`「可由下一版本推導」——**推導，不是寫入**。如果新增一版時要順手 UPDATE 前一版的 `effective_to`，那個 UPDATE 漏掉不會有任何錯誤，只會讓兩個版本同時宣稱自己在某一天有效，而 `resolve` 挑到哪一版取決於 `ORDER BY` 的巧合。

所以解析查詢固定長這樣，永遠只回一筆：

```sql
WHERE dataset_code = ?
  AND effective_from <= :asOfDate
  AND (effective_to IS NULL OR effective_to >= :asOfDate)
ORDER BY effective_from DESC, id DESC
LIMIT 1
```

**`id DESC` 這個次要排序鍵是必要的，不是保險。** 語意是「**同日生效時，後寫入的版本優先**」。

`UNIQUE(dataset_code, version_code)` 只保證版本代碼不重複，**完全不保證 `effective_from` 不重複**——版本補錄、或 §7 提到的 checksum 誤判導致同一份資料重新寫成新版本，都會產生兩筆同日生效的紀錄。少了次要排序鍵，挑到哪一筆由實體儲存順序與執行計畫決定：這次跑出版本 A，重建索引或升級 MariaDB 之後跑出版本 B。**兩版的費率都是正常數字，沒有錯誤訊息，而且不可重現。**

測試必須有一筆專門驗「兩筆 `effective_from` 相同時結果穩定」。

約束：`UNIQUE(dataset_code, version_code)`；不使用 `is_current`（字典明確列在「被推翻方案」）。

索引：`(dataset_code, effective_from)` — 上面那支查詢的唯一熱點。

**時間欄位**：`source_modified_at` 來自政府，時區未必是台北。一律在解析階段轉成台北牆鐘時間再寫入（§6）；轉換規則寫在各資料集的解析器裡，不是寫在資料表上。

### 3.3 `regulatory_records`

依字典逐欄實作。兩點補充：

**索引 `(dataset_version_id, range_from, range_to)`**：級距查詢（給一個投保薪資，找出它落在第幾級）是這張表的熱點，而且是 Payroll 每算一個人就會打一次的查詢。

**`data` 欄的型別在讀出時收斂**，見下面 §6。

約束：`UNIQUE(dataset_version_id, record_key)`。

### 3.4 `regulatory_sync_logs`

依字典逐欄實作，**外加一欄 `heartbeat_at`**（字典沒有這一欄，增補理由如下）。

`status_code` 的 `1 執行中` 有一個字典沒有處理的失敗模式：程序被殺掉（部署、OOM、機器重啟）之後，那一筆會永遠停在 `1`。而下一次排程看到「已有執行中的同步」就會跳過，於是**從此再也不同步，且沒有任何錯誤**——沒有失敗紀錄、沒有告警，log 裡只有一筆安靜的「執行中」。要到政府調了費率、系統還在用舊版才會發現。

| 欄位 | 型態 | 必填 | 說明 |
|---|---|---|---|
| `heartbeat_at` | `datetime` | 必填 | 同步程序存活訊號；`status_code=1` 期間每 60 秒更新一次 |

判定規則：

- 執行中的同步**每 60 秒**更新一次 `heartbeat_at`。
- 下一次同步啟動時，若發現同一 `dataset_code` 有 `status_code=1` 且 `heartbeat_at` 落後**超過 3 分鐘**（三個心跳週期），視為該程序已死。
- **視為死亡時要把它改成 `status_code=3 失敗` 並寫入 `error_message`（心跳逾時），不是直接忽略。** 字典要求「同步紀錄獨立保存每次下載、驗證與套用結果」，靜靜略過等於少了一次失敗紀錄，而那正是事後要查「為什麼那三天沒同步」時唯一的線索。

**為什麼是心跳而不是「`started_at` 超過 N 分鐘就當失敗」**：固定逾時要猜一個「同步最久會跑多久」的數字，而那個數字猜小了會把還活著的程序判死（於是兩個程序同時寫同一個版本），猜大了則卡死的紀錄要等很久才會被清掉。心跳量的是「程序還在不在」，不是「跑了多久」，所以不需要猜。

**為什麼是三個週期而不是一個**：漏掉一次心跳可能只是 GC 或 IO 卡住；連續三次沒更新，程序基本上不可能還活著。

**心跳必須由獨立計時器驅動，不得綁在工作步驟上。** 也就是說，「每完成一個步驟才更新一次 `heartbeat_at`」這種寫法是不合格的實作，即使它看起來達成了同樣的效果。

理由：Bun 是單一事件迴圈。若心跳跟著工作步驟走，任何一個長步驟——政府端點回應緩慢的單一 `await fetch()`、或扣繳稅額表（`dataset_code=9`，結構特殊）那種 CPU 密集的同步解析——只要超過 180 秒，心跳就不會動。**於是一個活得好好的程序被判死**，第二個程序接手同時寫入；若兩者算出的 `version_code` 不同（例如版本代碼含日期戳記），就會產生兩個並存的合法版本，直接餵給 §3.2 的排序問題。

### 3.5 Migration 編號

```
0011_create_regulatory_dataset_versions.sql
0012_create_regulatory_records.sql
0013_create_regulatory_sync_logs.sql
0014_seed_permission_codes_regulatory.sql
```

（`0010` 是稽核表，見 [02-audit-logs.md](02-audit-logs.md)。）

**權限碼 seed 與表在同一批進，不留到後面補。** `0009` 是補的，那次的症狀是「登入之後員工功能一律 403」——`identity-guard` 由路徑推導出 `employees.main.list`，權限樹裡卻沒有這個碼，於是任何角色都不可能被授予它。**測試全綠、路由掛得上、沒有任何地方會變紅**，只有真的拿帳號去點才會發現。

---

## 4. 模組結構

大目錄 `regulatory`，兩個次目錄：

```
modules/regulatory/
├── index.ts        對其他模組（Payroll）的出口：service ＋ errors
├── routes.ts       對路由組裝點的出口
│
├── datasets/       ── 讀：版本清單、版本內容、依基準日解析
│   ├── regulatory-datasets.routes.ts
│   ├── regulatory-datasets.handler.ts
│   ├── regulatory-datasets.service.ts
│   ├── regulatory-datasets.repository.ts
│   ├── regulatory-datasets.errors.ts
│   ├── domain/
│   │   ├── regulatory-dataset-code.ts     dataset_code 清單（唯一來源）
│   │   ├── regulatory-record-shape.ts     每個 dataset_code 的 data 形狀
│   │   └── regulatory-effective-version.ts 基準日 → 版本的挑選規則（純函式）
│   ├── impl/
│   │   ├── regulatory-datasets.list.service.ts
│   │   ├── regulatory-datasets.resolve.service.ts
│   │   ├── regulatory-datasets.find-version.repository.ts
│   │   ├── regulatory-datasets.find-effective-version.repository.ts
│   │   ├── regulatory-datasets.list-versions.repository.ts
│   │   └── regulatory-datasets.list-records.repository.ts
│   └── __tests__/
│
└── sync/           ── 寫：抓取、解析、寫入、留紀錄（Stage 3）
    └── （同一形式）
```

**為什麼 `datasets` 與 `sync` 要分成兩個次目錄**，明明碰的是同一批資料：讀的人是 Payroll（每次結算都會呼叫、不能失敗、不能慢），寫的人是排程（一天一次、可以失敗、失敗要留紀錄）。合在一起的話，Payroll 的查詢路徑會一路 import 到 HTTP fetch 與解析器。

**`sync` 需要 `datasets/domain/` 的形狀定義**（寫入前驗證要用同一份），這是允許的：§0.3「同一大目錄內的次目錄之間可以互相 import」。但 `sync` 不得碰 `datasets` 的 repository，要資料一律走它的 service。

### 4.1 對 Payroll 的介面不是 HTTP，是 `index.ts`

這一點要寫在 `index.ts` 的檔頭裡，因為它會被誤會。Payroll 呼叫的是：

```ts
resolveEffectiveDataset({ datasetCode, asOfDate })
```

**不是**打 `/regulatory/datasets/resolve`。HTTP 端點的存在是給前端顯示用的，兩者共用同一支 service（§0.4「沒有端點的業務動作一樣放在入口檔」的反面：這一支同時有兩種呼叫者）。

### 4.2 端點

| 路徑 | 用途 |
|---|---|
| `/regulatory/datasets/list` | 某資料集的版本清單（分頁，§1.4） |
| `/regulatory/datasets/get` | 單一版本的 metadata（**不含** `raw_data`） |
| `/regulatory/datasets/resolve` | 依 `datasetCode` ＋ `asOfDate` 取適用版本及其 records |
| `/regulatory/sync/list` | 同步歷程（Stage 3） |

**`asOfDate` 必填，不預設今天。** `docs/schema/05` 明講「版本依各法規適用基準日選擇，不依系統當天日期」。給了預設值之後，Payroll 補算去年 12 月的薪資會抓到今年的費率，算出一個**完全合理的數字**，沒有任何一層會發現不對。

**兩支端點刻意不開**（理由見 §8-D3）：

- `/regulatory/datasets/raw`（看原始 Snapshot）
- `/regulatory/sync/trigger`（人工觸發同步）

### 4.3 權限碼

由路徑推導，`0014` seed（id 沿用既有規律，接在 employees 的 `...05xx` 之後用 `...06xx`）：

```
regulatory                        法規資料              （節點）
regulatory.datasets               法規資料集            （節點）
regulatory.datasets.list          查詢版本清單
regulatory.datasets.get           查詢單一版本
regulatory.datasets.resolve       解析適用版本
regulatory.sync                   法規同步              （節點）
regulatory.sync.list              查詢同步歷程
```

### 4.4 錯誤字典與訊息 key

`regulatory-datasets.errors.ts`，訊息 key 由模組路徑推導（四段）：

| code | group / HTTP / envelope `code` | 說明 |
|---|---|---|
| `regulatory.datasets.errors.no-effective-version` | `Unprocessable` / 422 / `300` | 該基準日沒有適用版本 |

依 §1.8.3，錯誤碼宣告時必須同時標明對應的 HTTP status 與 envelope `code`，一個碼只能對應一種。

**這裡沒有 `version-not-found`，那是刻意的。** `/regulatory/datasets/get` 是查詢類端點，而 §3.1.3 規定查詢類的「目標不存在」回 HTTP 200 ＋ `code='200'` ＋ `data: null`，**不算錯誤、不進錯誤集合**。多開一個 not-found 錯誤碼會讓這支端點的「查無資料」跟全站其他查詢端點長得不一樣，前端就得為它單獨寫一條分支。

「未知的 `datasetCode`」也不在這裡：它是列舉值，由 schema 驗證擋下（`100`，§2），不是業務錯誤。

#### `no-effective-version` 有兩個呼叫者，形狀不同

它代表「這一天的法規我們沒有資料」，是本模組最重要的一則錯誤。但 `resolve` 有兩種呼叫者，兩者拿到的形狀不一樣：

| 呼叫者 | 形狀 |
|---|---|
| HTTP `/regulatory/datasets/resolve` | 查詢類，`data: null`（同上，照 §3.1.3） |
| service `resolveEffectiveDataset`（Payroll 等模組） | `ServiceResult<T>` 的失敗分支，帶這個錯誤碼 |

**service 端回 `ServiceResult`，不是拋例外。** 業務拒絕一律用收集不用例外（§3.1.1）——拋例外的話 Payroll 必須 `catch` 才能繼續，而用 `catch` 表達業務流程正是該節禁止的事。

**跨模組的錯誤碼必須由呼叫端轉譯成自己的碼。** Payroll 的端點依 §1.8.3 要宣告自己會吐哪些錯誤碼，那份清單只能是 `payrolls.*`；讓 `regulatory.datasets.errors.no-effective-version` 原封不動漏到前端，等於回了一個路徑上不存在於該端點的模組錯誤碼。轉譯時把 `datasetCode` 與 `asOfDate` 放進自己那筆錯誤的 `data`，否則「哪個資料集、哪一天」這個唯一有用的資訊會在轉譯過程中掉光。

**安全性來自型別，不是來自例外。** `ServiceResult<T>` 是可辨識聯集，**不處理失敗分支就取不到 `value`**，編譯不過。這比拋例外強：例外可以被一個空的 `catch` 吞掉，型別不行。

不這樣規定的話會發生什麼：300 名員工的批次結算，其中 1 人因為新的職災行業別還沒同步而查無版本。若介面回的是 `null`，呼叫端很容易寫成「單人失敗就 log 並 continue」——**那個人的薪資單直接從當期結果中消失**，批次跑完看起來成功，只是少一張。除非有人核對「應結算人數 vs 實際產出張數」，否則不會有人發現。

新增語系檔 `apps/api/src/shared/i18n/locales/zh-TW/regulatory.ts`。

---

## 5. 分階段

### Stage 0 — 稽核表（前置）

已定案：**稽核表先做完再開始本模組**（決策 D4）。表名 `audit_logs`，逐欄 Schema 與實作計畫見 [02-audit-logs.md](02-audit-logs.md)。

本模組**不會**再欠稽核：它以唯讀為主，而同步結果本身已由 `regulatory_sync_logs` 涵蓋。Stage 0 是為了不讓緊接在後的 `company_regulatory_settings`（「誰把公司職災行業別從甲類改成乙類」——而職災費率會跟著變）成為第四筆欠帳。

### Stage 1 — 資料表與手動匯入

- 三張表的 Drizzle schema ＋ migration `0011`–`0014`（§3.5）
- `dataset_code` 清單（`datasets/domain/`）
- 匯入 script（`apps/api/scripts/import-regulatory-dataset.ts`）：吃一個本機檔案，寫成一個版本 ＋ 一批 records

**驗收**：`bun run db:migrate` 乾淨；用 script 匯入「投保單位類別」與「職災行業別費率」兩個資料集，資料進得去。

### Stage 2 — 查詢層

- `datasets` 次目錄完整五層 ＋ `resolve` service
- 三支端點掛上 `authenticatedGroup`
- 測試：**同一個 `asOfDate` 在多版本並存時只回一版**，以及跨版邊界日（`effective_from` 當天、前一天）

**驗收**：`resolve` 對匯入的資料回得出正確版本；`no-effective-version` 在查一個沒有資料的日期時確實回 `300`；typecheck、測試、`check:i18n` 全綠。

**做完 Stage 2，這個模組對 Payroll 就已經可用了**——後面只差資料不是自動來的。

### Stage 3 — 同步（建議完成 Stage 1、2 後單獨評估再開）

- `sync` 次目錄、`regulatory_sync_logs` 寫入
- 每個 `dataset_code` 一支 resource discovery ＋ 下載 ＋ 解析器
- 排程

風險與前兩階完全不同，見下。

---

## 6. `data` 欄的型別在哪裡收斂

`regulatory_records.data` 是 json，每個 `dataset_code` 形狀不同。規則：

**一個 `dataset_code` 對應一個 TypeBox schema（放在 `datasets/domain/regulatory-record-shape.ts`），寫入前驗證、讀出後也驗證。**

### 6.1 金額與費率一律是 decimal 字串，禁止 `number`

`amount`（金額或計算基礎值）與 `rate`（費率）在 schema 上訂為 **decimal 字串**（比照既有的 branded type），讀出後**禁止 `Number(...)` 再計算**（§4.7）。`regulatory_records.data` 裡承載的同類數值同理。

這條不是通則的複述，規範 §4.7 逐字點名的就是這個模組的場景：

> 浮點誤差在薪資單上就是實發金額差一塊錢對不起來，而**勞健保級距在邊界值上會選錯級距**，錯的是法定金額。

級距的比對是「這個投保薪資落在 `range_from` 與 `range_to` 之間嗎」——邊界值正好等於級距上限時，浮點誤差會讓它掉到下一級。**保費差幾百塊，而薪資單上完全看不出異常。**

讀出後也驗證看起來多餘，但它擋的是另一件事：資料是**幾個月前**由另一版程式寫進去的。解析器改過、欄位名改過、政府資料格式變過——寫入時的驗證管不到已經在庫裡的資料。驗不過時當系統錯誤（`400`），不是業務錯誤。

不能讓 `data` 以 `unknown` 流進 Payroll：那等於把型別檢查的邊界推進薪資計算裡面。

---

## 7. Stage 3 的主要風險（現在先寫下來，不現在解）

**`effective_from` 從哪裡來，政府資料多半不會告訴你。**

`docs/schema/05` 明確把「人工核准每個法規版本」列為被推翻方案，所以生效日**必須能由程式推導**。但實際情況是：政府 Open Data 通常只給你一份當期的表，生效日寫在公告或函釋裡，不在資料裡。

這代表每一個 `dataset_code` 都要各自解決「這一版從哪天開始生效」，而且解法會不一樣（有的在檔名、有的在欄位、有的只能靠公告日推）。**這是 Stage 3 真正的工作量所在**，不是下載和解析。

其次是 `government_resource_id`：字典明寫「不視為永久固定 URL」，所以要有 resource discovery，而那是最容易在正式環境安靜壞掉的一段。

同步流程（供 Stage 3 展開）：

```
建 sync_log（status=1 執行中，心跳啟動）
  → resource discovery
  → 下載 raw
  → checksum 比對該資料集最新版本 → 相同則 status=4 無異動，結束
  → 解析 → records（依 §6 驗證）
  → 決定 version_code 與 effective_from   ← 最難的一步
       └─ 推導不出來 → status=3 失敗，結束    ★ 見下
  → 同一交易寫入 version ＋ records
  → status=2
```

失敗時 `status=3` 並寫 `error_message`；**任何情況下不得動到已存在的有效版本**（字典：「同步失敗不得破壞既有有效版本」）。

### 7.1 推導不出生效日，一律失敗，不得猜

**這條現在就要寫死，因為 Stage 3 開工時沒有別的地方會提醒。**

> 任何資料集的解析器若無法從來源**明確**推導 `effective_from`，同步必須以 `status=3` 失敗。
> **不得以同步當天日期、上一版生效日、或任何推測值作為 fallback。**

沒有這條會發生什麼：某個資料集的政府公告改版，原本藏生效日的欄位或檔名規則失效。解析器沒有拋錯，而是走了一個看起來很合理的 fallback（多半是「用同步當天」），於是產生一個**錯誤但完全合理**的生效日，悄悄改變了「這個資料集現在該算哪一版」的判定。

這種錯誤幾乎不可能被測試覆蓋——**任何日期看起來都是合理的日期**，沒有一個斷言能說它不對。要等到有人拿政府公告去人工核對才會發現，而那時可能已經影響好幾期 Payroll，而已結算的部分依規定不得重算覆蓋。

寧可同步失敗、有人去看 `error_message`，也不要一個安靜生效的錯誤版本。

---

## 8. 已定案的決策

### D1　`dataset_code` 清單 — 採用 §3.1 的九項

九個資料集、九個編號如 §3.1 表列，不再調整順序。程式碼中的 `datasets/domain/regulatory-dataset-code.ts` 以該表為唯一來源。

### D2　同步存活判定 — 採心跳（`heartbeat_at`）

規則與理由見 §3.4。這是本計畫對資料字典的唯一欄位增補。

### D3　`sync/trigger` 與 `datasets/raw` 不開放為端點

觸發全平台同步、查看政府原始 Snapshot，這兩件事不該由某一家公司的管理者做。目前的權限模型是「公司成員 ＋ 角色」，**沒有平台管理員這個概念**（§4.2 提到跨公司平台功能「走獨立且明確命名的路徑」，但那條路徑還沒建）。

若照常開放，`晷光示範股份有限公司` 的管理者按一次 `sync/trigger`，效果是重抓政府資料、寫入新版本，**平台上每一家公司的 Payroll 都跟著換版本**——一家公司的管理者，按一個鈕，影響全平台。

處置：Stage 1、2 的資料靠匯入 script（在伺服器上執行，不經過 HTTP），Stage 3 靠排程。等平台管理員定案再把這兩支補上；補的時候權限碼已經預留（`regulatory.datasets.raw`、`regulatory.sync.trigger` 屆時再 seed）。

### D4　稽核表提前到本模組之前完成

`docs/schema/05` 說稽核表「最終表名與逐欄 Schema 尚未定案」，因此前三個模組各留了一筆欠帳：

| 模組 | 該記卻沒記的事 |
|---|---|
| 角色 | 誰在什麼時候把某個角色指派給某人／撤銷 |
| 員工 | 誰把員工編號從 `E001` 改成 `E002` |
| 登入 | refresh token 被重複使用（可能是憑證外洩） |

已定案：**先把稽核表做完**（見 Stage 0）。本模組本身不會再欠，但緊接其後的 `company_regulatory_settings` 一定會欠——「誰把公司職災行業別從甲類改成乙類」正是必須留紀錄的異動，而職災費率會跟著變。
