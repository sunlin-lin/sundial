# 元件撰寫、狀態管理、權限與畫面

對應 `docs/dev-standards-frontend.md` §1、§2、§4。

## 目錄

1. [元件撰寫（§1）](#1-元件撰寫)
2. [狀態管理（§2）](#2-狀態管理)
3. [權限與畫面（§4）](#3-權限與畫面)

---

## 1. 元件撰寫

### 1.1 `<script setup lang="ts">`，型別化 props/emits

一律 `<script setup lang="ts">`、`defineProps<T>()`／`defineEmits<T>()` 泛型宣告、預設值走 `withDefaults`——這是抄 `regulatory/datasets` 或 `shifts/main` 任一支 `.page.vue` 就看得出來的慣例，這裡不展開。

唯一容易漏掉、而且看單一頁面看不出後果的地方：**少了 `lang="ts"` 的 `<script>` 區塊，`vue-tsc` 完全不檢查它**。ESLint 掛的是 `vue.configs['flat/recommended']`，`vue-tsc` 跑兩份 tsconfig（`tsconfig.json`＋`tsconfig.test.json`），兩者都以「這是一段 TS」為前提；漏寫 `lang="ts"` 的區塊型別錯誤會直接進 production，而且沒有任何檢查會提醒你少寫了這個屬性。

### 1.2 元件職責上限

`<script setup>` 超過 150 行或 `<template>` 超過 200 行必須拆；元件同時負責「查詢條件／列表／明細彈窗」三件事以上、或有兩組以上互不相干的 loading／error 狀態、或模板三層以上 `v-if` 巢狀，無論行數都要拆。

⚠️ **這條規範標 ✅ 要靠 `max-lines` 與模板深度規則擋，但 `eslint.config.js` 的 `apps/web` 區塊沒有設定 `max-lines`**——目前完全靠 review。

### 1.3 呈現決策必須抽成純函式

以下四類邏輯**不得**寫在 `.vue` 內（模板或 `computed` 都不行），必須抽成不依賴 Vue 的純 TS 函式，並依 `module-layout.md` §4 的對照表放進對應角色檔：

1. 表格列怎麼組——單位換算、零值或空值的呈現方式、衍生欄位的推導 → `.view.ts`
2. 狀態顯示什麼文字與顏色 token → `.view.ts`
3. 按鈕何時可按——資料狀態 + 前置狀態 + 權限 → `.actions.ts`
4. 表單值轉送出 payload——日期格式化、空字串轉 `null`、單位換算 → `.payload.ts`

理由：本專案**不做 `.vue` 元件測試**（`testing-and-checks.md` §8.1），邏輯留在模板或 `computed` 裡就等於零測試覆蓋。而這四類邏輯最容易出錯又最不容易一眼看出錯——「某個狀態下本該停用的操作還亮著」不會報錯，只會讓使用者按下去吃一個 403。抽成純函式後，「狀態 × 前置狀態 × 權限」的操作矩陣可以逐格寫成測試。

```ts
// ✅ 純 TS，可逐格測整張操作矩陣（.actions.ts）
export function availableActions(
  status: RecordStatus,
  locked: boolean,
  can: (p: Permission) => boolean,
): RecordAction[] {
  /* ... */
}

// ❌ 埋在模板裡，永遠不會有測試碰到它
// <el-button v-if="row.status === 1 && !locked && isManager">執行</el-button>
```

### 1.4 模板禁止複雜運算式

模板內只允許屬性存取、單一函式呼叫、單一比較，禁止巢狀三元、算術、字串拼接與 `.filter().map()` 鏈。

⚠️ **規範要求 `vue/no-complex-template-expression` 設為 error，但 `eslint.config.js` 沒有開這條規則**——靠 review。

```vue
<!-- ✅ -->
<span>{{ formatWorkedHours(row.workedMinutes) }}</span>
<!-- ❌ -->
<span>{{ row.workedMinutes ? (row.workedMinutes / 60).toFixed(1) + ' 小時' : '—' }}</span>
```

### 1.5 頁面私有 vs 共用區

頁面私有的呈現邏輯與子元件放頁面自己的目錄，**只有被兩個以上頁面實際共用時才移入 `shared/`**，移入時才改 import，不預先放。「先放共用區以備不時之需」是共用區變垃圾場的標準路徑：東西一旦放進共用區，沒有人知道還有沒有人用（刪不掉）、沒有人敢改它（怕影響別人）、它會開始長參數（第二個頁面來用時加 `mode`，第三個再加 `compact`）。

去重鍵是「頁面根目錄」，不是檔案（`module-layout.md` §5）。這條與 §0.11 的分層相依一樣，**dependency-cruiser 沒有覆蓋 `apps/web`**，「共用模組至少兩個使用者」這條掃描測試不存在，靠 review。真實範例：`shared/api/list-echo.ts` 的檔頭寫明「第一個列表頁出現時只有一個使用者，留在頁面目錄裡；第二個列表頁出現時才搬過來」，可以照這個判斷時機抄。

## 2. 狀態管理

### 2.1 進 Pinia 的判準

同時滿足三點才進 store，否則留在元件內的 `ref`：

1. 跨頁共用——至少兩個路由讀同一份
2. 有生命週期——需在登入時建立、登出或切換公司時清除
3. 不是可重取的清單快照

本專案符合的大致只有：登入身分與所屬公司、權限碼集合、全域偏好、跨頁共用的主檔字典。**把列表資料放進全域 store 是本專案最容易犯的過度設計**——清單一旦進 store，「誰負責清掉它」的問題就出現：從列表進明細再返回看到舊資料、切換公司後看到別家公司的資料。留在元件內時，元件卸載即消失，這類 bug 從結構上不存在。

```ts
// ✅ 查詢條件與結果留在頁面元件內
const rows = ref<RecordRow[]>([])
// ❌ 列表結果進全域 store，離開頁面沒人清
export const useRecordStore = defineStore('record', () => ({ list: ref<Record[]>([]) }))
```

### 2.2 store 的命名與結構

一律 setup store，store id 與檔名同名（小寫單數領域名詞：`auth`、`permission`、`directory`），composable 命名 `useXxxStore`。對外只暴露 `readonly` 狀態與具名 action，禁止把可寫 `ref` 直接 return。每個 store 必須提供 `reset()`，並在登出與切換公司時被呼叫。

真實範例 `apps/web/src/stores/auth.ts`：`isSignedIn`／`displayName`／`can` 都是 `computed` 或函式，只有 `signIn`／`restoreOnce`／`reset` 是可呼叫的 action，沒有任何可寫 `ref` 被直接 return。`reset()` 只清 `identity`，刻意**不**清 `restoreAttempt`（登出後 refresh 票已作廢，重新探測只是浪費一次往返；檔頭有寫明這個決定）。

⚠️ 命名、setup 寫法、`reset()` 存在性規範標 ✅ 要靠掃描測試擋，**目前沒有這支測試**，靠 review。

## 3. 權限與畫面

### 3.1 權限判斷只能用單一組原語

全站只透過 `can(code)`／`canAny(codes)`／`canAll(codes)`／`scope(resource)` 判斷權限，權限碼是型別化聯集而非字串。禁止在頁面內讀角色名稱、比較 `role.code === 'HR_MANAGER'`、`roles.includes(...)`、`user.isAdmin`。

**這一輪只有 `can` 有消費者**，`shared/permission/permission.ts` 檔頭誠實記下：三支沒呼叫端的函式不是「先準備好」，是三條永遠不會被執行的規則（測試綠燈只證明函式本身沒寫錯，不代表任何畫面因此更正確）。`scope(resource)` 還缺一個更基本的東西——後端沒有資源層級的範圍模型，現在硬寫只能是一個猜出來的簽章，真正需要時會被整支重寫。**新增權限判斷時只補 `can`，不要因為規範列了四支就一次補齊四支空殼。**

```ts
const canApprove = can('<資源>.approve') // ✅
const canApprove = auth.user.roles.some((r) => r.code === 'MANAGER') // ❌
```

`shared/permission/permission.ts` 是純函式（`hasPermission(granted, code)`），不吃任何 ambient state——§0.11 禁止 `shared/` import `stores/`，所以「目前使用者有哪些權限碼」由 `stores/auth.ts` 持有，並把這支純函式綁成 `can`。這個切法讓判斷邏輯可以逐格測（不需要 Pinia、不需要 app context），同時維持相依方向只有一個。

### 3.2 前端隱藏 ≠ 權限控制

`v-if="can(...)"` 只是體驗優化，每一支被隱藏按鈕對應的 API 後端都要各自檢查權限與業務狀態。前端 bundle 是公開的，權限碼集合在瀏覽器裡可改。

**本系統不做敏感操作的重新驗證（step-up authentication）**——不得實作「請再次輸入密碼以繼續」的流程。要限制某個操作，唯一手段是隱藏／停用＋說明，實際把關一律在後端。改密碼成功後 client 必須立即清掉記憶體中的 access token 並導回登入頁，不得停留在原頁面繼續發請求（那些請求一定回 `900`）。

### 3.3 無權限時：隱藏 vs 停用 vs 提示

| 情況                   | 表現                       |
| ---------------------- | -------------------------- |
| 使用者永遠不會有此權限 | 隱藏，路由不進選單         |
| 有權限但當下狀態不允許 | 停用 + tooltip 說明原因    |
| 有權限但資料未就緒     | 停用 + loading，不顯示錯誤 |

禁止以停用取代隱藏（滿畫面永遠按不了的按鈕）、以隱藏取代停用（按鈕突然消失，使用者不知發生什麼事）、無說明的停用。這幾條全部靠 review，沒有掃描腳本。
