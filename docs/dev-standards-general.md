# 通用工程規範

> 適用範圍：`sundial` monorepo 全部程式碼（Vue 3 前端、Elysia + Drizzle 後端、共用套件、腳本）。
> 本文件規定**怎麼開發、程式碼怎麼寫**，不是架構設計文件；資料模型與畫面規格請看 `docs/schema/`、`docs/ui/`。
> 標記：✅ = 有自動檢查擋著，違反會讓 hook 或 CI 失敗；⚠️ = 無法自動化，靠 PR review 把關。

## 0. 本文件的核心前提

- **每一條規範都必須寫出「違反會發生什麼壞事」；寫不出後果的條文不要寫進來。**
  理由：沒有後果的條文無法排序、無法在爭論時裁決。規則擋住 PR 時作者一定會問「為什麼」，文件必須當場答得出來，否則規則會被繞過。
- **規範以「文件 + 可執行檢查」雙軌落地，不接受只靠自律的條文。**
  理由：靠自律的規則遵守率隨時間趨近於零——趕工時第一個被犧牲。詳見第 7 章元規則。

---

## 1. 命名規範（跨前後端）

### 1.1 檔案與目錄

| 對象 | 慣例 | 範例 |
|---|---|---|
| 目錄 | `kebab-case` | `date-range/` |
| 一般 `.ts` 檔 | `kebab-case` | `date-range.ts` |
| Vue 元件檔 | `PascalCase.vue`<br>**例外**：`*.page.vue`（路由目標檔）採 kebab-case，由路徑推導決定檔名（見前端規範 §0.3）。理由：它不是被 import 的元件，是由 `.route.ts` 動態載入的路由目標，不出現在任何模板標籤中。 | `DateRangePicker.vue`<br>`<段1>-<段2>.page.vue` |
| 測試檔 | 被測檔同名 + `.test.ts` | `date-range.test.ts` |
| 型別定義檔 | `kebab-case.types.ts` | `date-range.types.ts` |

- **檔名一律小寫（Vue 元件除外），不得只靠大小寫區分兩個檔案。** ✅（檔名 pattern 掃描）
  理由：開發在 Windows（不分大小寫）、部署在 Linux（分大小寫）。`import './DateRange'` 本機能跑、進 CI 就 `Module not found`，且錯在 build 階段而非測試階段，排查成本高。

### 1.2 識別字

| 對象 | 慣例 | 說明 |
|---|---|---|
| 變數、函式、方法 | `camelCase` | |
| 型別、介面、類別、Vue 元件 | `PascalCase` | 介面**不加** `I` 前綴 |
| 模組層級常數 | `SCREAMING_SNAKE_CASE` | 只用於真正的字面常數 |
| 代碼值（對應 DB `status` 等） | `SCREAMING_SNAKE_CASE` | |
| 布林 | `is`/`has`/`can`/`should` 開頭 | `isLocked`、`hasAttachment` |
| Vue emit 事件 | `kebab-case` 動詞過去式 | `submit-succeeded`、`row-selected` |
| 事件處理函式 | `on` + 事件名 | `onSubmitSucceeded` |
| 非同步函式 | 動詞開頭，不加 `Async` 後綴 | 回傳型別已標示 `Promise` |

- **布林必須用 `is`/`has`/`can`/`should` 開頭；禁止用 `flag`、`status` 當布林名。** ⚠️（PR review）
  理由：`if (attachment)` 讀不出是「有沒有附件」還是「附件物件」，維護者會補上防禦式判斷，掩蓋真正的空值 bug。
- **禁止以下模糊命名作為完整名稱：`data`、`info`、`item`、`obj`、`temp`、`tmp`、`val`、`res`、`handle`、`handler`、`util`、`utils`、`helper`、`common`、`misc`、`manager`、`process`。** ✅（自訂 lint 掃描）
  理由：這些名字承載不了語意，於是同檔案裡會出現 `data`、`data2`、`newData`。更嚴重的是 `utils.ts` 是熵的黑洞——沒人敢刪、沒人知道誰在用，最後變成循環相依的源頭。
  ❌ `function handleData(data: unknown)` → ✅ `function normalizeTimeRanges(raw: RawTimeRange[]): TimeRange[]`（名字就是規格）。

### 1.3 縮寫

- **只允許全專案共識的縮寫（`id`、`url`、`api`、`db`、`hr`、`ui`、`utc`、`vat`），其餘寫全；縮寫在 `camelCase` 中只有首字母大寫（`userId`、`apiClient`、`htmlContent`）。** ⚠️（PR review）
  理由：自創縮寫（把 `department` 縮成 `dept`、`calculate` 縮成 `calc` 這類）讓全文檢索失效——搜完整字會漏掉一半相關程式碼。

### 1.4 資料表與欄位（本專案已定案）

- **表名複數 `snake_case`（`companies`、`role_permissions`）；欄位 `snake_case`；外鍵 `<單數表名>_id`；關聯表 `<表A>_<表B>`。** ✅（Drizzle schema 掃描）
  理由：命名不一致時，join 條件與 mapping 全部要逐表查，也讓自動產生型別與查詢輔助無法成立。
- **主檔表必備 `created_at`、`updated_at`；需保留歷史者一律 `deleted_at` 軟刪除，禁止實體 DELETE。** ✅（schema 掃描）
  理由：本系統的資料大多是可稽核事實。實體刪除一筆已被其他紀錄引用的資料，會讓引用方（尤其是已鎖定的計算快照）對不上來源，且無法復原。
- **不使用 DB ENUM；固定代碼用 `string`/`integer`，語意寫進欄位註釋，TypeScript 端以 union 或 const object 定義唯一來源。** ✅（掃描禁止 `mysqlEnum`）
  理由：MariaDB 改 ENUM 需 `ALTER TABLE` 重建，在大表上是鎖表操作；新增一個代碼值這種業務常態不該變成 DDL 變更。
- **TypeScript 端欄位維持 `camelCase`，由 Drizzle 對應 DB 的 `snake_case`，兩邊不得各自發明。** ⚠️（PR review）
  理由：API 回應若混用 `created_at` 與 `createdAt` 兩種風格，前端會寫兩套 mapping，欄位改名時必定漏改一邊。

---

## 2. TypeScript 使用規範

### 2.1 必開的編譯選項

根目錄 `tsconfig.base.json` 定義，所有 package 繼承，**不得在子專案關閉**。 ✅（`tsc --noEmit` + config 掃描）

| 選項 | 擋掉什麼 |
|---|---|
| `strict` | 全套嚴格檢查的基底 |
| `noUncheckedIndexedAccess` | 見下方 |
| `exactOptionalPropertyTypes` | 見下方 |
| `noImplicitOverride` | 父類別方法改名後，子類別覆寫默默變成新方法 |
| `noFallthroughCasesInSwitch` | `switch` 漏 `break`，多算一段金額 |
| `noPropertyAccessFromIndexSignature` | 拼錯 key 時取到 `undefined` 而非編譯錯誤 |
| `verbatimModuleSyntax` | type-only import 被當成執行期相依，造成 bundle 膨脹與循環引用 |
| `isolatedModules` | 確保 Bun / esbuild 逐檔轉譯結果與 tsc 一致 |

```ts
const rates = { normal: 1, tier1: 1.34, tier2: 1.67 };
const rate = rates[code];  // 未開 noUncheckedIndexedAccess：型別是 number，實際可能 undefined
const pay = hours * rate;  // 結果 NaN，一路寫進計算結果，全程無錯誤訊息

type Adjustment = { extra?: number };
const a: Adjustment = { extra: undefined };  // 未開 exactOptionalPropertyTypes：合法
```

- `noUncheckedIndexedAccess`：薪資與工時的錯誤不會拋例外，只會算出錯的數字並寫進 snapshot。開啟後型別變成 `number | undefined`，強迫在計算前處理未知代碼。
- `exactOptionalPropertyTypes`：「沒有這個欄位」與「欄位是 undefined」在寫入 DB 時是兩件事——前者保持原值，後者可能把已存在的值覆蓋成 NULL。

### 2.2 any / unknown / as

- **禁止 `any`（含隱式 any、`any[]`、`Promise<any>`）。** ✅（ESLint `@typescript-eslint/no-explicit-any` 設為 error）
  理由：`any` 不是「這裡型別不明」，而是「從這裡開始整條資料流的型別檢查全部關閉」。傳染範圍是它流經的所有函式，而 IDE 不會提醒你。
- **外部邊界（HTTP 回應、`JSON.parse`、無型別第三方套件）一律 `unknown`，經 schema 驗證收斂後才進入業務邏輯。** ✅（邊界掃描）
  理由：未驗證的外部資料直接當成內部型別使用，等於把「後端改了欄位」這件事變成前端執行期崩潰。
- **禁止用 `as` 硬轉繞過型別錯誤。允許的只有三種：`as const`、收窄至更精確的字面量 union、有註解說明的 DOM 元素轉型。** ✅（`as` 掃描 + review 判定理由）
  理由：`as` 不做任何執行期轉換，只是叫編譯器閉嘴。`row as Employee` 之後所有欄位存取都被視為安全，錯誤會在幾層之外以 `Cannot read property of undefined` 爆出來，堆疊追蹤指向的位置與真正成因無關。
- **不得已要放寬型別時，上一行必須寫 `// 型別放寬理由：<具體原因>`；沒有理由註解的放寬視為未完成的工作。** ⚠️（缺註解可由掃描標示）

### 2.3 型別單一來源

- **DB schema → 後端型別 → OpenAPI → 前端型別必須是同一條推導鏈；禁止前後端各宣告一份同名型別。** 後端型別由 Drizzle 推導（`InferSelectModel`/`InferInsertModel`）；對外契約以後端路由宣告的 schema 為唯一真相，**OpenAPI 文件由後端程式碼產生（code-first）**，前端型別與 API client 再由該 OpenAPI 產生（`bun run gen:api`）。 ⚠️（PR review + 重複型別名掃描）
  理由：手抄的型別不會有人記得同步。後端把某個數值欄位從 `number` 改成 `string`（decimal 精度考量）時，前端仍以為是 `number`，`toFixed()` 在使用者按下送出之後才於執行期炸掉。
- **前端禁止 import 後端的任何型別或程式碼，跨界只能透過 OpenAPI 產生物。** ✅（dependency-cruiser：前端 workspace 不得相依 `apps/api`；`no-restricted-imports`）
  理由：前後端即使同 repo 也是兩個獨立部署的系統，溝通只能透過 API。直接 import 後端型別時「編譯過」不再等於「API 相容」——後端 response 經映射函式挑欄位，內部型別本來就不是對外形狀；而且伺服器端才有的模組與設定會被打包進公開的前端 bundle。細節見前端規範 §3.5 與後端規範 §1.7。

---

## 3. Git 與協作流程規範

### 3.1 分支策略

| 分支 | 用途 | 可否直接推 |
|---|---|---|
| `main` | 可上線狀態，對應 production | 否，僅接受來自 `develop` 的 PR |
| `develop` | 整合分支，隨時可佈署到測試環境 | 否，僅接受 PR |
| `feature/<簡述>` | 新功能 | 是 |
| `fix/<簡述>` | 修 bug | 是 |
| `hotfix/<簡述>` | 從 `main` 切出的緊急修復，需同時併回 `develop` | 是 |

- **`main` 與 `develop` 設為 protected branch：禁止直接 push、禁止 force push、必須通過 CI 才能合併。** ✅（GitHub branch protection）
  理由：直接推到共用分支的變更沒經過 CI，壞掉的是所有人的分支；force push 讓其他人的本機 rebase 進入無法自動解決的狀態，且被覆蓋的 commit 沒有任何通知。
- **分支從 `develop` 切出，合併前先 rebase 到最新 `develop`。** ⚠️（PR review）

### 3.2 Commit message

採用 Conventional Commits：`<type>(<scope>): <繁體中文描述>`。允許的 type：`feat`、`fix`、`refactor`、`perf`、`test`、`docs`、`build`、`ci`、`chore`、`revert`。

```
feat(auth): 登入失敗改回統一的模糊訊息
fix(report): 修正跨日資料的歸屬日期錯誤
```

- **commit message 必須符合上述格式，第一行不超過 72 字元。** ✅（commit-msg hook + CI 檢查 PR 內所有 commit）
  理由：格式化的 type 讓 `git log --grep='^fix'` 直接回答「這個 release 修了什麼」，也讓自動 changelog 與依 scope 追蹤變更成為可能。無格式的 log（「修改」、「更新」、「fix bug」）在事故排查時完全無法縮小範圍，只能逐個 diff 看。
- **一個 commit 必須「可獨立回退」且「可獨立說明」。** ⚠️（PR review）
  理由：判準是——單獨 revert 它之後，系統仍可編譯、可測試嗎？不行代表它跟前後 commit 是同一件事，應合併；若說明需要用「以及」（「加了某項計算以及順手改了 lint 設定」），代表是兩件事，應拆開。事故當下要精準回退單一變更時，混雜的 commit 會逼你手動挑 diff。

### 3.3 Pull Request

- **PR diff 原則上不超過 400 行（不含 lockfile、自動產生檔、純搬移）；超過須在描述說明為何無法拆分。** ✅（CI 計算 diff 行數）
  理由：review 品質隨 diff 大小急遽下降。超過 400 行時，reviewer 會從「逐行檢查」退化成「看起來沒問題就核可」，等於沒有 review。
- **PR 描述必須包含：改了什麼、為什麼改（連結需求／issue）、怎麼驗證、有無 DB migration、有無破壞性變更。** ✅（PR template + CI 檢查必填段落非空）

送出前自我檢查清單 ⚠️：

- [ ] 本機 `bun run check` 與 `bun test` 全綠
- [ ] 沒有被註解掉的舊程式碼、沒有 `console.log`、沒有未標註責任人的 `TODO`
- [ ] 沒有把 `.env`、金鑰、真實個資（姓名、身分證號、薪資）寫進程式碼或測試 fixture
- [ ] 有 DB 變更時附上 migration，且 migration 可重跑
- [ ] 新增或修改的業務規則有對應測試

### 3.4 禁止事項

- **禁止提交 `.env`、憑證、API key、真實個資。** ✅（`.gitignore` + secret 掃描於 pre-commit 與 CI）
  理由：祕密一旦進 git 歷史，即使下一個 commit 刪掉，它仍存在於所有 clone 與 fork 中；唯一正確的處置是輪替該祕密，刪 commit 沒有用。
- **禁止提交被註解掉的程式碼。** ✅（連續註解區塊掃描）
  理由：git 已保存歷史。死程式碼會誤導讀者以為它「可能還會用到」，於是沒人敢刪也沒人維護，還會被全文搜尋命中造成誤判。
- **禁止用 `--no-verify` 略過 hook。hook 太慢或誤判是要修 hook，不是繞過它。** ⚠️（無法技術性阻擋；CI 重跑同一批檢查，繞過只是延後失敗）

---

## 4. 程式碼風格與自動化

### 4.1 工具選型：ESLint + Prettier

- **lint 一律用 ESLint、格式化一律用 Prettier，並以 `eslint-config-prettier` 關閉 ESLint 中與格式相關的規則；設定集中在根目錄（單一 ESLint flat config、單一 Prettier 設定），不安裝 Biome 或任何第二套 linter／formatter。** ✅（CI 跑 `eslint` 與 `prettier --check` + 掃描是否存在其他 linter／formatter 設定檔）
  - **理由（Vue template 檢查）**：本專案前端是 Vue，而規範中有多條規則的檢查對象是 `.vue` 的 `<template>` 內容（例如模板內禁止複雜運算式）。`eslint-plugin-vue` 由 Vue 官方維護，能解析並檢查 template；Biome 主要處理 `<script>` 區塊，template 幾乎沒有規則。選 Biome 等於讓這些檢查全部退化成自製掃描腳本——把現成的東西自己重寫一遍，而且重寫出來的東西的正確性還得自己維護（見 7.2）。
  - **理由（型別感知規則）**：`typescript-eslint` 會呼叫 TypeScript compiler，因此能做 `no-floating-promises` 這類必須先知道「這個表達式是不是 Promise」才判斷得出來的檢查。後端有大量 `await` 資料庫交易的情境，漏一個 `await` 會讓交易邊界靜默失效——不拋錯、測試也可能是綠的（見 4.2 第一列）。Biome 以語法分析為主，型別推斷能力目前不到這個程度。
  - **理由（生態與主流）**：ESLint 是目前的主流選擇，Vue 官方腳手架預設提供的也是 ESLint + Prettier，可用規則、資料與慣例都比較多，遇到問題查得到答案。
  - **代價（明確承認）**：這是三個套件（`eslint`、`prettier`、`eslint-config-prettier`）再加上一組 plugin，設定比 Biome 的單一檔案繁瑣；格式規則與 lint 規則會互相打架，必須靠 `eslint-config-prettier` 消除衝突，且它必須排在設定陣列的最後才真的生效；執行速度明顯比 Biome 慢，其中型別感知規則最慢（要先建立 TypeScript program）。這些代價是為了換取上面三項能力而接受的，不是沒看見。
  - **速度的處置**：pre-commit 以 `lint-staged` 只掃本次改動的檔案、不掃全 repo，把 pre-commit 維持在 §7.3 的時間預算內；全量 lint（含型別感知規則）放在 pre-push 與 CI 這兩層執行（§7.3 的分層與 script 清單）。若 pre-commit 仍超出預算，處置方式是縮小 pre-commit 的檢查範圍，不是放寬預算，更不是改用 `--no-verify`（見 3.4）。

### 4.2 必開的關鍵 lint 規則 ✅

| 規則 | 提供者 | 違反的後果 |
|---|---|---|
| `@typescript-eslint/no-floating-promises`（**必須 error**） | typescript-eslint（型別感知） | 漏 `await` 時 DB 交易會在 promise 完成前 commit 或 rollback，資料寫一半而且不報錯，錯誤變成 unhandled rejection 被吞掉 |
| `@typescript-eslint/require-await` | typescript-eslint | 標了 `async` 卻沒 await，通常是漏寫的信號 |
| `@typescript-eslint/no-explicit-any` | typescript-eslint | 見 2.2 |
| `@typescript-eslint/no-unused-vars`（未使用的 import 一併涵蓋） | typescript-eslint | 死程式碼累積；常是「改到一半忘了改完」的信號 |
| `no-console` | ESLint 內建 | 生產環境把個資或薪資印到 stdout |
| `eqeqeq` | ESLint 內建 | `==` 隱式轉換讓 `0 == ''` 為真，金額判斷出錯 |
| `@typescript-eslint/no-non-null-assertion` | typescript-eslint | `!` 與 `as` 同性質，把執行期崩潰藏到遠處 |
| Vue 反應式相依規則 | eslint-plugin-vue | 依賴漏列造成畫面顯示過期資料，使用者看到錯的數字 |
| Vue `<template>` 內容規則（如禁止模板內複雜運算式，見前端規範） | eslint-plugin-vue | 邏輯藏進模板後無法被單元測試涵蓋，也不會出現在覆蓋率裡，改壞了只能靠人眼看畫面才發現 |

`@typescript-eslint/no-floating-promises` 不得降級為 warning。理由：warning 等於不存在——CI 綠燈，沒人會回頭看。

型別感知規則（上表標示「型別感知」者）必須在 ESLint 設定中指定 `parserOptions.project`，指向各 workspace 的 `tsconfig`；新增 package 時必須同步納入。理由：沒被 `project` 涵蓋的檔案，這些規則會**靜默不生效**——不報錯、也不檢查，正是 7.1 所說「永遠是綠的規則」，比沒有規則更糟。

### 4.3 `.editorconfig` 與換行符

- **`end_of_line = lf`、`charset = utf-8`、`indent_style = space`、`indent_size = 2`、`insert_final_newline = true`、`trim_trailing_whitespace = true`；git 設 `core.autocrlf = false`，並以 `.gitattributes` 強制 `* text=auto eol=lf`。** ✅（editorconfig 檢查 + CI 掃描 CRLF）
  理由：開發在 Windows、部署在 Linux。CRLF 混入造成兩種具體災難：shell script 或 Docker entrypoint 出現 `\r: command not found` 這種難以聯想的錯誤；以及整個檔案在 diff 中變成全行修改，review 完全失效、`git blame` 追不到真正作者。

### 4.4 格式化不進 review

- **格式意見（縮排、換行位置、引號、尾逗號）不得出現在 code review。** ⚠️（團隊約定）
  理由：格式由工具決定且不可協商，人再討論一次是零產出成本，還會稀釋 reviewer 的注意力——review 預算應該全花在邏輯、邊界條件與交易正確性上。認為某個格式決定是錯的，改的是根目錄的 Prettier 設定（另開 PR），不是別人的 PR。
- **格式化變更必須獨立成一個 commit，不與邏輯變更混在一起。** ⚠️（PR review）
  理由：混在一起時，200 行 diff 裡的 3 行邏輯變更會被淹沒。

---

## 5. 註解規範（要點）

> **完整規範見 `code-commenting` 技能。** 本節只保留最常被違反的要點，避免兩份文件漂移；衝突時以 `code-commenting` 為準。

- **註解與 docstring 一律繁體中文，識別字與技術術語維持英文原文。** ⚠️
- **寫「為什麼」不寫「做什麼」。判準：刪掉這行註解，讀者會不會問「為什麼」？會問就留，不會問就是噪音。** ⚠️
- **必須註解**：魔術數字與其法規／規格依據、workaround（含可移除條件）、為效能而寫的不直觀程式碼、正規表示式、公開 API 的 docstring、刻意留空的 `catch`。 ⚠️
- **禁止**：逐行翻譯程式碼、被註解掉的舊程式碼（✅ 掃描擋下）、修改紀錄（`// 2026-08-26 修改`——那是 `git blame` 的工作）。
- **改程式碼時必須同步檢查上下文既有註解是否仍成立，不成立就更新或刪除。** ⚠️
  理由：過期的註解比沒有註解更糟——它會主動誤導，而讀者通常相信註解而非重讀程式碼。

```ts
// ❌「把 hours 乘以 rate」 ✅ 此係數的法源為勞基法 §24（延長工時前 2 小時加給 1/3）；
// 此處用 1.34 而非 4/3，是因為規格要求先四捨五入到小數第二位再計算。
const RATE_TIER_1 = 1.34;
```

---

## 6. 相依套件管理規範

- **加入新套件前必須確認四件事：(1) 能否用既有相依或十幾行自寫程式碼取代；(2) 維護狀態（近一年有更新、有人回 issue）；(3) 授權相容性；(4) 傳遞相依數量與 bundle 體積影響（前端必評）。** ⚠️（PR review）
  理由：每個相依都是永久負債——CVE、breaking change 遷移成本、被棄用後的重寫成本。為省 20 行程式碼而引入、帶進 30 個傳遞相依的套件是明確淨損失。
- **新增相依的 PR 必須在描述寫明「為什麼需要」與「評估過的替代方案」。** ✅（CI 偵測 `package.json` 相依變更時要求該段落）
- **`bun.lock` 必須提交進版控。** ✅（`.gitignore` 掃描 + CI 檢查檔案存在）
- **CI 一律使用 `bun install --frozen-lockfile`。** ✅
  理由：不加此旗標時，Bun 會在解析結果與 lockfile 不符時**逕自更新 lockfile** 並繼續安裝。後果是 CI 測到的版本組合跟本機、跟 production 都不一樣，出現「CI 過了但線上壞掉」與無法重現的失敗。加上旗標後不一致會直接紅燈，強迫在本機解決。
- **版本使用精確版本或 caret，不得使用 `*`、`latest`、`next`。** ✅（`package.json` 掃描）
  理由：浮動版本讓「同一個 commit 在不同時間建置出不同產物」，事故無法重現。
- **每週排程 CI 跑一次安全掃描（`bun pm audit` 或等效工具）；高危漏洞需在下個 sprint 處理，或明確記錄接受風險的理由與期限。** ✅
  理由：不定期掃描的結果是漏洞累積到「一次要升 40 個套件」，屆時沒人敢升，於是永遠不升。

---

## 7. 檢查與 CI 規範

### 7.1 元規則：規範必須可執行

- **任何新增的規範條文都必須回答「這條靠什麼擋？」。答案是「靠自律」時，這條不算規則，只能寫成建議。**
  理由：**寫在文件裡但沒有檢查擋著的規則，遵守率會隨時間趨近於零。** 這不是紀律問題——上線前一晚沒有人會去翻文件。規則要生效，必須在錯誤發生的當下（commit / push / CI）就把人擋下來。
- **新增自動檢查時，必須先注入一個「應該被擋下」的違規案例、親眼確認檢查失敗，再修掉案例確認通過。兩個方向都驗證過，這條檢查才算數。** ⚠️（加規則的 PR 須在描述附上紅燈證據）
  理由：**一條寫錯條件的規則永遠是綠的，比沒有規則更糟。** 沒有規則時大家知道要靠 review；有一條假裝在檢查的規則時，所有人都以為這件事已被保障，於是 review 不再看它。這種誤放行會持續到某次事故才被發現。

### 7.2 掃描型檢查必須自我驗證

- **任何以檔案掃描（grep / AST 走訪）實作的檢查，必須先斷言「掃到的目標數量 > 0」；掃到 0 個目標時應該失敗而不是通過。** ✅（掃描器自身的 self-check）
  理由：掃描器最常見的失效不是判斷邏輯錯，而是**根本沒掃到檔案**——glob 寫錯、目錄搬家、副檔名改了、monorepo 新增的 package 不在路徑清單裡。此時它會回報「0 個違規，通過」，看起來跟真正通過一模一樣。
  ```ts
  const files = await glob('packages/*/src/**/*.ts');
  if (files.length === 0) throw new Error('掃描器沒有掃到任何檔案，glob 或目錄結構可能已變更');
  ```
- **掃描器必須輸出被檢查的檔案數與命中位置（`檔名:行號`），不得只回傳布林值。** ✅
  理由：只回傳 pass/fail 的檢查在紅燈時無法除錯，開發者會直接加白名單而不是修問題。

### 7.3 檢查的分層

| 階段 | 時間預算 | 內容 | 失敗的意義 |
|---|---|---|---|
| **pre-commit** | < 5 秒 | Prettier 格式檢查 + ESLint（經 `lint-staged`，僅 staged 檔案，**不含型別感知規則**）、secret 掃描、CRLF 掃描、註解掉的程式碼掃描 | 這個 commit 本身不合格 |
| **pre-push** | < 30 秒 | `tsc --noEmit`、commit message 格式、不需 DB 的單元測試、自訂規範掃描器 | 推上去也會被 CI 擋，先省一輪 |
| **CI** | 目標 < 10 分鐘 | 完整測試（含整合測試）、migration 驗證、schema 命名掃描、覆蓋率、相依安全掃描、PR 規範檢查 | 不可合併 |

- **需要資料庫、需要啟動服務、或耗時超過 30 秒的檢查，一律不得放進 git hook。** ✅（hook 有時間上限自檢）
  理由：hook 一旦讓 `git commit` 要等 40 秒，結果不是大家變嚴謹，而是**所有人都學會 `--no-verify`**——而且一旦學會，他們會對所有檢查都用它，連原本 1 秒跑完的格式檢查也一起被略過。hook 的價值完全建立在「快到不值得繞過」之上。同理，需要本機起 MariaDB 的檢查在新人第一天就會失敗，成為「這個 hook 壞了，大家都關掉」的起點。
- **pre-push 的檢查必須是 CI 檢查的子集，且呼叫完全相同的 `bun run` script，不得各寫一份。** ✅（script 單一來源）
  理由：兩份設定必然漂移，最後出現「本機過了 CI 沒過」，開發者對本機檢查失去信任而略過它。
  預定的 script：`check`（ESLint + Prettier）、`typecheck`（`tsc --noEmit`）、`check:commit`、`check:rules`（自訂規範掃描）、`check:secrets`、`test`、`test:integration`、`db:migrate:fresh`、`bun pm audit`。

### 7.4 CI 環境

- **CI 必須在有真實 MariaDB 的環境（GitHub Actions service container）跑資料庫相關測試，不得以 SQLite 或 mock 替代。** ✅
  理由：本系統的正確性大量依賴 DB 行為——交易隔離層級、`decimal` 精度與捨入、時區、唯一索引衝突、外鍵約束、鎖行為。SQLite 在這些點上都不同，尤其 `decimal` 在 SQLite 是浮點數，薪資測試會「通過」但在 production 算出 0.01 的差額。用 mock 測 DB 等於在測 mock 的實作。
- **CI 必須從空 DB 跑完整 migration 再跑測試。** ✅
  理由：只在既有 DB 上跑增量 migration 時，一個壞掉的早期 migration 可以潛伏數月，直到要建新環境（或災難復原）時才爆出來。
- **CI 失敗的分支禁止合併；禁止以「CI 不穩定」為由重跑到綠燈後合併，不穩定的測試必須修好或明確標記隔離。** ⚠️（branch protection 擋合併；重跑行為靠自律）
  理由：容忍 flaky test 的團隊會養成「紅燈先重跑」的反射動作，於是真實的失敗也被重跑掉。

### 7.5 測試覆蓋率的態度

- **不設全域覆蓋率門檻；只對純計算邏輯（金額計算、時間歸屬、級距套用、額度扣抵與返還、法規參數套用）設 ≥ 90% 行與分支門檻。** ✅（覆蓋率工具按路徑設定）
  理由：全域門檻只會製造為了數字而寫的測試——把 getter、DTO、設定檔全呼叫一遍，覆蓋率漂亮但沒斷言任何行為。這種測試淨效果是負的：讓重構變貴（改一行要改十個測試），卻抓不到 bug，同時給團隊「已經測過了」的錯誤安全感。相對地，薪資計算的每個分支都對應真實金額，是唯一值得用數字強制的地方。
- **修 bug 時必須先補一個會失敗的測試，再修。** ⚠️（PR review）
  理由：沒先看到紅燈，就無法確定這個測試真的涵蓋了那個 bug（同 7.1 的道理）。

---

## 8. 文件規範

- **規範與設計文件只寫「規則 + 為什麼」，不重複抄目錄結構、檔案清單、函式簽章、欄位列表。要看結構就去看程式碼。** ⚠️
  理由：抄過來的東西沒有任何機制保證同步，而它一定會過期。過期的文件比沒有文件更糟——新人照著它去找一個不存在的目錄，浪費半天才學會「這裡的文件不能信」，接著整份文件（包括仍然正確的規則）一起失去效力。
  例外：資料模型的資料字典是**設計來源**而非程式碼的複本——它是 schema 的規格，程式碼要對齊它，方向相反。
- **「決定不做的事」必須寫下來，並註明「什麼條件下重新評估」。** ⚠️
  理由：沒寫下來的否決會被重複提案，每次都要重吵一遍；新人也看不出某個明顯做法為何沒被採用，於是自己動手做，做完才被否決。註明重評條件則是為了避免另一種失敗——沒有退出條件的否決，會在情況早已改變後仍被當成不可挑戰的教條。
- **文件裡不得留下已經不存在的東西（已移除的功能、已放棄的方案、已改名的模組），發現即刪。** ⚠️
  理由：文件裡活著一個不存在的東西，會讓讀者花時間去找它、甚至基於它做設計決策，代價遠高於文件不完整。
- **文件變更與對應的程式碼變更放在同一個 PR。** ⚠️
  理由：分開時，文件那個 PR 永遠不會被開出來。
- **必須更新文件的時機** ⚠️：新增或修改任何一條要別人遵守的規則（同時加上檢查，見 7.1）；否決方案或決定暫時不做某事（寫進 8.1 並註明重評條件）；資料表或欄位語意變更（更新資料模型文件）；業務規則變更如法規參數與計算方式（更新對應的規格文件）；開發流程或工具鏈變更如新增檢查、調整 hook、換工具（更新本文件）。

### 8.1 決定不做的事

| 決定不做 | 理由 | 重新評估的條件 |
|---|---|---|
| 不採用 Biome（lint 與格式化用 ESLint + Prettier） | 見 4.1，Biome 對 `.vue` `<template>` 幾乎沒有規則、型別感知能力不足以支撐 `no-floating-promises` 這類檢查，改用它等於把現成檢查退化成自製掃描腳本 | Biome 的型別感知與 Vue template 支援成熟到足以取代 `typescript-eslint` 與 `eslint-plugin-vue`，且 4.2 的規則能一對一對應 |
| 不使用 DB ENUM | 見 1.4，改 ENUM 需鎖表 DDL | 無（架構定案） |
| 不做實體 DELETE | 見 1.4，稽核與 snapshot 完整性 | 無（架構定案） |
| 不設全域測試覆蓋率門檻 | 見 7.5，只會製造無斷言的測試 | 出現核心邏輯完全沒測試卻通過 review 的案例 |
| 不在 git hook 跑需要 DB 的檢查 | 見 7.3，會導致 `--no-verify` 常態化 | hook 可在 5 秒內完成且不需本機額外環境 |
| 時間不存 UTC，全系統一律台北時間 | 見後端規範 §6，單一時區客戶；存 UTC 只是替每次讀寫加一道會漏掉的換算 | 出現非 UTC+8 時區的客戶或跨國據點 |
| API 路徑不帶版本前綴（`/v1`） | 見後端規範 §1.6，前後端同 repo 同時發版，版本號不會被遞增 | 出現無法同步升級的外部 API 使用者 |
| 不手寫 OpenAPI spec（不採 schema-first） | 見後端規範 §1.7，手寫 spec 是第二份真相，必定與程式碼漂移 | 需要在後端實作之前先與外部團隊敲定契約 |
| 前端不 import 後端型別（不共用型別套件） | 見 2.3，會讓「編譯過」誤認為「API 相容」，並把伺服器端相依帶進前端 bundle | 無（架構定案） |

> 新增否決決定時直接加一列；被推翻時整列刪除，並在 commit message 說明原因。
