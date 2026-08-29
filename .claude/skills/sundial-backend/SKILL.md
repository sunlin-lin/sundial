---
name: sundial-backend
description: Sundial 後端（apps/api）的開發規範與實作指引，涵蓋 Elysia ＋ Drizzle／MariaDB ＋ TypeBox ＋ i18next 這一套的實際寫法：縱切模組結構與檔名推導、三段路徑一律 POST 的 RPC 契約與 envelope、ServiceResult 錯誤收集、多公司資料隔離、交易與稽核、時區注入、測試與自動化檢查。只要動到 apps/api 底下任何後端程式碼就要先讀這個 skill——新增或修改端點、加資料表或 migration、寫 service／repository／handler／routes、處理錯誤或權限或稽核、寫後端測試、或被 bun run ci 擋下來要修的時候，都適用。不要憑一般 Node／Express／REST 習慣動手：這套系統刻意偏離 REST（一律 POST、參數全走 body、HTTP status 之外另有一層 envelope code），而且多數規則沒有工具在擋，寫錯不會報錯，只會安靜地違規。
---

# Sundial 後端開發

權威來源是 `docs/dev-standards-backend.md`（1451 行，§0～§9）。需要完整論證時回查該章；本 skill
不重複它。

## 這份 skill 只講什麼

`modules/employments/main/`、`modules/departments/main/` 這兩個模組本身就是最好的教材——每個
檔案的檔頭都寫了「為什麼」。分層責任、`ServiceResult` 的基本寫法、repository 要帶公司範圍、
`recordAudit` 要收交易 handle，照抄這兩個模組就能自己做對，這份 skill 不會再講一次。

**只留三類東西**：

1. **規則本身看不出來或猜不到**——檔名一個字取錯，會讓一整組規則同時失效，卻不會報錯；模組
   歸屬的判準也不寫在程式碼的任何一行裡。
2. **寫錯了沒有紅字**——哪些規則真的有工具擋、擋的範圍到哪，是可以查證的事實不是慣例，得去看
   腳本或設定檔本身才知道，光看業務程式碼看不出來。
3. **規範文件本身過期或不準**——標 ✅ 但腳本其實不存在，或工具現況與文件描述不同。

多數任務仍要跨兩三份 `references/`，但目的是查這三類事，不是重新學一次分層結構。

## 什麼有工具擋、什麼只能靠自己

這一節放在最前面，因為它決定你要多小心。規範 §8 那張表列了 66 條「可自動化檢查」，**但相當一部分的腳本還沒寫**——規範標著 ✅ 不等於現在有東西在跑。以下每一行都對照過實際腳本或設定檔，不是照抄規範原文。

**真的會擋你的：**

| 工具                                            | 擋什麼                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check:n-plus-one`                              | 迴圈內 await 資料庫查詢（§4.5）                                                                                                                                                                                                                                                                                                                  |
| `check:audit-transaction`＋`check:audit-policy` | 稽核與業務寫入不同交易、稽核欄位政策（§5.3）                                                                                                                                                                                                                                                                                                     |
| `check:migration-journal`                       | 手寫 migration 沒補 journal／snapshot、idx 跳號（§4.1）。**它不驗什麼**：只比對檔名存在（entry 對得上一支 `.sql`、`idx` 對得上一份 `snapshot.json`），**不讀 snapshot 內容，也不驗證 `id`／`prevId` 鏈是否正確**——手寫時偽造的假鏈一樣通過，卻會在下次真的跑 `db:generate` 時對不上基準，見 `references/database.md` §1                          |
| `check:i18n`                                    | 訊息參數與 `MESSAGE_PARAM_SPECS` 對不上                                                                                                                                                                                                                                                                                                          |
| `check:tz-leak`／`check:number-cast`            | 掃的是 `apps/web`：前端時區洩漏、金額退化。**後端不在這兩支的範圍內**                                                                                                                                                                                                                                                                            |
| `check:dataset-code`                            | **掃的是後端**（`apps/api/src`，讀 `apps/api/tsconfig.json`）：`REGULATORY_DATASETS` 與 `docs/` 的代碼與名稱必須逐字一致。改 `regulatory-dataset-code.ts` 沒同步改文件會被擋                                                                                                                                                                     |
| `check:layers`（dependency-cruiser，21 條）     | service／domain 不得 import http、`impl/` 可見範圍、跨大目錄邊界、`index.ts` 不得被 import、`shared/` 不得 import 其他頂層目錄、發證能力限認證模組、envelope 限 handler／routes                                                                                                                                                                  |
| ESLint                                          | 空 catch（§3.3）、業務程式碼 `new Date()`／`Date.now()`（§6.2）                                                                                                                                                                                                                                                                                  |
| TypeScript 型別                                 | `recordAudit` 只收 `TransactionRunner`（傳連線池是編譯錯誤）、金額 branded type、`errors` 僅 `code='300'` 可非空、業務時間欄位用 `TaipeiDateTime`／`IsoDate`（不允許時區字元）、`db.query.*` 關聯查詢——`db/client.ts` 刻意不把 schema 傳給 `drizzle()`，`.query` 的型別是 `DrizzleTypeError`，接下去取表名本身就是編譯錯誤，**不是掃描腳本擋的** |
| 啟動自檢／測試守衛                              | DB session 時區非 `+08:00` 拒絕啟動、測試禁連非測試資料庫                                                                                                                                                                                                                                                                                        |

**沒有工具擋、寫錯不會報錯的（節錄，完整對照見 `references/testing-and-checks.md`）：** 路徑三段形狀、一律 `POST`、`cmd` 與權限碼的機械轉換、`companyId`／`status` 不得出現在 request body、禁止手刻 envelope、檔名推導與 `modules/` 檔名白名單、入口檔只能單行委派、`modules/` 底下禁讀 cookie／header、軟刪除查詢要帶 `deleted_at`、**業務規則不符時要「收集」錯誤回傳 `ServiceResult`，不得 `throw`**（`throw` 只留給真正的意外，§3.1.1）。

另外三件現況要知道：**覆蓋率門檻完全未設定**；**`.github/workflows/` 與 git hook 都不存在**，`bun run ci` 是唯一的手動把關；規範 §8 開頭寫「`.dependency-cruiser.cjs` 目前不存在」是**過期資訊**，該檔存在且完整。

## 檔名推導與模組歸屬：兩個看不出來、錯了也不會報錯的判準

### 檔名推導與 `modules/` 檔名白名單

**分層規則全部靠檔名後綴當比對依據，不是靠人工判斷「這是哪一層」。** 取錯名字（例如
`employments-main.manager.ts`）不會報錯，是所有以 `*.service.ts`／`*.repository.ts` 為目標的
分層規則同時對它失效——這個檔案實質上活在規則管不到的地方；反過來在 `modules/` 以外用那五種
後綴，會讓規則當場誤報，接著被加白名單，白名單就此長大。完整的檔名推導規則與 `modules/` 允許的
檔名清單見 `references/module-layout.md` §2；新增檔案前先核對那份白名單，不要憑感覺照別的專案
習慣命名。

### 模組歸屬：輸出型別決定掛哪個模組

一支查詢橫跨多個實體時（例如同時碰員工、任職、部門歷史三張表），判準是**看輸出型別是誰，就掛
在誰的模組底下**——回的是員工摘要就掛 `employees/`，不因為 JOIN 到了部門就搬去 `departments/`。
這條在既有程式碼裡看不出來：程式碼只看得到「這支函式 import 了哪些 schema」，看不出「決定放在
這裡的判準是什麼」，得靠 skill 講清楚才成立。先例與完整範例見 `references/module-layout.md`
§1.1。

## 什麼時候該去查工具的原始碼，而不是照既有檔案推

大多數規則，讀 `modules/employments/main/` 這類現成模組就能推出正確寫法。但有一類任務不行：
**產出必須逐字符合某個工具下次執行時自己認得的格式**（migration SQL、snapshot 結構、`gen:api`
產生的 client 形狀）。這種時候照著現有檔案的樣子模仿，只能做到「看起來像」——工具不會管你的檔案
長得像不像它自己的輸出，它只看格式對不對；下次真的執行時，會用它自己的規則覆蓋掉你模仿出來的
那份。

判準：這個產出物**會不會被同一支工具在未來某次執行時重新讀取、比對、或覆蓋**？會的話，去讀
**安裝在 `node_modules` 裡那個確切版本**的原始碼，或直接跑一次那個指令看真正的輸出，不要用
「看起來差不多」代替查證。

**真實例子**：`job_titles` 加一個 `sort_order` 欄位，想確認 migration 輸出的 `ALTER TABLE`
長什麼樣。這個專案釘死 `drizzle-kit@0.31.10`，其單檔打包的 CLI
（`node_modules/.bun/drizzle-kit@0.31.10/node_modules/drizzle-kit/bin.cjs`）裡 MySQL 方言的
`ADD COLUMN` 轉換器寫死輸出格式：

```js
// bin.cjs（MySqlAlterTableAddColumnConvertor.convert，節錄）
return `ALTER TABLE \`${tableName}\` ADD \`${name}\` ${type}${primaryKeyStatement}${autoincrementStatement}${defaultStatement}${generatedStatement}${notNullStatement}${onUpdateStatement};`
```

兩個從「照抄現有檔案」猜不出來的細節：**關鍵字是 `ADD`，不是 `ADD COLUMN`**（Postgres 方言才是
`ADD COLUMN`，兩個方言各自是獨立的轉換器函式）；子句順序固定是型別 → 主鍵 → 自動遞增 →
`DEFAULT` → `GENERATED` → `NOT NULL` → `ON UPDATE`。這件事只能讀原始碼查，因為這個 repo 目前
**沒有任何一支既有 migration 加過欄位**（`apps/api/drizzle/*.sql` 只有 `CREATE TABLE` 與
`ADD CONSTRAINT`）——沒有現成檔案可以模仿。

**snapshot 也是同一類。** `NNNN_snapshot.json` 的 `id`／`prevId` 是 drizzle-kit 自己算的 UUID
鏈，手寫猜不出正確值（見 `references/database.md` §1）。加完欄位、跑完 `db:generate` 之後，
與其憑肉眼看過一遍就假設沒問題，寫一段腳本把新 snapshot 裡「這次沒有改動的表」逐一與前一份
snapshot 做結構化比對（不是整檔案 diff——`id`／`prevId` 一定不同，鍵序也可能因重新序列化而變）；
本專案目前 24 張表，改一張表的欄位，就該有其餘 23 張在這次比對裡完全等價。程式化驗證比「看起來
沒少表」可靠，因為漏看一張表不會有任何提示。

## 引用依據前，要先真的查過

寫 PR 描述或跟人解釋「為什麼這樣做」時，常常會想引用專案裡某個檔案檔頭的說法當依據——這是好
習慣，但**前提是真的打開那個檔案確認那句話存在**。編一個聽起來合理、但查無此言的依據，比誠實
說「我不確定」危險得多：後者會讓下一個人知道這裡需要人工複查，前者會讓下一個人以為這件事已經
查證過，直接引用下去，錯誤就這樣鍍上一層「查過了」的保護色繼續往下傳。

沒時間查證時，寧可寫「這是我的推測，沒有實際核對來源」，也不要生造一個檔頭引言或章節編號。

## 先決定你在做什麼

| 你的任務                               | 先讀                               | 對應規範   |
| -------------------------------------- | ---------------------------------- | ---------- |
| 新增模組／新增檔案／不知道檔案該放哪   | `references/module-layout.md`      | §0         |
| 新增或修改端點、路由、handler、schema  | `references/api-design.md`         | §1、§2     |
| 業務錯誤、例外、錯誤訊息、i18n 訊息    | `references/errors.md`             | §3         |
| 資料表、migration、查詢、交易          | `references/database.md`           | §4         |
| 權限、稽核、認證、敏感欄位             | `references/security.md`           | §5         |
| 任何碰到「現在」「日期」「排程」的東西 | `references/time.md`               | §6         |
| 寫測試、跑檢查、被 CI 擋下來           | `references/testing-and-checks.md` | §7、§8、§9 |

多數任務會跨兩三章。**新增一支端點幾乎一定要讀 module-layout、api-design、database 三份**，並在收尾時翻 testing-and-checks 的交件清單。

## 開工前：先確認缺口真的存在

**動手寫之前，先搜尋這個動作是不是已經做過了。** 這個專案的模組數量已經不少，而檔名是機械推導的——`employments-main.leave.service.ts` 就是「辦理離職」，`impl/` 底下一列檔名就是這個次實體現有的全部動作。花一分鐘 grep，好過刻一份重複的實作。

這件事在稽核上特別容易出事：若某個動作已經在自己的交易裡呼叫過 `recordAudit`，你在外層編排點「補一筆稽核」的結果是**同一項異動被記兩遍**——而兩筆都合法、都不會報錯。橫跨多張表時的正確形狀是每一步各自記一筆、編排點不再另記（§5.3）。

先看三個地方：目標次目錄的 `impl/` 檔名清單、該模組 `index.ts` 匯出了哪些動作、以及 `__tests__/` 裡有沒有已經在測這件事。

## 新增一支端點：由下往上，六步

順序是 `schema → repository → service → errors → handler → routes`（§0.5）。**由上往下寫會臆測下層介面，等下層寫出來形狀對不上就得回頭改，那次回頭是純白工。**

每一步的完整規則在對應的參考檔裡，這裡只列最容易走錯的點，並標明有沒有工具在擋。

### 1. schema（`db/schema/`）

改完表定義用 `bun run db:generate` 產 migration，不要手寫 SQL。**這支指令需要 `.env`**——`drizzle.config.ts` 在載入階段就要求連線參數必填，即使 generate 本身不連資料庫，沒設就會卡在一個看起來與任務無關的錯誤。

真的要手寫 SQL 內容（schema 沒變，例如純 `INSERT` 的權限碼 seed）用 `bun run db:generate -- --custom` 產生空白 migration 骨架，不要自己動 `_journal.json` 或 snapshot——手寫 snapshot 猜不出 `id`／`prevId` 鏈，猜錯了掃描器不會抓到，細節見 `references/database.md` §1。

兩個容易誤判的點：已有資料的表加 `NOT NULL` **又沒有 default** 才是地雷組合（nullable 與帶 default 是兩種各自安全的策略，不是二選一）；還有——**表加了欄位，API 契約不會自動變**，前端要看得到還得動 repository 的 select、domain 型別、handler 映射與 routes 的 response schema（§1.8.0 禁止把 repository 回傳值直接丟給 `data`）。

### 2. repository（`impl/<大目錄>-<次目錄>.<動作>.repository.ts`）

- **一律顯式 `select` ＋ `join`，禁止 `db.query.*` 搭配 `with`**（§4.6）。這由型別擋，不是「自己守」——`db/client.ts` 沒把 schema 傳給 `drizzle()`，`.query` 的型別是 `DrizzleTypeError`，接下去取表名是編譯錯誤。
- **公司範圍一律用 `TenantDatabase`／`scopeAll` 封裝取得，不拿裸連線自己組 `WHERE`**（§4.2），公司範圍只能來自已驗證身分，不來自 request body。這是本系統最嚴重的單點風險，寫法照抄 `references/database.md` §2 或任一既有模組。
- 軟刪除表的查詢要處理 `deleted_at`（§4.3）。⚠️ 無工具。
- **不要在迴圈裡 await 查詢**，包含 `Promise.all(arr.map(async ...))` 這種偽裝成平行的寫法——它一樣是 N 次往返、N 個連線池 slot（§4.5，`check:n-plus-one` 會擋）。

### 3. service（`impl/<大目錄>-<次目錄>.<動作>.service.ts`）

- **業務規則不符時「收集」錯誤後回傳 `ServiceResult`，不要 `throw`**（§3.1.1）。`throw` 只留給真正的意外，寫法照抄 `modules/roles/main/impl/roles-main.create.service.ts`。⚠️ 無工具。
- **service 與 domain 不得 import http 層**，不得碰 envelope、HTTP status 或 `cmd`（§1.0.1、§3.1.1）。錯誤分組用具名常數（`Conflict`／`Unprocessable`／`Forbidden`），不寫 HTTP 數字——那是入口的事，不是業務層的事。（`check:layers` 會擋。）
- **「現在」必須由呼叫端注入**，業務程式碼禁止 `new Date()`／`Date.now()`（§6.2，ESLint 會擋）。
- 寫入多張表時交易邊界屬於 service 層；**稽核必須與業務寫入用同一個交易 handle**——`recordAudit` 收 `TransactionRunner`，傳連線池是編譯錯誤，但**傳「另一個」交易編譯得過**，那一半由 `check:audit-transaction` 擋（§5.3，範例見 `references/security.md` §3）。

### 4. errors（`<大目錄>-<次目錄>.errors.ts`）

錯誤字典不拆檔，因為「哪些錯誤必須刻意含糊」要能一起看（§0.4、§3.2）。**跨公司存取的回應必須與「目標不存在」逐項相同**；**登入失敗的四種原因回應必須逐項相同**（§3.2）——這兩條由測試在擋，寫新端點時要記得補對應測試。

### 5. handler（`<大目錄>-<次目錄>.handler.ts`）

只做四件事：取出驗證後的 body → 呼叫 service → 把結果收成這支端點的 `data` 形狀 → 回傳（§1.8.0）。

- **不要手刻 envelope。** handler 與 routes 兩種檔案都不該出現含 `code:`／`rspTS:`／`expiresIn:`／`exp:` 的物件字面值（§1.8.1）。⚠️ 無工具——而手刻的 envelope 漏欄位或把 `rspTS` 拼成 `rspTs` **不會有編譯錯誤**，型別檢查照樣過，最後表現成前端的零星 bug。
- **不要把 repository 或 service 的回傳值直接指派給 `data`**，也不要把驗證後的 request 型別直接丟進 domain（§1.8.0、§2）。共用型別的代價是資料表加一個欄位就自動出現在 API 上，而且沒有一行程式碼會改變。
- **`modules/**` 底下不得讀 cookie／header／`Authorization`**，身分只能從 context 取已驗證的那份（§1.5、§1.9.1）。⚠️ 無工具。

### 6. routes（`<大目錄>-<次目錄>.routes.ts`）

以下六條**全部沒有工具在擋**，是最需要照著抄現成端點的一步。抄 `modules/shifts/main/shifts-main.routes.ts` 的形狀最省事。

- **路徑一律三段 `/<大目錄>/<次目錄>/<動作>`**，前兩段必須對應真實存在的模組目錄，全部 kebab-case，不帶路徑參數或 query（§1.1）。
- **一律 `POST`**，不註冊 `.get(`／`.put(`／`.patch(`／`.delete(`（§1.2）。`/health` 這類基礎設施端點不在此規範適用範圍內，且必須集中在單一檔案並附註解。
- **`cmd` 必須等於路徑的機械轉換**：去掉開頭 `/`、其餘 `/` 換成 `.`，不做單複數或 camelCase 轉換（§1.3）。同一套轉換也推導權限碼（§5.2），所以兩者字面值相同。
- **request body 不得含 `companyId`，也不得含 `status`**（§1.1、§1.2）。狀態變更走自己的動作端點，不靠可寫的狀態欄位。
- 每支端點都要宣告 `body`／`response` schema ＋ `errors[].code` 清單（§2、§1.8.3）。
- 每支端點都要能回溯到一個入口群組與一個認證群組；公開端點要落在明確命名的公開群組（§1.9）。

最後把新端點接到出口：模組的 `routes.ts` re-export 它，路由組裝點掛上去。**`index.ts` 只 export service 與 errors，永遠不 export routes**——否則任何模組 import 別人的 service 都會把 HTTP 框架一起拖過大目錄邊界（§0.3）。

## 幾條特別貴的紅線

錯了不只是被擋，是會出事或會安靜地壞掉：

- **公司範圍來自客戶端** —— 任何人改一個字串就能讀別家公司的薪資（§4.2）。`companyCode` 是唯一例外，只能出現在登入端點，且它不是公司範圍。
- **稽核與業務寫入不同交易** —— 產生「業務失敗、稽核卻成功」的幽靈紀錄，比完全沒有稽核更危險。
- **檔名不照規則取**（例如 `xxx.manager.ts`）—— 所有分層規則都以檔名後綴為索引鍵，取錯名字會讓**一整組規則同時對它失效，而且不會有任何東西報錯**（§0.2）。反過來在 `modules/` 以外用那五種後綴，會讓規則當場誤報，接著被加白名單，然後白名單長大（§0.6.1）。
- **模組層副作用** —— 讀 `process.env`、建連線、`setInterval` 寫在 import 就會執行到的位置，會讓 `bun run gen:api` 在沒有 DB、沒有環境變數的機器上失敗，而它看起來像環境問題（§0.6.2）。唯一白名單是 `apps/api/src/index.ts`。

## 交件前

跑 `bun run ci`：串起 lint、型別檢查、契約產生、依賴檢查、九支規範掃描與測試。個別指令與各自在擋什麼見 `references/testing-and-checks.md`。

**動到任何端點的回應形狀（含只是加一個欄位）時，一定要跑 `bun run gen:api && bun run typecheck:web` 驗一次消費端，`bun run typecheck` 看不到這件事。** 後端的型別檢查只看 `apps/api`，前端是透過產生出來的契約消費它的——耦合只在產生物那一層顯形。

實例：把 `companyUserId` 只加進 `employees.main.get` 的回應，`bun run typecheck` 全綠；但前端的 `employees-detail.view.ts` 寫的是 `EmployeeSummary = NonNullable<EmployeesMainGetData>`，而 `EmployeeBasicInfoTab.vue` 會把 **`update` 的回應** `Object.assign` 回同一份狀態——也就是前端把 `get` 與 `update` 當成同一個型別在用。只加在 `get` 的話，`update` 覆蓋回去的那一刻那個欄位就消失了。這個耦合**讀後端程式碼完全看不出來**，是跑 `typecheck:web` 才炸出來的。

沒有自動檢查的那些（上面標 ⚠️ 的、建立順序、錯誤訊息含糊度、交易邊界、稽核完整性、測試有沒有繞過正式流程）**必須在 PR 描述逐項自述**（§8）。

## 遇到規範沒寫到的情況

先確認是不是 §9「尚待拍板」裡的項目——那六項是刻意未定案的（軟刪除唯一鍵、稽核表定義、帳號鎖定政策、CSRF、token 壽命、refresh token 的登入識別欄位），不要自己決定，先問。

其餘情況照這份規範一貫的判準推：這個做法會不會讓某條檢查靜默失效？會不會讓兩份規則開始各自演化而沒有東西會變紅？會不會把一個沒有標準答案的判斷留在每次 review 重問一次？三個都不會，通常就可以做，並把理由寫進 PR。
