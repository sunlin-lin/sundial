# 模組目錄結構與分層

本章管的是「新檔案該放在哪裡、該叫什麼名字」，對應 `docs/dev-standards-backend.md` §0（全文）。
`modules/` 底下一律縱切（依功能領域），檔名由目錄路徑機械推導，`service` 與 `repository` 強制拆成入口
＋ `impl/` 兩層，`modules/` 以外另有五個頂層目錄各管一種東西。所有規則背後的理由是：**分層規則全部
靠檔名後綴當 glob 命中對象**，放錯位置或叫錯名字，規則不是報錯，是靜靜地不再檢查任何東西。寫程式碼
前直接照本章的檔案樹與命名規則走，需要回查「為什麼」時才點開對應章節。

## 目錄

1. [標準檔案樹](#1-標準檔案樹)
2. [檔名推導規則](#2-檔名推導規則)
3. [兩個出口：index.ts 與 routes.ts](#3-兩個出口indexts-與-routests)
4. [實作切片：入口檔委派與 impl/ 的可見範圍](#4-實作切片入口檔委派與-impl-的可見範圍)
5. [新增端點的建立順序](#5-新增端點的建立順序)
6. [modules/ 以外的五個頂層目錄](#6-modules-以外的五個頂層目錄)
7. [新增模組檢查清單](#7-新增模組檢查清單)

---

## 1. 標準檔案樹

新增一個次實體時，照抄下面這棵樹，把 `<大目錄>` `<次目錄>` 換成實際名稱：

```text
apps/api/src/modules/<大目錄>/
├─ <次目錄>/
│  ├─ <大目錄>-<次目錄>.routes.ts        端點目錄（不拆，§0.4）
│  ├─ <大目錄>-<次目錄>.handler.ts       每個函式：驗證後 body → 呼叫 service → 收成 data（不拆）
│  ├─ <大目錄>-<次目錄>.service.ts       入口：每個動作一個函式，一行委派給 impl/（強制拆）
│  ├─ <大目錄>-<次目錄>.repository.ts    入口：每個動作一個函式，一行委派給 impl/（強制拆）
│  ├─ impl/
│  │  ├─ <大目錄>-<次目錄>.<動作>.service.ts
│  │  └─ <大目錄>-<次目錄>.<動作>.repository.ts
│  ├─ <大目錄>-<次目錄>.errors.ts        錯誤字典（不拆）
│  ├─ domain/                          零 IO 純函式，依主題自行分檔
│  └─ __tests__/
├─ shared/                              兩個以上次目錄真的共用時才建，不得預建
├─ index.ts                             對其他模組的唯一出口：只 export service 與 errors
└─ routes.ts                            對路由組裝點的唯一出口：只 export routes
```

真實範例（`apps/api/src/modules/employments/`，四個次目錄：`main`、`department-histories`、
`job-title-histories`、`job-position-histories`）：

```text
modules/employments/
├─ main/
│  ├─ employments-main.routes.ts
│  ├─ employments-main.handler.ts
│  ├─ employments-main.service.ts
│  ├─ employments-main.repository.ts
│  ├─ employments-main.errors.ts
│  ├─ impl/
│  │  ├─ employments-main.create.service.ts
│  │  ├─ employments-main.get.service.ts
│  │  ├─ employments-main.list.service.ts
│  │  ├─ employments-main.leave.service.ts
│  │  ├─ employments-main.find.repository.ts
│  │  ├─ employments-main.find-employee-for-update.repository.ts
│  │  ├─ employments-main.insert.repository.ts
│  │  ├─ employments-main.list.repository.ts
│  │  ├─ employments-main.list-periods.repository.ts
│  │  └─ employments-main.update-leave.repository.ts
│  ├─ domain/
│  │  ├─ employment-context.ts
│  │  ├─ employment-duplicate.ts
│  │  ├─ employment-list-view.ts
│  │  └─ employment-model.ts
│  └─ __tests__/
│     ├─ employments-main.audit.test.ts
│     ├─ employments-main.concurrency.test.ts
│     └─ employments-main.endpoints.test.ts
├─ department-histories/   （同形狀）
├─ job-title-histories/    （同形狀）
├─ job-position-histories/ （同形狀）
├─ index.ts
└─ routes.ts
```

**次目錄名 = 該子實體的名稱；當它與大目錄同名時一律叫 `main`。** `employments/main` 就是任職主檔
本身；`department-histories`／`job-title-histories`／`job-position-histories` 各自有自己的名字，
不需要再生一個 `main`（理由見 §0.2：不強迫「每個大目錄都要有 main」）。

### 1.1 查詢橫跨多個實體時，這支端點該掛在哪個大目錄

上面的檔案樹假設「這支端點屬於哪個次實體」已經是已知的；但一個查詢常常會為了組出完整的欄位，
碰到好幾張表（例如「依部門查在職員工清單」同時碰 `employees`、`employee_employments`、
`employee_department_histories`）。**判準不是「碰了哪些表」，而是「輸出型別是誰，就掛在誰的
模組底下」。**

真實先例：`employees-main.list.repository.ts` 的 `listEmployeePage` 回傳的是一頁
`EmployeeListItem`，但為了填出 `jobTitleName`（目前有效職稱），內部另外批次查了
`employee_employments`、`employee_job_title_histories`、`job_titles` 三張表（見同檔
`listCurrentJobTitleNames`），依然整支放在 `modules/employees/main/`，不是
`modules/job-titles/`。查了幾張表是查詢的實作細節；呼叫端要的是「一頁員工」，這支端點就是
員工模組的東西。同理，「依部門查在職員工清單」回傳的是員工，即使查詢要 join 部門與任職歷史，
也該放在 `modules/employees/`，不是 `modules/departments/`。

---

## 2. 檔名推導規則

**檔名 = 所在目錄路徑推導出來的字串，不是自由命名。**

- 一般層：`<大目錄>-<次目錄>.<層>.ts`，`<層>` ∈ `{routes, handler, service, repository, errors}`。
- `impl/` 底下多一段動作：`<大目錄>-<次目錄>.<動作>.{service,repository}.ts`；`<大目錄>-<次目錄>`
  這段一樣要等於所在次目錄的路徑（`impl/` 這一層不計入推導）。
- `modules/` 底下的檔名白名單（超出這份清單一律失敗）：
  `index.ts`、`routes.ts`（大目錄層，與次目錄同層）、`shared/**`、
  `<大目錄>-<次目錄>.{routes,handler,service,repository,errors}.ts`、
  `impl/<大目錄>-<次目錄>.<動作>.{service,repository}.ts`、`domain/**`、`__tests__/**`。
  `impl/` 底下只允許 `service` 與 `repository` 兩種後綴，不得出現 `routes`／`handler`／`errors`
  的切片。

```ts
// ✅ 正確：modules/employments/main/employments-main.service.ts
// ✅ 正確：modules/employments/main/impl/employments-main.create.service.ts
// ✅ 正確：modules/job-positions/main/job-positions-main.repository.ts

// ❌ 錯誤：modules/employments/main/employment.service.ts
//    前綴用了單數子實體名，不是「<大目錄>-<次目錄>」——搜尋 employments-main 會漏掉這支檔案

// ❌ 錯誤：modules/employments/employments-main.service.ts
//    檔案沒有放進 main/ 次目錄，路徑與檔名對不起來

// ❌ 錯誤：modules/employments/main/impl/create.service.ts
//    impl/ 底下漏了前綴段，掃描器用路徑推導期望檔名時會直接判定為非法檔名

// ❌ 錯誤：modules/employments/main/employments-main.manager.ts
//    「manager」不是五種合法層後綴之一——不會報錯，但所有以 *.service.ts／*.repository.ts
//    為對象的分層規則都不會命中它，等於在合法目錄裡藏了一個沒有規則管的檔案
```

理由：檔名全域唯一，堆疊追蹤、log、編輯器搜尋才能直接定位到唯一一個檔案；搬檔案忘了改名、或改名
忘了搬目錄，當場被掃描器擋下（詳見 §0.2）。

---

## 3. 兩個出口：`index.ts` 與 `routes.ts`

一個大目錄對外**只有**兩個出口，兩者形狀相同（只允許 `export ... from`），用途互斥：

| 出口        | 給誰用                           | 只能 export 什麼              |
| ----------- | -------------------------------- | ----------------------------- |
| `index.ts`  | 其他模組（跨大目錄 import）      | `*.service.ts`、`*.errors.ts` |
| `routes.ts` | 唯一的路由組裝點 `app/routes.ts` | `*.routes.ts`                 |

真實範例（`apps/api/src/modules/employments/index.ts`，只 re-export，零宣告）：

```ts
export * from './main/employments-main.service.ts'
export * from './main/employments-main.errors.ts'
export * from './department-histories/employments-department-histories.service.ts'
export * from './department-histories/employments-department-histories.errors.ts'
export * from './job-title-histories/employments-job-title-histories.service.ts'
export * from './job-title-histories/employments-job-title-histories.errors.ts'
export * from './job-position-histories/employments-job-position-histories.service.ts'
export * from './job-position-histories/employments-job-position-histories.errors.ts'
```

`apps/api/src/modules/employments/routes.ts`（一樣只 re-export，來源檔名後綴必須是 `.routes.ts`）：

```ts
export { employmentsMainRoutes } from './main/employments-main.routes.ts'
export { employmentsDepartmentHistoriesRoutes } from './department-histories/employments-department-histories.routes.ts'
export { employmentsJobTitleHistoriesRoutes } from './job-title-histories/employments-job-title-histories.routes.ts'
export { employmentsJobPositionHistoriesRoutes } from './job-position-histories/employments-job-position-histories.routes.ts'
```

```ts
// ✅ 正確：index.ts 只 export service 與 errors
export * from './main/employments-main.service.ts'

// ❌ 錯誤：index.ts 裡出現宣告或 export repository／routes
export const helper = () => {} // index.ts 不得有任何函式本體
export * from './main/employments-main.repository.ts' // 會把裸 db client 帶過模組邊界
export * from './main/employments-main.routes.ts' // 會把 HTTP 框架帶過模組邊界
```

- **跨大目錄只能透過對方的 `index.ts`**，不得 import 到對方任何內部檔案。
- **同一大目錄內的次目錄之間可以互相 import**，但 `*.repository.ts` 不得被本次目錄以外的任何檔案
  import——跨次目錄要資料一律走對方的 service（repository 不含業務規則，繞過去等於整組規則被繞掉）。
- **只有 `app/routes.ts`（唯一的路由組裝點）能 import `modules/<大目錄>/routes.ts`**；`modules/**`
  底下任何檔案都不行。少了這條，`routes.ts` 就退化成「另一個 index」。
- 入口群組與認證群組（見 §1.9）不在這兩個出口裡，那是路由組裝點的責任；模組只透過 `routes.ts`
  提供端點，不建立群組、不宣告驗證方式。

理由見 §0.3；上述限制在 `.dependency-cruiser.cjs` 落成 `cross-module-only-via-index`、
`repository-only-same-submodule`、`module-routes-only-from-route-assembly-point` 三條規則。

---

## 4. 實作切片：入口檔委派與 `impl/` 的可見範圍

**只有 `service` 與 `repository` 強制拆；`routes`／`handler`／`errors` 一律不拆，沒有行數門檻。**
判準是「哪一層」，不是「這個檔案幾行」——業務規則與查詢是唯二會無限成長的層，其餘三層在結構上不會長大。

### 4.1 入口檔只做委派

`*.service.ts`／`*.repository.ts` 的每個匯出函式只有一行：把參數交給 `impl/` 對應的實作函式。

真實範例（`employments-main.repository.ts`，入口檔全文只有委派）：

```ts
import { findEmployeeForUpdate as findEmployeeForUpdateImpl } from './impl/employments-main.find-employee-for-update.repository.ts'
// ……

export const findEmployeeForUpdate = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => findEmployeeForUpdateImpl(runner, companyId, employeeId)
```

```ts
// ✅ 正確：入口檔的函式本體只有一個 return／委派呼叫
export const getEmployment = (
  context: EmploymentsMainContext,
  input: EmploymentTargetInput,
): Promise<ServiceResult<EmploymentDetail | null>> => getEmploymentImpl(context, input)

// ❌ 錯誤：入口檔裡出現條件判斷或多段敘述——這段邏輯必須搬進 impl/
export const getEmployment = async (context, input) => {
  if (!input.id) return fail([employmentNotFound()]) // 條件判斷，掃描器判定為實作外洩
  const detail = await findEmploymentDetail(context.db, context.companyId, input.id)
  return succeed(detail)
}
```

一個入口函式可以有多個委派變體（例如自己開交易 vs. 收外部交易 handle），只要每個變體各自仍是
單一委派呼叫即可，`employments-main.service.ts` 的 `createEmployment`／`createEmploymentInTransaction`
就是這種形狀：

```ts
/** 新增任職。自己開交易，給單一端點用。 */
export const createEmployment = (
  context: EmploymentsMainContext,
  input: CreateEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> =>
  context.db.transaction((tx) => createEmploymentInTransactionImpl(tx, context, input))

/** 新增任職。收外部交易 handle，給編排點用。 */
export const createEmploymentInTransaction = (
  tx: TransactionRunner,
  context: EmploymentsMainContext,
  input: CreateEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => createEmploymentInTransactionImpl(tx, context, input)
```

### 4.2 `impl/` 只能被同一個次目錄的入口檔 import

**合法呼叫者只有一種：直接位於次目錄底下、檔名為 `<大目錄>-<次目錄>.{service,repository}.ts` 的
入口檔本身。** handler 不行、其他次目錄不行、其他大目錄不行、`shared/` 不行、測試也不行（測試打
入口，不打 `impl/`）。這條在 `.dependency-cruiser.cjs` 是 `impl-not-from-other-submodule` 與
`impl-only-from-own-entry-file` 兩條規則。

```ts
// ✅ 正確：employments-main.service.ts（入口檔）import 自己的 impl/
import { getEmployment as getEmploymentImpl } from './impl/employments-main.get.service.ts'

// ❌ 錯誤：handler 直接繞過入口，import impl/
// modules/employments/main/employments-main.handler.ts
import { getEmployment as getEmploymentImpl } from './impl/employments-main.get.service.ts'

// ❌ 錯誤：另一個次目錄伸手進來拿 impl/
// modules/employments/department-histories/impl/xxx.service.ts
import { findEmployeeForUpdate } from '../../main/impl/employments-main.find-employee-for-update.repository.ts'
```

**實作切片之間不得互相 import**（`impl-slices-cannot-import-each-other`）。需要共用時只有兩條路：
升格成入口上的一個動作切片讓上層組合，或（若不碰 IO）抽成 `domain/` 的純函式。

**第三條路，僅在前兩條都不成立時才用：刻意複製一份，並在程式碼註解寫明理由。** 升格的前提是
「有次目錄以外的呼叫者」（§4.3）；抽成 `domain/` 的前提是「零 IO」。兩支 repository 切片各自
需要一份排序欄位對照表就常常兩者都不成立——沒有外部呼叫者，升格不成立；對照表回傳的是 Drizzle
欄位物件，摸得到 schema，不是零 IO 純函式。判準看兩點，**兩者都成立才複製**：

- **會不會各自演化**：兩份對照表是各自服務不同查詢（欄位集合、預設排序本來就不保證長期一致），
  還是同一份東西被迫拆成兩處——前者複製，後者代表其實該共用。
- **複製的是不是一小段沒有業務規則的對照表**：純粹是「欄位名字串 → Drizzle 欄位」的 `switch`，
  不含判斷或計算。一旦裡面摻了業務規則（例如某個排序值要連帶查另一張表才能決定欄位），就不再是
  「一小段」，複製等於把規則分裂成兩份，改一處會漏一處，要走升格或 `domain/`。

```ts
// ✅ 正確：兩支切片各自的排序對照表外觀相似，但服務不同查詢、注定各自增減欄位——
// 複製比硬拗出一個共用函式更誠實，只要註明為什麼不共用
// modules/employments/job-title-histories/impl/employments-job-title-histories.list.repository.ts
const sortColumn = (field: string) => {
  /* 本切片專用排序欄位，見檔頭理由 */
}

// ❌ 錯誤：兩處的 switch 逐行相同、欄位集合也相同，只是分別複製貼上——
// 這裡沒有「會分岔」的理由，該共用卻複製，之後改一處會漏一處
```

### 4.3 拆的單位：「動作」在兩層不是同一組東西

- **`service` 的動作＝業務動作**，多數與端點一對一，但不是必然——`createEmploymentInTransaction`
  沒有對應的端點，是給 `employees/onboarding` 編排點用的。判準是「有沒有次目錄以外的呼叫者」：
  有就放入口，只有自己的切片在用就是實作細節，留在 `impl/` 或抽成 `domain/`。
- **`repository` 的動作＝資料存取動作，不是端點動作。** 例如「依名稱查詢是否已存在」本身就是一個
  repository 動作，多個 service 動作各自呼叫它即可，不需要複製也不需要切片互相依賴。

---

## 5. 新增端點的建立順序

**`schema` → `repository` → `service` → `errors` → `handler` → `routes`**，由下往上。

先寫上層會需要臆測下層介面（handler 先假設 service 回什麼），等下層真的寫出來、形狀對不上，就要
回頭改上層，那次回頭是純粹白做的工。`errors` 排在 service 之後、handler 之前，是因為要宣告哪些
錯誤碼，得先知道 service 實際會收集到哪幾種業務拒絕；handler 與 routes 要宣告的錯誤碼清單正是從
這裡來的（理由見 §0.5）。

---

## 6. `modules/` 以外的五個頂層目錄

`apps/api/src/` 底下除了 `modules/`，還有 `index.ts` 與五個頂層目錄。**這些目錄不套用 §0.2 的兩層
目錄、檔名推導與白名單**——那套規則只對 `modules/` 成立。這裡一律 kebab-case、名字直接寫責任
（`identity-guard.ts`、`field-encryption.ts`），**不得出現 `.routes`／`.handler`／`.service`／
`.repository`／`.errors` 五種後綴**，因為那五個後綴是分層規則的索引鍵，掛在 `modules/` 以外會讓
規則誤判一個它從未設計來管的檔案。

| 目錄         | 責任                                                                  | 進來的判準                                                             | 現況內容                                                                                                                                             |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`   | 服務進入點：讀設定→建連線→自檢→`listen`→起排程器→註冊關機             | **唯一允許副作用的檔案**                                               | `apps/api/src/index.ts`                                                                                                                              |
| `app/`       | 應用程式組裝：中介層順序、唯一路由組裝點、把模組 service 接到 port 上 | 只接線，零判斷、零副作用，外部資源全部由參數注入                       | `app-dependencies.ts`、`app.ts`、`routes.ts`、`session-access-control.ts`、`contract-dependencies.ts`、`endpoint-inventory.ts`                       |
| `http/`      | HTTP 邊界層：憑證驗證器、出口層、error handler、狀態碼映射            | 對每一支端點都一樣，可掛在整個 app 上                                  | `identity-guard.ts`、`public-guard.ts`、`refresh-guard.ts`、`error-boundary.ts`、`error-handler.ts`、`response-envelope.ts`、`request-context.ts` 等 |
| `db/`        | 表定義、連線、驅動錯誤判讀、欄位加解密、時區自檢                      | 知識會隨資料庫／驅動變動，或描述欄位的儲存形狀                         | `client.ts`、`field-encryption.ts`、`field-masking.ts`、`time-zone-guard.ts`、`schema/*.ts`                                                          |
| `shared/`    | 跨層共用型別、常數、純函式                                            | 兩個以上真實 import 者 ∧ 沒有生命週期 ∧ 不知道自己被誰用（三條全成立） | `clock.ts`、`config.ts`、`logger.ts`、`envelope.ts`、`field-schemas.ts`、`service-result.ts`、`access-control.ts` 等                                 |
| `scheduler/` | 背景執行單元                                                          | 由時間觸發 ∧ 有生命週期（start／stop）∧ 一個程序只准一份               | `regulatory-sync-scheduler.ts`                                                                                                                       |

判準不是感覺，是能不能寫出「破壞了哪一條規則」。`shared/` 三個條件缺一都要挪走：有生命週期 →
`scheduler/`；只有一個使用者 → 留在用它的模組內 `domain/`；需要知道表／驅動／儲存形狀 → `db/`；
需要知道 HTTP／Elysia context／status → `http/`。

依賴方向（每一列都是一條 dependency-cruiser 規則）：

| 從           | 可以 import                                                     | 補集（禁止）                              |
| ------------ | --------------------------------------------------------------- | ----------------------------------------- |
| `shared/`    | `shared/`、外部套件                                             | 其餘所有頂層目錄                          |
| `db/`        | `db/`、`shared/`                                                | `http/`、`modules/`、`scheduler/`、`app/` |
| `http/`      | `http/`、`shared/`                                              | `db/`、`modules/`、`scheduler/`、`app/`   |
| `modules/`   | `shared/`、`db/`、`http/`、其他大目錄的 `index.ts`              | `scheduler/`、`app/`（測試除外）          |
| `scheduler/` | `shared/`、`modules/<大目錄>/index.ts`                          | `db/`、`http/`、`app/`                    |
| `app/`       | `shared/`、`db/`、`http/`、`modules/<大目錄>/{index,routes}.ts` | `scheduler/`                              |
| `index.ts`   | 全部                                                            | —                                         |
| 任何檔案     | —                                                               | `index.ts`（不得被 import）               |

`modules/**/__tests__/**` 例外可以 import `app/**` 與 `http/**`（端點測試要組出認證群組才打得到
端點），非測試檔一律不行。

**新增第六個頂層目錄前，必須逐一列出「被每個既有落點拒收的理由」**，全部答「不行」且每個「不行」
都指得出破壞哪一條規則，才正當。同一個 PR 必須補齊三件事：`§0.6.1` 表加一列、`§0.6.6` 依賴方向表
加一列並落成 dependency-cruiser 規則、該目錄下每個檔案的檔頭寫出「為什麼不在既有某一層」。理由見
§0.6.7，`scheduler/` 是目前唯一的先例。

---

## 7. 新增模組檢查清單

新增一個大目錄或次目錄時，逐項確認：

- [ ] 一律兩層目錄：`modules/<大目錄>/<次目錄>/`，即使只有一個子實體也要有次目錄
- [ ] 次目錄名等於子實體名；與大目錄同名時命名為 `main`
- [ ] 每個檔名都是 `<大目錄>-<次目錄>.<層>.ts`，`<大目錄>-<次目錄>` 這段等於所在目錄路徑
- [ ] `impl/` 底下的檔名多一段動作：`<大目錄>-<次目錄>.<動作>.{service,repository}.ts`，只用
      `service`／`repository` 兩種後綴
- [ ] `service`／`repository` 一律拆成入口＋`impl/`；`routes`／`handler`／`errors` 一律不拆
- [ ] 入口檔每個匯出函式只有一行委派，沒有條件判斷、迴圈或裸資料庫呼叫
- [ ] `impl/` 底下的檔案只被同一次目錄的入口檔 import；沒有任何實作切片互相 import
- [ ] `errors.ts` 不 import 任何 http／elysia 模組
- [ ] `domain/` 只放零 IO 純函式
- [ ] 大目錄的 `index.ts` 只 re-export 各次目錄的 `*.service.ts` 與 `*.errors.ts`
- [ ] 大目錄的 `routes.ts` 只 re-export 各次目錄的 `*.routes.ts`
- [ ] 新增端點依 `schema → repository → service → errors → handler → routes` 順序撰寫
- [ ] `app/routes.ts` 加上對應的 `.use(xxxRoutes(...))`，掛在正確的認證群組
- [ ] 若需要橫跨模組的共用邏輯，先確認是不是真的有兩個以上使用者，不預建 `shared/`
- [ ] 執行 `bun run check:layers` 確認沒有觸發 dependency-cruiser 規則
