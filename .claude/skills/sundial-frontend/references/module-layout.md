# 目錄結構與檔案配置

對應 `docs/dev-standards-frontend.md` §0（全文）。這是前端規範槓桿最大的一節：本文其餘章節的多條掃描規則（§3.6、§4.1、§7.3、§9.2）都以本節定義的目錄與檔名形狀當 glob 條件。**glob 命不中，規則就等於不存在，而且不會有任何東西報錯**——CI 永遠是綠的。這也是為什麼 §0.4 的頁面目錄白名單要放在最顯眼的位置。

## 目錄

1. [目錄總覽](#1-目錄總覽)
2. [頁面兩層目錄與檔名推導](#2-頁面兩層目錄與檔名推導)
3. [§0.4 頁面目錄檔案白名單——本節最重要的一條](#3-頁面目錄檔案白名單)
4. [角色檔與 §1.3 四類邏輯的對照](#4-角色檔與-13-四類邏輯的對照)
5. [`stores/` 扁平、`shared/` 兩個致命細節、`api/` 不設包裝層](#5-storesshared-與-api-的規則)
6. [`.route.ts` 的硬規則](#6-routets-的硬規則)
7. [單向分層相依（現況：沒有工具在擋）](#7-單向分層相依)
8. [新增頁面檢查清單](#8-新增頁面檢查清單)

---

## 1. 目錄總覽

```text
apps/web/src/
├─ main.ts
├─ App.vue
├─ api/generated/                       OpenAPI 產生物（不進版控，§3.2）
├─ pages/
│  └─ <段1>/<段2>/                      固定兩層；兩段就是 URL 路徑段
│     ├─ <段1>-<段2>.page.vue           路由目標，必要
│     ├─ <段1>-<段2>.route.ts           路由宣告，必要
│     ├─ <段1>-<段2>.view.ts            呈現決策純函式（選用，有內容才建）
│     ├─ <段1>-<段2>.actions.ts         動作可用性純函式（選用）
│     ├─ <段1>-<段2>.payload.ts         表單值 → 送出 payload（選用）
│     ├─ <段1>-<段2>.<主題>.{view,actions}.ts   主題拆分檔（§0.7）
│     ├─ <段1>-<段2>.<角色>.test.ts     測試與被測檔同層，不建 __tests__/
│     └─ components/PascalCase.vue      本頁私有子元件
├─ menu/                                選單資料結構；改選單不搬檔案
├─ layouts/
├─ router/registry.ts                   唯一可以 import pages/ 的地方
├─ stores/                              扁平，不得有子目錄，檔案數 ≤ 8
└─ shared/                              兩個以上頁面實際共用時才移入
   ├─ api/                              統一 HTTP client、envelope、session
   ├─ format/                           統一格式化函式
   ├─ permission/                       權限原語
   ├─ components/                       共用元件（PascalCase）
   └─ design/                           設計 token
```

**這個專案沒有 `views/`、`composables/`、`utils/`、`types/`、`locales/`。** 若你的直覺是「這段邏輯抽成一個 composable」或「這個小工具函式放進 utils」，先停下來：composable 與 utils 這兩個字在這份目錄結構裡沒有位置。純函式邏輯依 §1.3 分類進 `.view.ts`／`.actions.ts`／`.payload.ts`（頁面私有）或 `shared/format/`／`shared/permission/`（兩個以上使用者）；沒有第三種容器。

真實範例：`apps/web/src/pages/regulatory/datasets/`（三段查詢，檔案角色最完整）與 `apps/web/src/pages/shifts/main/`（多了 `.actions.ts` 與主題拆分檔 `.duration.view.ts`／`.periods.view.ts`／`.breaks.view.ts`／`.day-offset.view.ts`／`.errors.view.ts`）。兩頁都值得先讀過一輪。

## 2. 頁面兩層目錄與檔名推導

- **一律兩層，零例外。** 某個 `<段1>` 目前只有一個子頁面也要有 `<段2>`。
- **`<段1>` 與 `<段2>` 同名時，第二層寫 `main`**（`shifts/main/`）。
- **這兩層是 URL 路徑段，不是導覽分組。** `.route.ts` 的 `path` 必須以 `/<段1>/<段2>` 開頭，其後只能接路由參數段。導覽的分組、排序寫在 `menu/main-menu.ts`，**選單改版不得造成任何檔案搬動**——把便宜且常變的東西（導覽分組）跟目錄這種昂貴難改的東西綁在一起，第一次改版就會被迫二選一：搬目錄或放任目錄與選單矛盾。
- **檔名 = 所在目錄路徑**：`<段1>-<段2>.<角色>.{vue,ts}`。搬檔案忘了改名、改名忘了搬目錄，理論上會被掃描器擋——但目前**沒有腳本實作這條檢查**（見 `testing-and-checks.md`），純靠 review。
- **前綴全域唯一**：`pages/a-b/c/` 與 `pages/a/b-c/` 會推導出同一個前綴 `a-b-c`。這條也沒有腳本在擋。
- **kebab-case vs PascalCase**：被路由掛載的檔案（`.page.vue`／`.route.ts`／`.view.ts`／`.actions.ts`／`.payload.ts`）用 kebab-case，因為它們不是被模板 import 的元件；`components/` 底下與 `shared/components/` 用 `PascalCase.vue`，因為要以 `<PascalCase />` 出現在模板裡。

## 3. 頁面目錄檔案白名單

**`pages/<段1>/<段2>/` 底下只允許：**

```text
<段1>-<段2>.page.vue          必要，恰好一個
<段1>-<段2>.route.ts          必要，恰好一個
<段1>-<段2>.view.ts           選用，有內容才建
<段1>-<段2>.actions.ts        選用
<段1>-<段2>.payload.ts        選用
<段1>-<段2>.<主題>.{view,actions}.ts   主題拆分檔（§0.7）
<段1>-<段2>.<角色>.test.ts    測試，不得有 __tests__/ 子目錄
components/**/*.vue           PascalCase，本頁私有子元件
```

**這份白名單是封閉的。出現其餘任何檔名都是違規**，且違規不是「多一個不該有的檔案」這麼單純。容易被當成合理選擇、實際上全部禁止的名字：

- `helpers.ts`、`utils.ts`、`constants.ts`——§1.3 的四類邏輯已經各自有角色檔可放。
- `.gateway.ts`、`.api.ts`——本專案沒有「頁面自己的 API 包裝層」這個容器，`api/generated/` 已經是唯一入口（見本文件 §5）。
- `.composable.ts`——這個字彙在本專案的目錄結構裡沒有位置（見本文件 §1）。
- `.service.ts`——後端的分層詞彙，前端沒有對應容器。
- `impl/` 子目錄——前端角色檔只有一個消費者，沒有側門要防，不需要「入口 + `impl/`」這種結構（見本文件 §4）。

**沒有任何既有頁面會示範「不能加這個檔名」**，因為它示範的是「該怎麼寫」，不是「什麼不准寫」——這正是這條規則必須寫進文件、不能指望讀程式碼推導出來的原因。

真正的後果也不只是「這個檔案不合規」：§3.6、§4.1、§7.3、§9.2 好幾條規則都以「頁面程式碼」的 glob 為條件（例如「頁面不得出現 `'900'`／`'901'`／`'300'` 這種 code 常值」「頁面不得判斷角色」）。這些規則在工具裡的樣子是 `pages/*/*/*.page.vue`、`pages/*/*/*.view.ts` 這種 glob。只要把某段邏輯搬進白名單外的檔案，那些規則會**同時失去對這段程式碼的命中**——檔案還在、程式還跑、CI 全綠，但原本該擋住的東西已經沒人在看。

「不得建空殼」：一個角色檔存在卻是空的，等於把「這一頁有沒有把某類邏輯抽出去」這個訊號洗掉，尤其是 `.payload.ts`——payload 組裝錯誤（日期少補一段、空字串沒轉 `null`）不會報錯，只會讓後端收到形狀合法但語意錯誤的值。

⚠️ **這條規則在規範裡標 ✅（「掃描測試」），但目前沒有對應的腳本或測試檔**。全部靠 review，見 `testing-and-checks.md` 的核對結果。新增頁面時，把上面這份白名單當成一份手動檢查清單來用。

## 4. 角色檔與 §1.3 四類邏輯的對照

| 角色檔        | 對應邏輯                                                                     |
| ------------- | ---------------------------------------------------------------------------- |
| `.view.ts`    | 列怎麼組（單位換算、零值／空值呈現、衍生欄位）；狀態顯示什麼文字與色彩 token |
| `.actions.ts` | 動作可用性（資料狀態 + 前置狀態 + 權限）                                     |
| `.payload.ts` | 表單值 → 送出 payload（日期格式化、空字串轉 `null`、單位換算）               |

四類都不得寫在 `.vue` 內（模板或 `computed` 都不行）。理由與寫法見 `components-state-permission.md` 的 §1.3 一節；這裡只管「放哪一個檔案」。`.view.ts`／`.actions.ts`／`.payload.ts` 過大時**不做「入口 + `impl/`」**（前端與後端這條刻意不同，見規範 §0.7 的理由：前端角色檔只有一個消費者，沒有側門要防），改成按主題拆平鋪的兄弟檔：`<段1>-<段2>.<主題>.view.ts`。行數上限延伸適用 §1.2 的 150 行，但**這條 ESLint `max-lines` 目前沒有針對 `pages/**/*.{view,actions,payload}.ts` 設定 override**——規範寫的是要靠 lint 擋，實際上沒有。

## 5. `stores/`／`shared/` 與 `api/` 的規則

- **`stores/` 扁平，不得有子目錄；檔案數上限 8。** 沒有子目錄本身好檢查（目錄掃描），但「檔案數 ≤ 8 且指向 §2.1 判準」的掃描測試不存在。上限的意義：一旦有人想開子目錄，代表 store 數量已經超過 §2.1 允許的量（跨頁共用 ∧ 有生命週期 ∧ 不是可重取的清單快照，見 `components-state-permission.md`）。
- **`shared/` 禁止 `index.ts` barrel。** Barrel 會讓所有 import 變成 `from '@/shared'`，於是「誰用了哪一個模組」在計數掃描上一起報廢——§1.5「共用區模組要有兩個以上使用者」那條規則會整條歸零，而且全綠。這條同樣沒有掃描腳本，純靠 review 擋住第一個想順手加 barrel 的 PR。
- **共用去重鍵是「頁面根目錄」，不是檔案。** 同一頁的 `.page.vue` 與 `.view.ts` 算同一個使用者，不是兩個——用檔案計數會讓「共用」這件事在任何一頁內部就能造假地成立。
- **`api/` 底下只允許 `generated/`，不建手寫的 `api/<領域>/*.api.ts` 包裝樹。** 因為所有端點都是 POST、無路徑參數、無 query，產生的 client 函式每支都只有一個參數、簽章統一——再包一層只是抄一份後端結構的副本，換不到型別安全。

## 6. `.route.ts` 的硬規則

1. **只能以 `() => import('./<段1>-<段2>.page.vue')` 惰性載入**，禁止靜態 import。靜態 import 會讓 `router/registry.ts` 的 eager glob 把全站每一支 `.page.vue` 拉進入口 chunk——型別對、測試綠、畫面正常，唯一症狀是 bundle 從幾百 KB 變成幾 MB，而且沒有人在每次 PR 上看這個數字。**這是本節最大的單一風險。**
2. **`.route.ts` 與 `.page.vue` 必須雙向成對。**
3. **動態 import 字面量必須指向同目錄，禁止 `../`**——擋住複製貼上忘了改路徑，否則兩條路由可能指向同一個 `.page.vue`，兩頁都「有路由」，但其中一頁的使用者永遠打不開。

真實範例見 `apps/web/src/pages/regulatory/datasets/regulatory-datasets.route.ts`：`meta.permission` 要與 `menu/main-menu.ts` 對應項目的 `permissionCode` 完全一致——選單負責藏入口，`.route.ts` 負責擋直接貼網址與過期的書籤，兩邊不一致的後果不對稱（選單填錯讓有權限的人看不到入口；路由填錯才會擋錯人）。

**唯一真的在擋的自我檢查**：`router/registry.ts` 用 `import.meta.glob('../pages/*/*/*.route.ts', { eager: true })` 蒐集路由，蒐集結果為 `0` 就直接 `throw`。這是**執行期**檢查（應用程式啟動時跑），不是 CI 掃描腳本；「registry 載入後的路由數必須等於檔案系統掃到的 `.route.ts` 數，且由兩種不同機制產生」這條規範寫的完整版本目前沒有實作，只有「不得是 0」這一半。

## 7. 單向分層相依

規範 §0.11 定的方向：

```text
shared/                不得 import  pages/、stores/、layouts/
stores/                不得 import  pages/、layouts/
api/                   只能 import  api/generated/、shared/api/
router/                是唯一可以 import pages/ 的地方
pages/<段1>/<段2>/     內的檔案只能被同目錄、以及 router/registry.ts import
全樹                   禁止循環相依
```

**這一整節目前沒有任何工具在擋。** 規範指定的檢查手段是 dependency-cruiser，但 `check:layers` 只跑 `depcruise --config .dependency-cruiser.cjs apps/api/src`（見根 `package.json`），`.dependency-cruiser.cjs` 整份設定檔裡沒有一條規則涉及 `apps/web`。連 `apps/web/tsconfig.json` 自己的註解都寫著「§0.11 的分層相依由 dependency-cruiser 依目錄關係判定」——那句註解目前是錯的。

寫程式碼時只能自己守：`shared/` 底下的檔案 import 前先想一下對面是不是 `pages/` 或 `stores/`；`api/generated/` 的產生函式只該被頁面呼叫，不該反過來被 `shared/` 或 `stores/` import 出去再轉手。循環相依在 Vite 底下大多不報錯，症狀是「某個模組初始化時是 `undefined`」，只在特定進入順序下發作，本機開發通常碰不到，正式環境的 chunk 切分一改，發作的頁面就換一批——這類 bug 事後很難查，值得在寫的當下就多想一步。

## 8. 新增頁面檢查清單

- [ ] `pages/<段1>/<段2>/` 兩層，`<段2>` 與 `<段1>` 同名時為 `main`
- [ ] `.route.ts` 的 `path` 以 `/<段1>/<段2>` 開頭，元件動態 import 指向同目錄的 `.page.vue`
- [ ] 目錄底下的檔名只在 §3 的白名單內，沒有 `helpers.ts`／`utils.ts`／`impl/`
- [ ] §1.3 四類邏輯各自進對應角色檔，沒有留在 `.vue` 的 `computed` 或模板裡
- [ ] 每個角色檔有同層的 `.<角色>.test.ts`，沒有 `__tests__/` 子目錄
- [ ] `meta.permission`（若有）與 `menu/main-menu.ts` 對應項目的 `permissionCode` 一致
- [ ] 只在真的有第二個頁面使用時才把東西搬進 `shared/`
- [ ] 沒有手寫 API 包裝層，直接用 `api/generated/` 的產生函式
