---
name: sundial-frontend
description: Sundial 前端（apps/web）的開發規範與實作指引，涵蓋 Vue 3 Composition API＋TypeScript 嚴格模式＋Vue Router＋Pinia＋Element Plus＋Tailwind v4 這一套的實際寫法：pages/ 兩層目錄與角色檔白名單、依 envelope code 分支的錯誤處理、OpenAPI 產生型別與統一 HTTP client、session 到期與時區顯示規則、表單與列表的統一處理，以及測試與自動化檢查的真實現況。只要動到 apps/web 底下任何前端程式碼就要先讀這個 skill——新增頁面、串接 API、處理表單或列表、顯示金額或時間、寫前端測試、或被 bun run ci／check:tz-leak／check:number-cast 擋下來要修的時候，都適用。不要憑一般 Vue／REST 前端習慣動手：這裡的頁面目錄只准放固定幾種檔名（放錯會讓好幾條規則同時失去命中，而且不會有任何東西報錯）、後端回應一律依 envelope 的 code 分支而不是 HTTP status、金額與費率是 decimal 字串禁止 Number() 一類轉型、時間字串一律不經過 Date 物件顯示——而且這裡列的規則裡，真正有工具在擋的只是少數，多數寫錯了不會出現任何紅字，只會安靜地違規。
---

# Sundial 前端開發

## 這份 skill 只講什麼

這個 repo 的頁面程式碼異常自我說明——每個檔案的檔頭都寫了「為什麼這樣做」。照著 `apps/web/src/pages/regulatory/datasets/` 或 `apps/web/src/pages/shifts/main/` 抄兩三個既有頁面，Composition API 怎麼寫、Element Plus 跟 Tailwind 怎麼分工、四態怎麼做、錯誤怎麼分類，大部分都推得出來。**這份文件不重複那些讀程式碼就學得會的東西**，只放三種讀既有程式碼推不出來、猜不到、寫錯也不會有紅字的東西：

1. **§0.4 頁面目錄檔名白名單**——本文件槓桿最大的一條規則，見下一節。
2. **哪些規則有工具在擋、哪些沒有**——規範 §10 標 ✅ 的 46 條裡，真正在跑的不到十條，其餘寫錯了不會出現任何紅字。
3. **只有跨頁面才看得出來的邊界**——「頁面目錄互不 import」「`shared/` 要先有第二個使用者才准放東西」這類規則，單一頁面內部看不出違規，需要兩個頁面才顯形。

一般 Vue 撰寫慣例在各份 `references/*.md` 裡只保留看不出來的那一小段，展開的部分請直接讀範例頁，不要指望這份文件重講一次。

權威來源是 `docs/dev-standards-frontend.md`（840 行，§0～§10）。本 skill 是它的可執行版本：把「怎麼做」抽出來，理由壓成一句並附章節號，需要完整論證時回查該章。

## §0.4：頁面目錄只能放這些檔案，白名單是封閉的

`pages/<段1>/<段2>/` 底下只允許：`.page.vue`（必要，恰好一個）、`.route.ts`（必要，恰好一個）、`.view.ts`／`.actions.ts`／`.payload.ts`（選用）、`.<主題>.{view,actions}.ts` 主題拆分檔、`.<角色>.test.ts`、`components/**/*.vue`。**除此之外任何檔名都不合法**——包含下面這些看起來完全合理、其實全部禁止的名字：

- `.gateway.ts`、`.api.ts`——本專案沒有「頁面自己的 API 包裝層」這個容器，`api/generated/` 產生的函式已經是唯一入口（`module-layout.md` §5）。
- `.helpers.ts`、`.utils.ts`、`.constants.ts`——§1.3 的四類邏輯已經各自有角色檔可放，不需要第三種容器。
- `.composable.ts`——本專案的目錄結構裡沒有「composable」這個字彙（`module-layout.md` §1），純函式邏輯依 §1.3 分類進 `.view.ts`／`.actions.ts`／`.payload.ts`，不是抽成 composable。
- `.service.ts`——這是後端的分層詞彙，前端沒有對應的容器。

**多一個檔名看起來無害，實際上會讓好幾條規則同時失效**：§3.6、§4.1、§7.3、§9.2 好幾條規則都是以「頁面程式碼」的 glob 為條件（`pages/*/*/*.page.vue`、`pages/*/*/*.view.ts` 這種寫法）。邏輯一旦搬進白名單外的檔案，那些規則會**同時失去對這段程式碼的命中**——檔案還在、程式還跑、CI 全綠，但原本該擋住的東西已經沒人在看。

這條規則本身**沒有掃描腳本在擋**（規範標 ✅，但目前沒有對應程式碼，見 `references/testing-and-checks.md`）。新增或修改頁面時，把上面這份白名單當成手動核對清單，完整版本見 `references/module-layout.md` §3。

## 先決定你在做什麼

| 你的任務                                                       | 先讀                                        | 對應規範   |
| -------------------------------------------------------------- | ------------------------------------------- | ---------- |
| 新增頁面／不知道檔案該放哪／目錄結構有疑問                     | `references/module-layout.md`               | §0         |
| 串接 API、處理回應、錯誤、session、登入態                      | `references/api-envelope.md`                | §3         |
| 寫 `.vue`、抽 `.view.ts`／`.actions.ts`、Pinia store、權限判斷 | `references/components-state-permission.md` | §1、§2、§4 |
| 表單、送出、欄位錯誤、列表、分頁、排序                         | `references/forms-and-lists.md`             | §6、§7     |
| 樣式、Element Plus 覆寫、文案、日期時間、金額顯示              | `references/style-i18n-time.md`             | §5、§9     |
| 寫測試、跑檢查、被 CI 擋下來                                   | `references/testing-and-checks.md`          | §8、§10    |

多數任務會跨兩三份。**新增一個頁面幾乎一定要讀 module-layout 與 api-envelope**，串列表或表單另外加 forms-and-lists，收尾時翻 testing-and-checks 的交件清單。

## 什麼有工具擋、什麼只能靠自己

規範 §10 那張表列了 46 條「可自動化檢查」，**但這個「✅」是規範作者的意圖，不是現況查證**——下面每一列都是打開對應的腳本、設定檔或 `package.json` 逐條核對過的結果，不是照抄規範的標記。

**真的會擋你的：**

| 工具                                      | 擋什麼                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check:tz-leak`                           | 掃 **`apps/web/src` 全站**（`.ts` 與 `.vue`，排除 `api/generated/`）三條規則：`exp` 這個識別字出現在顯示路徑（全站 `.vue` 的 script／template，加上 `pages/`／`shared/components/`／`shared/format/` 底下的 `.ts`）；帶時區標記的字面值（`+08:00`／`T時:分`／`Z` 結尾）出現在 `pages/`／`shared/components/` 的 `.ts`／`.vue`；`shared/format/` 以外（且非兩個白名單檔、非 `*.test.ts`）出現遊蕩的 `new Date(`／`Date.now(`。含掃描器自我檢查（掃到 0 檔、`pages/` 或 `shared/format/` 計數為 0 都會中止）。 |
| `check:number-cast`                       | **只掃兩個目錄**：`apps/web/src/pages` 與 `apps/web/src/shared/components`（後者目前還不存在——目錄不存在不算失敗，兩個都不存在或掃到 0 檔才算）。禁止 `Number(`／`parseFloat(`／`parseInt(`／`Number.parseInt`／`Number.parseFloat`／一元 `+`。`.ts` 與 `.vue` 的 `<script>` 走 AST，`<template>` 走正則。                                                                                                                                                                                                   |
| `check:api-artifacts`                     | 產生物四個檔案（`openapi.json`、`api-types.ts`、`api-guard.ts`、`api-client.ts`）是否存在；產生的 `api-client.ts` 是否 `import` 統一 client、不含 `fetch(`／`axios`／`XMLHttpRequest`／`sendBeacon`；端點函式數是否等於 `callApi(` 的呼叫次數（兩個數字兩種方式數，見 §3.1）。                                                                                                                                                                                                                               |
| `typecheck:web`                           | 先跑 `check:api-artifacts`，再跑 `vue-tsc` **兩次**：`apps/web/tsconfig.json`（排除 `*.test.ts`）與 `apps/web/tsconfig.test.json`（不排除）。**不是** `tsconfig.app.json`——這個專案根本沒有那份檔案。                                                                                                                                                                                                                                                                                                        |
| ESLint（`apps/web/src/**/*.ts`／`*.vue`） | `typescript-eslint` 的 `recommended`（語法層級，非 type-checked 整包）＋ `eslint-plugin-vue` 的 `flat/recommended`；`no-floating-promises`／`require-await`／`no-explicit-any`／`no-unused-vars`／`no-non-null-assertion`／`no-console`／`eqeqeq` 全部 `error`；`no-restricted-imports` 禁止 `import axios`（統一 client 檔案 `shared/api/http-transport.ts` 本身例外）。                                                                                                                                    |
| Prettier（`bun run check` 的後半）        | 全 repo 格式，含 `apps/web`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `bun test`（`shared/api/client.test.ts`） | **single-flight refresh 是全文少數靠行為斷言而非靜態掃描的檢查**（§3.1）：mock 底層傳輸（`replaceTransport`），同時發三支會遇到 access token 過期的請求，斷言只打出一次 `/sessions/main/refresh` 且三支都拿到成功結果。                                                                                                                                                                                                                                                                                      |
| `router/registry.ts` 的執行期自我檢查     | 不是獨立掃描腳本，是 registry 模組載入時的檢查：`import.meta.glob('../pages/*/*/*.route.ts')` 蒐集結果為 `0` 就直接 `throw`，讓「一條路由都蒐集不到」表現成應用程式啟動就炸，而不是安靜地變成一片空白。                                                                                                                                                                                                                                                                                                      |

**沒有工具擋、寫錯不會報錯的（節錄，完整對照見 `references/testing-and-checks.md`）：**

- **§0 幾乎整節**：`pages/` 兩層目錄與路徑段推導、檔名前綴全域唯一、`.view.ts`／`.actions.ts`／`.payload.ts` 的行數上限（ESLint 沒設 `max-lines`）、`stores/` 扁平與檔案數上限、`shared/` 禁 `index.ts` barrel 與雙使用者去重、`api/` 只准 `generated/`、`.route.ts` 的三條硬規則（惰性載入／雙向成對／禁 `../`）。除了上表最後一列的 registry 自我檢查，這一整節**一個掃描腳本都沒有**——上一節的 §0.4 白名單也在其中。
- **§0.11／§1.5／§3.5 的分層相依**（`shared/` 不得 import `pages/`／`stores/`、頁面互不 import、禁止 import 後端型別或程式碼）：規範寫的檢查手段是 dependency-cruiser，但 `.dependency-cruiser.cjs` 與 `check:layers` **目前只掃 `apps/api/src`**（見根 `package.json`：`depcruise --config .dependency-cruiser.cjs apps/api/src`），整份設定檔裡沒有一條規則的 `from`／`to` 碰得到 `apps/web`。連 `apps/web/tsconfig.json` 自己的註解都寫著「§0.11 的分層相依由 dependency-cruiser 依目錄關係判定」——**這句程式碼裡的註解本身就是錯的**，工具目前沒有在做這件事。這一批是單一頁面內部看不出來的邊界規則，只能靠自己核對 import 方向。
- **§1.1／§1.2／§1.4** 元件行數上限與模板複雜運算式：ESLint 沒有設定 `max-lines`，也沒有開 `vue/no-complex-template-expression`。
- **§2.2** store 的 `reset()` 存在性、setup store 命名規則：靠 review。
- **§3.4** `no-misused-promises`：規範寫這條要靠它擋，但它是型別感知規則，需要 `recommendedTypeChecked`，而 `eslint.config.js` 對 `apps/web` 只用了語法層級的 `recommended`（理由見該檔註解：避免整包 `no-unsafe-*` 誤報）。目前只有 `no-floating-promises` 生效，`no-misused-promises` 沒有開。
- **§3.6** 依 `code` 分支、頁面不得判斷 HTTP status 或 `code` 常值：沒有 `no-restricted-syntax`，沒有掃描腳本，靠 review。
- **§3.7** `exp` 的過期判斷邊界：`check:tz-leak` 擋的是「顯示路徑」（見上表定義域），但規範另外要求「session 模組以外禁止引用 `exp`」與「過期判斷路徑禁止引用 `exp`」——這兩條的定義域比「顯示路徑」更廣，`check:tz-leak` 掃不到 `stores/` 或 `shared/api/` 以外角落誤用 `exp` 的情形。
- **§6.1／§6.2／§6.3** 表單驗證規則來源、送出防重複點擊、欄位錯誤 dot-path 定位：全部靠 review。
- **§7.1／§7.2／§7.3** 列表查詢欄位命名、空／載入／錯誤三態、`search`／`sort` 回聲比對：全部靠 review。
- **§8.2** 掃描型測試（路由可達性、未接端點清單、權限碼有效性）：完全不存在。
- **§9.1** 無障礙：`eslint-plugin-vuejs-accessibility` 沒有安裝，`package.json` 裡查不到這個套件。
- **§5.2／§5.3** 顏色／間距 token、禁 `!important` 與 `:deep(.el-`：stylelint **完全不存在**——沒有設定檔、沒有依賴、`package.json` 裡沒有 `stylelint` 這個字。
- **§8.3 整套 E2E（Playwright）**：沒有 `e2e/` 目錄、沒有 `@playwright/test` 依賴、沒有任何 CI 設定檔（`.github/workflows/` 不存在）。規範寫的整節，在目前的程式碼裡完全不存在，不是「還沒補齊」而是「一行都沒有」。

另外兩件現況要知道：**沒有 CI、也沒有 git hook**——repo 沒有 `.github/workflows/*.yml`，也沒有 `.husky/`；`bun run ci` 是唯一的手動把關方式，送交前必須自己跑。**覆蓋率門檻完全未設定**，與後端同一個現況。

## 引用專案慣例當理由前，先真的打開那份檔案

拿某個既有檔案的檔頭、命名或寫法當理由之前，先真的打開那個檔案，確認要引用的那句話真的在裡面。

曾經發生過的真實案例：有一份產出寫「查過 `regulatory-datasets.route.ts` 的檔頭說明，這個 repo 刻意不加路由參數段」——但那份檔頭裡根本沒有這句話，而且規範 §0.2 明文**允許**路由參數段（`.route.ts` 的 `path` 只要以 `/<段1>/<段2>` 開頭即可，後面可以接 `:id` 之類的參數段；理由是瀏覽器 URL 必須能被書籤與分享，這跟後端 API 路徑不帶參數是兩回事，見 `references/module-layout.md` §2）。

**編一個聽起來合理的依據，比老實說「不確定」更危險**——它會讓下一個人以為這是查證過的結論，然後照著錯的方向繼續蓋。找不到那句話就不要引用，改成寫自己的判斷並註明是推論、不是查證。

## 開工前：先確認要做的東西是不是已經存在

新增頁面或功能前，先在 `apps/web/src/pages/` 底下用路徑或關鍵字搜一輪，`menu/main-menu.ts` 也順便看一眼，確認真的沒有人做過。曾經發生過需求是「新增一個班別設定頁」，而 `pages/shifts/main/` 其實已經做好同一件事——重做一份不只是白工，兩份互相打架的路由或選單事後還要再花一次力氣收拾。**先搜過，確認缺口真的存在，再動手。**

確認要做的東西還沒有之後，`apps/web/src/pages/regulatory/datasets/` 是目前檔案角色最完整的一頁（總覽＋版本清單＋版本內容三段查詢），照它的形狀抄最省事：`.route.ts`／`.page.vue`／`.view.ts`／`.payload.ts`／多個 `.<主題>.view.ts` 主題拆分檔／`.<角色>.test.ts`／`components/`。`apps/web/src/pages/shifts/main/` 是另一個完整範例，多了 `.actions.ts`。兩頁都值得先讀過一輪，比從零推規則省事。

## 新增一個頁面：由外而內

順序建議是 `route → payload → view/actions → page.vue`。與後端「由下往上」的理由不同：前端沒有臆測下層介面的問題（`api/generated/` 的型別已經定死），真正容易錯的是**目錄形狀**——先把 `.route.ts` 與空的 `.page.vue` 立起來，讓 `router/registry.ts` 認得這一頁，再回頭填內容。

1. **建兩層目錄** `pages/<段1>/<段2>/`。`<段2>` 與 `<段1>` 同名時寫 `main`。目錄名就是 URL 路徑段，不是導覽分組——選單怎麼分組寫在 `menu/main-menu.ts`，不要因為想歸類就搬目錄（§0.2）。
2. **`.route.ts`**：`path` 必須以 `/<段1>/<段2>` 開頭；元件一律 `() => import('./<段1>-<段2>.page.vue')` 動態載入，字面量禁止 `../`；需要權限守衛就填 `meta.permission`，值必須與 `menu/main-menu.ts` 對應項目的 `permissionCode` 一致（§0.12、`references/module-layout.md`）。
3. **抽出的邏輯依 §1.3 四類各自進對應角色檔**：列怎麼組／狀態文字與色彩 → `.view.ts`；按鈕何時可按 → `.actions.ts`；表單值轉 payload → `.payload.ts`。不確定放哪就先看 `references/components-state-permission.md` 的對照表。
4. **`.page.vue` 只做編排**：呼叫角色檔的純函式、呼叫 `api/generated/` 的產生函式、渲染。**不要**在這裡放任何 §1.3 列的四類邏輯，也不要在頁面目錄底下建白名單以外的檔案（見上面 §0.4 一節）。
5. **測試**：對每一支角色檔寫同層的 `.<角色>.test.ts`，不建 `__tests__/` 子目錄。`.vue` 本身不寫元件測試（§8.1，見 `references/testing-and-checks.md`）。
6. **需要共用時**：先確認真的有第二個頁面在用，再搬進 `shared/`；只有一個使用者就留在頁面目錄裡（§1.5）。

## 幾條特別容易錯、而且沒有工具擋的地方

- **Element Plus 元件在 `exactOptionalPropertyTypes` 下的已知地雷**——`ElOption` 的 `value`／`label`、`ElFormItem` 的 `error`、`ElRadioGroup` 的 `modelValue` 這三處，`vue-tsc` 會擋，但錯誤訊息只會指向 Element Plus 內部的型別宣告，看不出是本專案這個 tsconfig 選項造成的，不知道就得來回 typecheck 好幾次才摸得出方向。改用 `ElTreeSelect`、`formItemErrorProp` 這種回傳「有鍵或沒有鍵」的物件、以及值域外的哨兵值三種手法繞過去，細節見 `references/components-state-permission.md` §1.6～1.7 與 `references/forms-and-lists.md` §6.3。
- **`901`（無權限）比照 `900`（未登入）導向登入頁**——會產生「登入→點到沒權限的功能→被踢回登入頁→登入→又被踢回」的無限迴圈。統一 client（`shared/api/client.ts`）已經把這兩條路分開，寫新的錯誤處理時不要自己再判斷一次 HTTP status。
- **`exp` 被撈出來顯示或拿去跟 `Date.now()` 比較**——`check:tz-leak` 擋得到大部分情形，但擋不到 `stores/` 或非 `pages/`／`shared/components/`／`shared/format/` 角落的誤用（見上表）。`exp` 唯一合法用途是寫進錯誤回報與 log；到期判斷與顯示一律用 `expiresIn` 換算的 `deadline`（`shared/api/session-deadline.ts`）。
- **金額或費率轉型顯示**——`Number(record.data.wage).toLocaleString()` 這一行型別完全合法、九成的值都對，直到某個級距邊界值才顯示成完全不對的數字，而且不報錯。`check:number-cast` 只掃 `pages/` 與 `shared/components/`，其餘角落（例如不小心把轉型寫進 `shared/format/` 以外的共用檔）掃不到。一律用 `shared/format/decimal.ts` 的 `formatAmount`／`formatRate`。
- **業務時間字串丟進 `new Date(...)`**——即使帶著完整參數（`new Date('2026-08-26 09:30:00')`）也會被瀏覽器依裝置時區重新解讀。前端規範這裡刻意比後端嚴：後端只抓零參數的 `new Date()`，前端連帶參數的都抓（見 `references/style-i18n-time.md`）。

## 交件前

跑 `bun run ci`：`check`（ESLint＋Prettier）→ `typecheck` → `gen:api` → `typecheck:web` → `check:layers`（只驗後端）→ 一串 `check:*` 掃描（含 `check:number-cast`、`check:tz-leak`）→ `test`。個別指令在擋什麼，見 `references/testing-and-checks.md`。

沒有自動檢查的那些（上面列出的、以及 §0／§1.5／§3.5／§3.6／§5／§7／§9.1 幾乎整節）**必須自己對照規範逐條核對**，不要假設 CI 會替你擋下來。

## 遇到規範沒寫到的情況

前端規範沒有像後端規範 §9 那樣明列「尚待拍板」清單，但同一個判準適用：這個做法會不會讓某條規則的 glob 靜默失去命中（§0.4 的整個理由）？會不會讓「共用區」變成沒人敢動的垃圾場（§1.5）？會不會把一個沒有標準答案的判斷留給每次 review 重問一次？三個都不會，通常就可以做，並把理由寫進 PR。真的沒把握時，先看 `apps/web/src/pages/regulatory/datasets/` 或 `apps/web/src/pages/shifts/main/` 現成的寫法，抄現成的形狀比自己推一份新的可靠。
