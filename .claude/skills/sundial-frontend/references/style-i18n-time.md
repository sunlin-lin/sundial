# 樣式、文案、時間與金額

對應 `docs/dev-standards-frontend.md` §5、§9。§9.2（時間與金額）是這一份文件裡**真正有工具在擋**的重災區——`check:tz-leak` 與 `check:number-cast` 都是掃這一節；§5（樣式）反而完全沒有工具，stylelint 不存在。

## 目錄

1. [樣式（§5）——完全沒有工具在擋](#1-樣式)
2. [文案與格式（§9.2）](#2-文案與格式)
3. [時間：字串進、字串出](#3-時間字串進字串出)
4. [金額與費率：decimal 字串進、顯示字串出](#4-金額與費率)

---

## 1. 樣式

- **Tailwind 管版面，Element Plus 管互動控制項**——這個分工照任何一頁的 `<template>` 抄就看得出來，這裡不展開；只提醒**不得用 Tailwind 重刻 Element Plus 元件的內部外觀**，也不得為了排版在 Element Plus 元件上疊 `style`。
- **顏色、間距、字級一律走 token**（Tailwind v4 `@theme` CSS 變數）。禁止 inline style 寫死色碼、禁止 CSS 出現字面色碼、禁止魔術數字尺寸。狀態色必須有具名 token，不得各頁自選相近顏色。
- **覆寫 Element Plus 樣式**：允許改 CSS 變數（`--el-color-primary` 等，全域統一設定一次）或透過元件的 `class`／`popper-class` 加自訂 class。禁止 `!important`、禁止堆疊選擇器提高權重、禁止 `:deep()` 穿透到 `.el-input__inner` 這類非公開內部結構——升級小版本、內部 DOM 一改，樣式無聲失效，通常在客戶那邊才被發現。
- **最小支援寬度 1280px**，手機端只需支援員工本人的日常自助操作，其餘管理類頁面必須讓寬表格在窄螢幕內水平捲動，不得整頁橫向溢出。

**這一整節沒有一條工具在擋。** 規範寫「stylelint 禁字面色碼」「stylelint 禁 `!important` 與 `:deep(.el-`」，但**整個 repo 沒有 stylelint 設定檔，`package.json` 裡也沒有 `stylelint` 這個依賴**——不是設定沒寫全，是這個工具鏈根本不存在。「掃描測試禁止 `.vue` 出現含 `#` 或 `px` 的 `style="` 屬性」同樣不存在。寫樣式時這幾條全部只能自己守。

## 2. 文案與格式

介面語言 zh-TW，使用者可見字串一律走 `shared/i18n/locales/zh-TW.ts` 的語系檔 key，禁止在 `.vue` 內寫死中文（`aria-label` 亦同）。金額千分位無小數（TWD），比率以百分比呈現並標明小數位，時間長度以「小時，小數一位」呈現（`170.1 小時`）。所有格式化必須經統一 format 函式，**禁止直接呼叫 `toLocaleDateString`／`toFixed`**。

「掃描測試禁止裸露中文字串」「ESLint 禁 `toLocaleDateString`／`toFixed`／`toISOString`」規範標 ✅，但**目前沒有對應的 ESLint 規則或掃描腳本**。唯一真的有工具在擋的是下面兩節的 `check:tz-leak` 與 `check:number-cast`。

## 3. 時間：字串進、字串出

**全系統一律台北時間，前端不做任何時區換算。** API 傳來的 `datetime` 就是台北牆鐘時間、格式 `YYYY-MM-DD HH:mm:ss`（無時區標記），`date` 為 `YYYY-MM-DD`。

- 顯示日期時間時**直接對字串做裁切／重排**，不要為了格式化先轉成 `Date`。`shared/format/business-date.ts` 的 `formatDate`／`formatDateTime`／`formatYearMonth` 全程字串切割，一個 `Date` 都不用。
- **禁止**把 API 回來的時間字串丟進 `new Date()`／`dayjs()` 再輸出，禁止 `toISOString()`，禁止任何 `timeZone` 參數。`new Date('2026-08-26 09:30:00')` 會被當成**瀏覽器所在時區**的時間，使用者把筆電時區設成東京，畫面上的時間就多一小時，且**不會有任何錯誤提示**。
- 需要「現在」時用 `shared/format/business-clock.ts` 的 `todayInTaipei()`，不在頁面裡各自 `new Date()`。這支用 `Intl.DateTimeFormat` 明寫 `timeZone: 'Asia/Taipei'` 逐段取值，而不是 `new Date().toISOString().slice(0, 10)`——後者在台北時間凌晨 0 點到早上 8 點之間會回**昨天**。

**三種時間格式必須分清楚：**

| 類型                       | 格式                                              | 誰負責                                          |
| -------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| 傳輸層時戳 `rqTS`／`rspTS` | ISO 8601 帶時區偏移                               | 只有統一 client 碰得到；不上畫面                |
| Session 截止時刻 `exp`     | ISO 8601 帶時區偏移                               | 只有 session 模組碰得到；禁止用於過期判斷或顯示 |
| 業務時間／日期             | `YYYY-MM-DD HH:mm:ss`／`YYYY-MM-DD`（無時區標記） | 頁面顯示與計算用                                |

**帶時區偏移的字串一律不上畫面，沒有例外。** 判準是「格式決定用途」——看到帶偏移的字串就知道它不上畫面，不必查是哪一欄；一旦有一欄被允許顯示，判準就退化成「要看是哪一欄」，那是會被記錯的東西。

**一律西元，不轉民國**（除了同步失敗原因裡照抄政府原文的那一段，那是原文照印，不經過任何格式化函式）。

### `check:tz-leak` 實際擋什麼

腳本 `apps/api/scripts/check-tz-leak.ts`，`bun run check:tz-leak`，掃 `apps/web/src`（排除 `api/generated/`）。三條規則、各自的定義域：

| 規則                            | 定義域                                                                                                                        | 判準                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `exp` 出現在顯示路徑            | 全站 `.vue`（script＋template）；`pages/`／`shared/components/`／`shared/format/` 底下的 `.ts`                                | 識別字 `exp`（`Math.exp` 排除，`expiresIn`／`expForLog` 不算）   |
| 帶時區標記的字面值              | `pages/`／`shared/components/` 底下的 `.ts`／`.vue`                                                                           | 字面值命中 `+08:00`／`-08:00`／`\dT\d\d:\d\d`／`\d\d:\d\d:\d\dZ` |
| 遊蕩的 `new Date(`／`Date.now(` | 全站，扣掉 `shared/format/`、兩個白名單檔（`shared/api/request-timestamp.ts`、`shared/api/session-deadline.ts`）、`*.test.ts` | `new Date(...)`（任何引數）或 `Date.now(...)`                    |

**這三條的定義域不是「規範說的每一個字都掃到」**：`exp` 規則之所以擴大到 `pages/` 的 `.ts`（不只 `.vue`），是因為 §1.3 把「表格列怎麼組」「狀態顯示什麼文字」指定放進 `.view.ts`，若只鎖 `.vue`，`exp` 可以先被塞進同頁的 `.view.ts` 算出一個字串、模板再印出來，`.vue` 一個 `exp` 字都不會出現，掃描全綠。

`new Date(` 規則刻意連帶參數的呼叫都抓（`new Date('2026-...')` 也算違規）——這點**與後端規範 §6.2 不同**：後端只抓零引數的 `new Date()`（那是唯一真的在讀系統時間的形狀），前端的問題不是「讀到系統時間」，而是「業務時間字串一旦經過 `Date`，輸出就會被裝置時區重新解讀」，這件事不管有沒有引數都會發生。寫新的日期相關程式碼時不要套後端那條規則的直覺。

**已知抓不到什麼**：帶時區標記字面值規則只認「字面值」，不做資料流追蹤——`formatDateTime(row.rqTS)` 這種把傳輸層時戳硬塞給格式化函式的寫法，字面上看不到任何時區標記字串，這支腳本讀不到。

## 4. 金額與費率

後端金額與費率一律是 decimal 字串，從資料庫到 API 全程不經過 `number`（勞健保級距在邊界值上會選錯級距）。前端一行就能把它全部丟掉：

```ts
Number(record.data.monthlyContributionWage).toLocaleString() // ✗ 型別完全合法，九成的值都對，直到某個邊界值
```

顯示金額或費率一律用 `shared/format/decimal.ts` 的 `formatAmount`／`formatRate`——全程字串運算（千分位靠字串切割、百分比靠小數點位移），中間沒有一個 `number`。`formatRate` 特別強調小數點位移不能寫成 `Number(value) * 100`：`Number('0.07') * 100 === 7.000000000000001`，配上 `toFixed(2)` 會顯示成 `7.00%`，看起來完全正常，而位移過的那一位在別的值上就不一定被四捨五入吃掉。

三種輸入的處置：合法 decimal 字串 → 格式化輸出；`null`／`undefined`／空字串 → `EMPTY_DISPLAY`；讀不懂的字串（`'1e5'`、`'1,000'`）→ **原樣輸出，不猜也不隱藏**。原樣輸出是刻意選的：回 `EMPTY_DISPLAY` 會讓格式變更偽裝成一筆缺資料（空白是這個系統裡的合法狀態，沒有人會去查）；拋例外會讓一列資料的問題波及其他九列；原樣輸出讓使用者看到 `1e5`，那看起來就是壞的，會被回報。

### `check:number-cast` 實際擋什麼

腳本 `apps/api/scripts/check-number-cast.ts`，`bun run check:number-cast`，**只掃兩個目錄**：`apps/web/src/pages` 與 `apps/web/src/shared/components`（後者目前不存在，目錄不存在不算失敗；兩個都不存在或掃到 0 個檔案才算失敗）。禁止 `Number(`／`Number.parseInt`／`Number.parseFloat`／`parseInt(`／`parseFloat(`／一元 `+`。`.ts` 與 `.vue` 的 `<script>` 走 AST，`<template>` 走正則（函式名後緊跟 `(` 才算，`Number.isInteger` 這類不做轉型的靜態方法不擋）。

**判準刻意不分辨「這是不是金額欄位」**——`Number(row.pageIndex)` 這種與金額無關的轉型一樣會被擋下來。這是刻意換來的：反過來設計一條「只擋金額欄位」的規則，需要跨檔案資料流分析才判斷得出「這個值來不來自 API 的金額欄位」，而做得出來的版本會很脆，脆的判準失效時是靜靜地不命中。被擋下來而確定與金額無關的轉型，正確處置是**把那個轉型移出頁面**（分頁參數解析屬於 §1.3 的第 (4) 類，本來就該在 `.payload.ts` 之外的共用層）。

**已知抓不到什麼**：只掃 `pages/` 與 `shared/components/` 這兩個目錄，`shared/format/`、`shared/api/`、`stores/` 底下若有金額轉型不會被抓到（`shared/api/` 的 `expiresIn` 本來就是後端給的 `number`，這條規則對它沒有意見）。
