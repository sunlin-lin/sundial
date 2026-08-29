# API 呼叫、Envelope 與 Session

對應 `docs/dev-standards-frontend.md` §3（全文）。這一章管的是「怎麼跟後端說話」，核心是一件事：**所有 HTTP 都經過 `apps/web/src/shared/api/client.ts` 的 `callApi`，頁面永遠只拿到 `data` 或一個型別化的錯誤，碰不到 envelope 的其餘欄位。**

## 目錄

1. [Envelope 與六個 code](#1-envelope-與六個-code)
2. [依 code 分支：一律在 client 內做一次](#2-依-code-分支)
3. [型別化錯誤，不是 `AxiosError`](#3-型別化錯誤)
4. [Session：`expiresIn` 是滑動視窗，`exp` 不得上畫面](#4-session)
5. [Single-flight refresh](#5-single-flight-refresh)
6. [API 型別一律 OpenAPI 產生，禁止手寫 DTO 與 import 後端程式碼](#6-api-型別一律-openapi-產生)
7. [載入中／錯誤狀態](#7-載入中錯誤狀態)

---

## 1. Envelope 與六個 code

分類軸是「前端拿到之後該做什麼」，不是 HTTP 語意（後端規範 §1.3）。`shared/api/envelope.ts` 定義了六個 `WEB_FLOW_CODE`：

| `code` | 處置                                                                                         |
| ------ | -------------------------------------------------------------------------------------------- |
| `200`  | 正常，回 `data` 給呼叫端                                                                     |
| `900`  | 導向登入頁（帶回跳網址）                                                                     |
| `901`  | 顯示「無權限」，**絕對不可導登入頁**                                                         |
| `300`  | 業務錯誤：讀 `errors`，逐筆顯示 `msg`，並依 `errors[].data.field` 定位到該列該格標紅（§6.3） |
| `100`  | 一律當系統錯誤，不對使用者顯示細節（呼叫端沒照契約送資料，是我們的 bug）                     |
| `400`  | 一律當系統錯誤，不對使用者顯示細節                                                           |

`901` 若比照 `900` 導向登入頁，會產生「登入 → 點到沒權限的功能 → 被踢回登入頁 → 登入 → 又被踢回」的無限迴圈，使用者會認為系統壞掉。這是後端刻意把「無身分」與「有身分但無權限」分成兩個 `code` 的原因，前端必須把這兩條路分開走——`shared/api/client.ts` 的 `resolveEnvelope` 已經把這件事做對，寫新的錯誤處理**不要**再自己判斷一次。

`100` 代表呼叫端違反契約，後端在這個 code 不提供 `errors`，前端也沒有東西可以顯示給使用者——當成表單錯誤顯示只會讓使用者對著一個他改不動的欄位反覆嘗試。

## 2. 依 code 分支

**全站只在 `shared/api/client.ts` 的 `resolveEnvelope` 做一次分支**，頁面不得自行判斷 HTTP status（`err.response.status === 401` 之類禁止）也不得比對 `code` 字面值。這條規範標 ✅（「掃描測試禁止頁面出現 `'900'`／`'901'`／`'300'` 等 code 常值」），但**目前沒有對應的腳本或 ESLint 規則**，靠 review。

收到回應時的順序是**先無條件覆寫 session `deadline`，再依 `code` 分支**——`client.ts` 的 `sendEnvelope` 把 `renewSessionDeadline(envelope.expiresIn)` 放在依 code 分支之前，理由見下一節。

## 3. 型別化錯誤

`shared/api/api-error.ts` 定義四個類別，對應 §3.6 的四種前端動作（不是四種伺服器狀態）：

- `BusinessRuleError`：`code='300'`，帶 `errors`（含 `data.field` 的 dot-path）。
- `AuthRequiredError`：`code='900'`。client 拋出前已清掉記憶體中的 access token。
- `PermissionDeniedError`：`code='901'`。**絕對不能被當成 `AuthRequiredError` 處理。**
- `SystemFailureError`：`code='100'`／`'400'`，或回應根本不是 envelope。帶 `diagnosticCode` 與 `expForLog`（`exp`，唯一用途是寫進錯誤回報，變數命名刻意帶 `ForLog` 提醒不得用於顯示或過期判斷）。

不讓 `AxiosError` 流出去的理由：畫面上會出現 `Request failed with status code 422`，對使用者完全不可讀；而且頁面一旦看得到 HTTP status，就會開始自己判斷 `status === 401`，那正是要擋掉的東西。

`shared/api/load-failure.ts` 把「載入失敗」再分兩種：`PermissionDeniedError` → 不給重試鈕、顯示後端回來的那句話；其餘 → 只給重試，細節不顯示。這個分流方式在一頁裡有多段查詢時（如 `regulatory/datasets` 的總覽／版本清單／版本內容）必須完全一致——同一個 `901` 在 A 段不給重試鈕、在 B 段給一顆按下去必然再失敗一次的重試鈕，使用者會以為是網路問題然後一直按。

## 4. Session

`shared/api/session-deadline.ts` 是整套規則的落地：

```ts
// 收到回應時無條件覆寫，expiresIn === null 表示本次請求未經 session 授權，不代表登出
export const renewSessionDeadline = (expiresIn: number | null): void => {
  if (expiresIn === null) return
  deadline = Date.now() + expiresIn * 1000
}
```

- **只用 `expiresIn` 換算 `deadline`，永遠不用 `exp`。** 兩者比較的兩端來源不同：`exp` 是伺服器算出的截止點，要拿去跟裝置的現在時刻比——使用者的筆電慢 10 分鐘，判斷就錯 10 分鐘，且伺服器端完全看不出來也重現不了。`deadline` 由 `Date.now()` 算出、又拿 `Date.now()` 去比，裝置時鐘的偏移在相減時抵銷。
- **這是滑動視窗，不是固定到期時間。** `100`／`300`／`400`／`901` 的回應全部帶續期後的 `expiresIn`，**只有 `900` 是 `null`**。收到就無條件覆寫——不保留第一次的值、不取較小值、不自己每秒遞減。把覆寫寫進成功分支會讓使用者每點一次沒權限的功能就少活一次續期，最後在一連串正常操作中被登出；這也是為什麼覆寫要放在依 `code` 分支**之前**。
- **`exp` 連顯示都不行，零例外。** 唯一用途是寫進錯誤回報與 log。倒數 UI（若有）只能是 `deadline - Date.now()` 的即時投影，不能自己跑一個每秒 −1 的計數器（那會把還活著的 session 判成過期）。
- `exp` 的顯示路徑掃描見 `check:tz-leak`（`testing-and-checks.md`），但那支腳本的定義域**不含** `stores/`——`shared/api/session-deadline.ts` 與 `stores/auth.ts` 若誤用 `exp` 不會被這支腳本抓到，只能靠 review。

## 5. Single-flight refresh

`shared/api/client.ts` 的 `refreshOnce`：

```ts
const refreshOnce = (): Promise<boolean> => {
  refreshInFlight ??= runRefresh()
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}
```

一個頁面初始化時同時打三支查詢很常見，三支同時撞到 access token 過期也很常見。各自去 refresh 的話，第二、第三支拿的是已經被第一支換掉的舊票——後端的 refresh token 是一次性輪替＋偷用偵測（後端規範 §5.4.2），會判定為外洩，直接讓整條鏈作廢，使用者在一次完全正常的開頁動作中被踢回登入頁。而且**錯誤現場當場消失**：重登之後一切正常，log 上只有一次偷用偵測，沒有人重現得出來。

`.finally` 的清除必須等 refresh 真的結束（成功或失敗）才做，提早清掉就等於沒有收斂。

**這是全文少數靠行為斷言而非靜態掃描的檢查**，因為「有沒有收斂」看程式碼形狀看不出來，只看得出跑起來發了幾次。`shared/api/client.test.ts` 用 `replaceTransport` mock 底層傳輸，同時發三支請求，斷言只打出一次 `/sessions/main/refresh` 且三支都拿到成功結果——這條**真的在 `bun test` 裡跑**，寫類似邏輯時可以照抄這支測試的手法（mock 傳輸層而不是 mock client 本身，否則等於在測 mock）。

## 6. API 型別一律 OpenAPI 產生

- **禁止在前端手寫描述 API 形狀的 `interface`／`type`**，禁止 `as any`／`as unknown as T` 繞過，禁止手改 `api/generated/` 底下的產生物（不進版控，重跑 `gen:api` 就沒了）。所有請求／回應型別來自 `bun run gen:api` 產出的 `api-types.ts`／`api-client.ts`。
- **禁止以任何形式 import 後端 workspace（`apps/api`）的型別、常數或程式碼**——不得跨 workspace import、不得相對路徑上溯、不得經第三方套件轉手 re-export。唯一允許跨界的是產生物。理由：前後端即使同 repo 也是兩個獨立部署的系統，一旦前端 import 得到後端內部型別，「編譯通過」就不再代表「API 相容」——後端一次內部重構就讓前端 build 失敗，兩邊被迫綁死。
- **產生的 `api-client.ts` 必須注入統一 client**，禁止用產生器的預設 fetcher。`check:api-artifacts` 會驗這件事（見 `testing-and-checks.md`），這是這兩條規則裡少數真的有工具在擋的部分。
- **§0.11／§3.5 的「dependency-cruiser 禁止前端 import 後端」目前沒有實作**——`.dependency-cruiser.cjs` 完全不掃 `apps/web`（見 `module-layout.md` §7）。手寫 DTO 與 import 後端程式碼這兩件事現在都只能靠 review。

## 7. 載入中／錯誤狀態

非同步取數的三態（`loading`／`error`／`data`）怎麼寫，照現成頁面抄；錯誤必須是 client 轉換後的型別化錯誤，不是原始 `AxiosError`，這點在 §3 已經講過。這裡只記一個容易犯、而且看單一頁面不見得看得出後果的地雷：

`onMounted` 的 callback **不得是 `async`**，也不得呼叫一個回傳 promise 卻未處理的函式——`onMounted(async () => ...)` 拋出的例外是 unhandled rejection，Vue 的 `errorHandler` 抓不到，畫面停在 loading，使用者看到空白頁且沒有重試入口。

```ts
// ✅ load() 內部自行 try/catch 並設定 error 狀態
onMounted(() => {
  void load()
})
```

這條靠 `@typescript-eslint/no-floating-promises`（`error`）擋，是真的有工具在跑的少數幾條之一——但同規範要求的 `no-misused-promises` 沒有開（見 SKILL.md 的核對表），漏接的 promise 型 misuse 有一半靠這條、有一半沒人擋。
