# 測試規範與自動化檢查現況

對應 `docs/dev-standards-frontend.md` §8、§10，以及通用規範 §7。摘要：本專案**不寫 `.vue` 元件測試**，值得測的邏輯先抽成純函式（見 `components-state-permission.md` §1.3）；規範 §10 那張「47 條可自動化檢查」的表，經逐條打開對應腳本／設定檔核對後，**真正在跑的不到十條**，其餘標 ✅ 的規則目前是靠 review。本檔是那次核對的完整記錄，SKILL.md 的表是它的摘要。

## 目錄

1. [測試分三層，不做 `.vue` 元件測試](#1-測試分三層)
2. [指令清單](#2-指令清單)
3. [逐條核對：規範 §10 vs 實作現況](#3-逐條核對)
4. [E2E（§8.3）：整節都不存在](#4-e2e)
5. [交件前檢查清單](#5-交件前檢查清單)

---

## 1. 測試分三層

| 層                 | 證明什麼                                                   | 抓不到什麼                       |
| ------------------ | ---------------------------------------------------------- | -------------------------------- |
| 純函式測試（§8.1） | 算得對——狀態矩陣、工時換算、payload 組裝                   | 這個函式有沒有被接到正確的元素上 |
| 掃描型測試（§8.2） | 東西有被接上、沒有孤兒——路由可達、API 有呼叫端、權限碼存在 | 接上去之後跑起來對不對           |
| E2E（§8.3）        | 一條真實流程在瀏覽器裡從頭到尾走得通                       | 沒被納入 E2E 覆蓋範圍的任何東西  |

**第二層（掃描型測試）目前完全不存在**（見下第 3 節），**第三層（E2E）連工具鏈都沒有引入**（見第 4 節）。實際能依靠的只有第一層。

### 不做 `.vue` 元件測試

本專案不寫 `.vue` 元件單元測試，不引入 `@vue/test-utils`——`package.json` 裡也確實沒有這個依賴。值得測的邏輯先抽成純 TS 函式（§1.3），再對函式寫測試。要跑起一個稍有份量的頁面元件，得先 mock HTTP client、Pinia、router、Element Plus 的彈窗與 teleport，測試檔裡 mock 比斷言長；「某些狀態下操作必須被停用」抽成純函式後，一個參數化表格就能把整張狀態矩陣逐格測完。代價是「函式對但模板接錯」測不到，這個缺口理論上由 E2E 補，但 E2E 目前不存在，缺口就是純粹的缺口，只能靠人工測試。

真實範例（`apps/web/src/pages/shifts/main/`）：`.duration.view.ts`／`.periods.view.ts`／`.breaks.view.ts`／`.day-offset.view.ts`／`.errors.view.ts` 各自有同名的 `.test.ts`，`.page.vue` 本身沒有測試檔——這正是規範要求的形狀。

## 2. 指令清單

以下從 repo 根目錄執行：

```bash
# 前端型別檢查：先驗 OpenAPI 產生物存在，再跑兩份 vue-tsc
bun run typecheck:web
# 展開後等於：
#   bun run check:api-artifacts
#   vue-tsc --noEmit -p apps/web/tsconfig.json        # 排除 *.test.ts
#   vue-tsc --noEmit -p apps/web/tsconfig.test.json   # 只收 *.test.ts 以外全部＋測試

# lint + 格式檢查（全 repo，含 apps/web）
bun run check

# 個別掃描腳本（見第 3 節哪些真的碰得到 apps/web）
bun run check:number-cast   # apps/api/scripts/check-number-cast.ts
bun run check:tz-leak       # apps/api/scripts/check-tz-leak.ts
bun run check:api-artifacts # apps/api/scripts/check-api-artifacts.ts

# 前端測試子集
bun test apps/web/src

# 一次跑完 CI 會跑的全部步驟（本機唯一的把關方式）
bun run ci
```

`ci` 的實際串接：`check && typecheck && gen:api && typecheck:web && check:layers && check:i18n && check:audit-policy && check:audit-transaction && check:migration-journal && check:n-plus-one && check:dataset-code && check:number-cast && check:tz-leak && check:menu-permission && test`。注意 `check:layers`（dependency-cruiser）雖然排在鏈裡，但**它只掃 `apps/api/src`**（`depcruise --config .dependency-cruiser.cjs apps/api/src`）——這一步跑綠，證明的是後端的分層規則，跟前端無關。`check:i18n`／`check:audit-policy`／`check:audit-transaction`／`check:migration-journal`／`check:n-plus-one`／`check:dataset-code` 全部是純後端腳本，前端改動不會觸發任何反應；`check:menu-permission` 雖然放在 `apps/api/scripts/`（與其餘 `check:*` 腳本同一個慣例位置），但它掃的是 `apps/web/src/menu/` 與 `apps/web/src/pages/**/*.route.ts`，前端改動會觸發它。

**沒有 CI、也沒有 git hook**：repo 沒有 `.github/workflows/*.yml`，也沒有 `.husky/`。`bun run ci` 是一條純手動指令，送交前必須自己跑，沒有機制會替你擋。

## 3. 逐條核對

以下是打開對應腳本／設定檔逐條查證的結果，不是照抄規範 §10 的 ✅ 標記。

### 3.1 真的在跑的

| 規則                                                                                                       | 實作現況                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.7／§9.2 `exp` 外洩、帶時區標記字面值、遊蕩的 `new Date(`／`Date.now(`                                   | `apps/api/scripts/check-tz-leak.ts`，`bun run check:tz-leak`。掃 `apps/web/src`，含掃描器自我檢查（掃到 0 檔、`pages/` 或 `shared/format/` 計數 0 都中止；內建樣本驗證判斷邏輯本身沒壞）。                                                                    |
| §9.2 金額／費率禁 `Number(` 一類轉型                                                                       | `apps/api/scripts/check-number-cast.ts`，`bun run check:number-cast`。**只掃 `pages/` 與 `shared/components/` 兩個目錄**，含自我檢查。                                                                                                                        |
| §3.1 產生的 client 必須注入統一 client、產生物必須存在                                                     | `apps/api/scripts/check-api-artifacts.ts`，`bun run check:api-artifacts`（`typecheck:web` 的前置步驟）。驗四個產生物檔案存在、`api-client.ts` import 統一 client、不含 `fetch(`／`axios`／`XMLHttpRequest`／`sendBeacon`、端點函式數＝`callApi(` 呼叫次數。   |
| §1.1／§3.4（部分）                                                                                         | `vue-tsc`（兩份 tsconfig）＋ ESLint 的 `@typescript-eslint/no-floating-promises`／`require-await`（`error`，見 `eslint.config.js` 的 `apps/web` 區塊）。                                                                                                      |
| §3.1 禁止 `import axios`                                                                                   | ESLint `no-restricted-imports`，`apps/web/src/shared/api/http-transport.ts` 本身例外。                                                                                                                                                                        |
| §3.1 single-flight refresh                                                                                 | `apps/web/src/shared/api/client.test.ts`，`bun test` 涵蓋。**全文少數靠行為斷言而非靜態掃描的檢查**：mock 底層傳輸，斷言三支併發過期請求只打出一次 refresh。                                                                                                  |
| §0.12 registry 路由數不得為 0                                                                              | `apps/web/src/router/registry.ts` 的執行期自我檢查（`import.meta.glob` 結果為 0 就 `throw`）。不是 CI 腳本，是應用程式啟動時的檢查。                                                                                                                          |
| §4.4 選單分組無權限碼／選單項只能掛讀取類權限碼／`permissionCode` 與 `.route.ts` 的 `meta.permission` 一致 | `apps/api/scripts/check-menu-permission.ts`，`bun run check:menu-permission`（已串進 `ci`，緊接在 `check:tz-leak` 之後）。走 AST 掃 `menu/` 與所有 `.route.ts`，含掃描器自我檢查（掃到 0 個選單項或 0 支 `.route.ts` 都中止；內建樣本驗證判斷邏輯本身沒壞）。 |
| Prettier                                                                                                   | `bun run check` 的後半，全 repo 含 `apps/web`。                                                                                                                                                                                                               |

### 3.2 規範標 ✅、但目前沒有對應程式碼的

以下逐條核對過（打開 `eslint.config.js`、`.dependency-cruiser.cjs`、`package.json`、全 repo 搜尋依賴與設定檔），確認**不存在**，不是「可能存在但沒找到」：

- **§0 幾乎整節**：頁面兩層目錄與路徑段推導（§0.2）、檔名前綴推導與全域唯一（§0.3）、頁面目錄檔案白名單（§0.4）、`.view.ts`／`.actions.ts`／`.payload.ts` 的 `max-lines` override（§0.7）、`stores/` 檔案數 ≤ 8（§0.8）、`shared/` 禁 barrel 與雙使用者去重（§0.9）、`api/` 只准 `generated/`（§0.10）、`.route.ts` 三條硬規則裡的前兩條——惰性載入、雙向成對、禁 `../`（§0.12，第三條「registry 數對得上檔案系統數」也只有一半，見上）。搜尋 `apps/web`、`apps/api/scripts`、`scripts/` 全 repo，找不到任何涵蓋這批規則的程式碼。
- **§0.11／§1.5／§3.5 分層相依（dependency-cruiser）**：`.dependency-cruiser.cjs` 全檔 317 行，`from`／`to` 全部指向 `apps/api/src/...`，**沒有一條規則的路徑碰得到 `apps/web`**；`check:layers` 執行時也只傳 `apps/api/src` 這一個參數。`shared/` 不得 import `pages/`／`stores/`、頁面互不 import、禁止 import 後端型別或程式碼——這三條規範裡最重的規則，目前全部沒有機器在擋。**連 `apps/web/tsconfig.json` 自己的註解都寫著「§0.11 的分層相依由 dependency-cruiser 依目錄關係判定」**，這句話與程式碼現況不符，是本次查證中發現的、程式碼裡的錯誤註解，不是規範文件的問題。
- **§1.2／§1.4**：元件行數上限（`max-lines`）、模板複雜運算式（`vue/no-complex-template-expression`）——`eslint.config.js` 的 `apps/web` 區塊裡都沒有設定。
- **§2.2**：store 命名慣例與 `reset()` 存在性的掃描測試不存在。
- **§3.4**：`no-misused-promises` 需要型別感知的 `recommendedTypeChecked`，`eslint.config.js` 對 `apps/web` 只用語法層級的 `recommended`（理由見該檔註解：避免整包 `no-unsafe-*` 系列在既有程式碼上大量誤報）。目前只有 `no-floating-promises` 生效。
- **§3.6**：依 `code` 分支、禁止頁面判斷 HTTP status 或 `code` 常值——沒有 `no-restricted-syntax`，沒有掃描腳本。
- **§3.7**：「session 模組以外禁止引用 `exp`」與「過期判斷路徑禁止引用 `exp`」——`check:tz-leak` 只擋「顯示路徑」（定義域見 `style-i18n-time.md`），不含 `stores/` 等其他角落。
- **§4.1**：禁止頁面出現 `role`／`isAdmin` 條件判斷——沒有掃描腳本。
- **§5.2／§5.3**：顏色／間距走 token、禁 `!important` 與 `:deep(.el-`——**stylelint 完全不存在**，`package.json` 裡沒有這個套件，repo 裡沒有任何 `.stylelintrc*` 檔案。
- **§6.1／§6.2／§6.3**：驗證規則來源、送出防重複點擊、欄位錯誤 dot-path 解析——全部沒有掃描腳本。
- **§7.1／§7.2／§7.3**：列表查詢欄位命名、空／載入／錯誤三態、回聲比對必須先判斷才賦值——全部沒有掃描腳本。`shared/api/list-echo.ts` 本身有單元測試，但「呼叫端真的有先判斷才賦值」這件事沒有工具驗。
- **§8.2**：路由可達性掃描、未接端點清單、權限碼有效性——三支掃描型測試全部不存在。
- **§9.1**：`eslint-plugin-vuejs-accessibility`——`package.json` 沒有這個依賴，`eslint.config.js` 沒有引用。
- **§9.2**：禁裸中文字串、禁 `toLocaleDateString`／`toFixed`／`toISOString`——`eslint.config.js` 沒有對應的 `no-restricted-syntax`，也沒有獨立掃描腳本。

### 3.3 覆蓋率

與後端同一個現況：`bunfig.toml` 沒有任何 `coverageThreshold` 設定，`package.json` 沒有 `test:coverage` 之類的 script，`ci` 鏈裡沒有 `--coverage`。§7.5 規定的覆蓋率門檻與路徑自檢完全沒有實作。

## 4. E2E

`docs/dev-standards-frontend.md` §8.3 用了將近整節篇幅規定 Playwright 的用法、覆蓋範圍判準、12 條上限、資料前置、穩定性政策——**這一整節在目前的程式碼裡完全不存在**：

- 沒有 `e2e/` 目錄。
- `package.json`（根與 `apps/web`）都沒有 `@playwright/test` 依賴。
- 沒有任何 `playwright.config.ts`。
- 沒有 `.github/workflows/`，所以「E2E 只在 CI 跑、排在其他檢查之後、時間預算 ≤ 6 分鐘」這些規則沒有可以掛載的地方。

這不是「規則定了但還沒補齊測試案例」的狀態，是連工具鏈本身都還沒引入。**在這一輪任務範圍內不要假設 E2E 是可用的覆蓋手段**，「函式對但模板接錯」這個 §8.1 承認的缺口目前完全沒有第三層在補，只能靠人工測試。

## 5. 交件前檢查清單

- [ ] 本機執行過 `bun run ci` 且全部步驟通過——這是唯一的把關，沒有 CI 會替你重跑。
- [ ] 新增或改動的純函式邏輯有對應的 `.<角色>.test.ts`，且測試分類符合第 1 節判準（不寫 `.vue` 元件測試）。
- [ ] 新增頁面時對照 `module-layout.md` §3 的白名單手動核對檔名——這條沒有掃描腳本會替你擋。
- [ ] 涉及金額或費率顯示：跑過 `bun run check:number-cast`，且沒有繞過 `pages/`／`shared/components/` 之外的角落偷放轉型。
- [ ] 涉及時間顯示或 session 到期：跑過 `bun run check:tz-leak`；`exp` 沒有出現在 `stores/` 或其他該檢查掃不到的角落（自己對照 `api-envelope.md` §4）。
- [ ] 若改動涉及 §0 分層相依、§1.5 共用區使用者數、§3.5 禁止 import 後端——**沒有 dependency-cruiser 在擋**，自己對照 `module-layout.md` §7 核對 import 方向。
- [ ] 若新增列表頁：`search`／`sort` 回聲比對是否真的在賦值前做了（沒有工具驗，靠自己核對 `forms-and-lists.md` §2.3）。
- [ ] 沒有把 §8.3 的 E2E 當成可依賴的安全網——它不存在。
