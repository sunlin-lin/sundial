# 測試規範與自動化檢查

寫測試與跑檢查前先讀這份。摘要：測試一定要打 HTTP 入口，不能直接呼叫 `impl/`；每個測試自建公司與員工做隔離；覆蓋率門檻與大部分「自製掃描腳本」**目前沒有實際程式碼**，不要以為文件寫了就有檢查在擋；本機沒有 git hook、也沒有 CI 工作流程檔，`bun run ci` 是唯一的把關方式，必須手動執行。對應規範：`docs/dev-standards-backend.md` §7～§9、`docs/dev-standards-general.md` §7。

## 目錄

1. 一定要寫的測試 vs 不必寫的測試
2. 測試不可繞過正式流程
3. 測試資料隔離的實際做法
4. 覆蓋率門檻與路徑自檢（現況：未實作）
5. 指令清單
6. §8 檢查一覽 vs 實作現況對照表
7. §9 尚待拍板
8. 交件前檢查清單

---

## 1. 一定要寫的測試 vs 不必寫的測試

判準見 `dev-standards-backend.md` §7.1／§7.2。逐項落地方式：

### 1.1 一定要寫

- **金額／時間長度／額度／法規級距的計算邏輯**：純函式單元測試，覆蓋邊界值（起訖、跨日、閏年、臨界值、級距上下限）。
  真實範例 `apps/api/src/modules/shifts/main/__tests__/shifts-main-domain.test.ts`：跨日班（22:00–06:00）換算成絕對分鐘、含無薪休息時的應工作分鐘扣除，都是獨立測項，不打 HTTP。
- **每個對外端點**：至少五條——成功、業務規則不允許、無權限、目標不存在、跨公司存取。
  跨公司存取那條**不能各自硬編期望值**，要跟目標不存在那條的回應逐項比對：

  ```ts
  // apps/api/src/modules/departments/main/__tests__/departments-main.endpoints.test.ts
  const crossCompany = await call('/departments/main/get', companyB.token, { id: created.payload.data.id })
  const notFound = await call('/departments/main/get', companyB.token, { id: crypto.randomUUID() })

  expect(crossCompany.status).toBe(notFound.status)
  expect(crossCompany.payload.code).toBe(notFound.payload.code)
  expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
  expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
  ```

- **一次違反兩條規則**：斷言 `errors` 同時回兩筆、各自 `code` 都在宣告清單內，且各自帶對應的 `field`／索引。

  ```ts
  // apps/api/src/modules/roles/main/__tests__/roles-main.endpoints.test.ts
  expect(created.payload.errors).toHaveLength(2)
  expect(created.payload.errors[0]?.code).toBe(RoleErrorCode.PermissionNotFound)
  expect(created.payload.errors[0]?.data?.['field']).toBe('permissionIds.1')
  expect(created.payload.errors[1]?.code).toBe(RoleErrorCode.PermissionNotAssignable)
  expect(created.payload.errors[1]?.data?.['field']).toBe('permissionIds.2')
  ```

  純函式層也要有對應版本（同一條規則兩層都測，職責不同：純函式測「算得對不對」，端點測「service 真的有呼叫」）：
  `apps/api/src/modules/company-users/roles/__tests__/role-assignment-plan.test.ts` 的 `一次違反兩條規則：errors 同時回兩筆，且各自帶自己的索引`。

- **狀態機轉移**：每個不允許的轉移各一條測試。範例：`employments-main.endpoints.test.ts` 對已離職的任職再次呼叫 `/leave`，斷言回 `422` 與 `already-left`。
- **併發衝突**：狀態變更端點至少一條「兩個使用者同時操作同一筆，第二筆被拒」。**這條必須真的打兩個資料庫連線，不能用假 clock／假 repository 模擬**，理由與寫法見下一節。

### 1.2 不必寫

純轉發的 mapper、Drizzle schema 定義、常數表、框架本身行為——改壞了型別檢查會擋下，測試只是重複描述實作。不要為 `db/schema/*.ts` 或純 re-export 的 `index.ts` 寫測試。

---

## 2. 測試不可繞過正式流程

- **禁止直接改 DB 欄位製造前置狀態**，凡有對應正式流程（API 或 service 函式）一律走該流程。

  ```ts
  // ❌ 錯誤：直接關掉強制改密碼旗標，那道閘門壞了測試依然全綠。
  await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, id))
  // ✅ 正確：走正式的變更密碼流程，順便驗證閘門還活著
  await api.post('/credentials/main/update', { currentPassword, newPassword })
  ```

- 例外：製造「無法由正式流程產生」的髒資料（舊版遺留狀態）可直接寫入，**但要註明理由**。實際案例是「建立公司／使用者／company_user」——這幾張表目前沒有從零開始的正式建立流程可呼叫（建員工的端點要求呼叫者已登入且已有權限碼），所以測試 fixture 直接 `database.insert(...)`。每個這樣做的測試檔開頭都要有類似的註解，例如 `employments-main.concurrency.test.ts`：

  > `companies`／`users`／`company_users`／`employees` 目前沒有從零開始的正式流程可以呼叫……只能直接寫入。

- **禁止 mock 掉被測邏輯本身**。併發鎖測試尤其要注意：

  ```ts
  // apps/api/src/modules/employments/main/__tests__/employments-main.concurrency.test.ts
  // 不得 mock 掉 repository 或 db.transaction（§7.3）：這幾條測試的全部價值就在於驗真的有鎖住。
  const [outcomeA, outcomeB] = await Promise.all([
    createEmployment(context, { employeeId, employmentTypeCode: 1, hireDate: '2024-01-01' }),
    createEmployment(context, { employeeId, employmentTypeCode: 1, hireDate: '2024-06-01' }),
  ])
  const succeeded = [outcomeA, outcomeB].filter((r) => r.ok)
  const failed = [outcomeA, outcomeB].filter((r) => !r.ok)
  expect(succeeded.length).toBe(1) // 恰好一個成功、一個失敗
  expect(failed.length).toBe(1)
  ```

  純邏輯測試測不出這件事：兩個「並發」呼叫在同一個 process 內跑，本來就不會真的競爭同一列；只有對真 MariaDB 開兩個連線才會暴露 `FOR UPDATE` 鎖錯位置的 bug。

- **端點測試打的是 HTTP 入口，不是 `impl/`**：組出一個掛好 `identityGuard`／`responseEnvelope` 的 Elysia app，用 `app.handle(new Request(...))` 呼叫，不要 `import { createEmployment } from '../impl/...'` 之後直接呼叫實作切片（那正是 dependency-cruiser 要擋的 `impl-only-from-own-entry-file`）。併發測試是唯一允許呼叫入口 service 函式（`employments-main.service.ts` 的 `createEmployment`）而不打 HTTP 的情況，因為它要拿到 `{ ok, error }` 這種內部回傳值而非 envelope；即便如此，呼叫的仍是入口檔（`*.service.ts`），不是 `impl/` 裡的切片。

---

## 3. 測試資料隔離的實際做法

專案採用的是 §7.4 兩個選項裡的「每個測試用新公司隔離」，不是交易回滾：

```ts
// apps/api/src/modules/employments/main/__tests__/employments-main.endpoints.test.ts
const registerCompanyWithEmployee = async (): Promise<{ companyId: string; token: string; employeeId: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  // ……insert companies / users / companyUsers / employees，全部用 crypto.randomUUID() 產生 id
  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20), // 隨機後綴避免代碼碰撞
    name: `測試公司-${companyId.slice(0, 8)}`,
    // ……
  })
  identityByToken.set(token, { sessionId: crypto.randomUUID(), userId, companyId, companyUserId })
  return { companyId, token, employeeId }
}
```

每個 `test(...)` 都先呼叫這種 `registerCompany*` 輔助函式建自己的公司，**不共用同一筆 fixture**。身分驗證用記憶體內的 `Map<token, VerifiedIdentity>`（`identityByToken`）當替身，因為 token 驗證與權限查詢屬於 `sessions`／`company-users` 模組，不是被測模組的職責（§7.3 的替身邊界）。

### 3.1 跨模組 fixture 怎麼組

測「依部門查在職員工」這類要串 `employees`／`departments`／`employments` 三個大目錄的案例，
fixture 套用的是 §7.3「測試不可繞過正式流程」同一條判準：**能呼叫的正式業務動作一律呼叫，不直接
寫資料庫**——繞過去寫的資料可能是正式流程永遠不會產生的狀態，漏檢查一個必填關聯、漏寫一筆稽核都
測不出來。呼叫順序照實體的依賴方向：先有公司與部門，才能有員工，才能有任職，才能有「任職 × 部
門」這種關聯記錄。跨大目錄一律經對方的 `index.ts`（`references/module-layout.md` §3），不得
import 到對方內部檔案。

真實範例（`apps/api/src/modules/employments/department-histories/__tests__/employments-department-histories.endpoints.test.ts`
的 `registerFixture`）示範了串接手法：先建立任職，再拿剛建立的 `employmentId` 建部門歷史，兩次呼
叫共用同一個 `fixedClock`，各自組各自模組的 context 型別，回傳值先判斷 `.ok` 再往下用（fixture 組
裝階段要早失敗，訊息裡帶「測試固定資料準備失敗」，不要讓後面的斷言用 `undefined` 撞出看不懂的錯
誤）：

```ts
const employmentContext: EmploymentsMainContext = {
  db: database,
  clock,
  companyId,
  operatorCompanyUserId: companyUserId,
}
const employmentResult = await createEmployment(employmentContext, {
  employeeId,
  employmentTypeCode: 1,
  employmentNatureCode: null,
  hireDate: '2024-01-01',
})
if (!employmentResult.ok) throw new Error('測試固定資料準備失敗：建立任職沒有成功')

const historyContext: DepartmentHistoriesContext = {
  db: database,
  clock,
  companyId,
  operatorCompanyUserId: companyUserId,
}
const historyResult = await createDepartmentHistory(historyContext, {
  employmentId: employmentResult.value.id,
  departmentId,
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
})
if (!historyResult.ok) throw new Error('測試固定資料準備失敗：建立部門歷史沒有成功')
```

該範例裡 `companies`／`users`／`company_users`／`employees` 仍是直接寫入——這四張表目前沒有從零
開始的正式流程可呼叫（§2 已說明的既有例外）。但**部門其實已經有 `createDepartment` 這條正式流程**
（`departments/main/impl/departments-main.create.service.ts`，經 `departments/index.ts` 匯出），
這支既有測試對部門仍是直接寫入，不是照這條判準抄出來的範例——新寫 fixture 若需要部門，應改呼叫
`createDepartment(...)`，不要照抄這一段的部門那半。

### 3.2 固定「現在」

不要在測試裡用真的 `new Date()`，用 `fixedClock`：

```ts
import { fixedClock } from '../../../../shared/clock.ts'
/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))
```

`fixedClock` 定義在 `apps/api/src/shared/clock.ts`（`export const fixedClock = (instant: Date): Clock => clockFrom(() => instant)`）。UTC `04:00:00` 對應台北 `12:00:00`，這是專案的慣例寫法，時間一律以 UTC 字面值寫、註解寫台北時間。

### 3.3 資料庫連線與守衛

測試不自己組連線字串常數，而是讀環境變數，且**守衛在 `bun test` 的 preload 就擋住連錯庫**：

```ts
// apps/api/test-setup.ts（由根層 bunfig.toml 的 [test].preload 載入）
const configuredDatabase = process.env['DB_NAME']
const expectedTestDatabase = process.env['TEST_DB_NAME']
if (expectedTestDatabase === undefined || expectedTestDatabase === '') {
  throw new Error('TEST_DB_NAME 未設定：無法判斷這次測試連的是不是測試資料庫，中止測試。')
}
if (configuredDatabase !== expectedTestDatabase) {
  throw new Error(
    `測試只能連線測試資料庫。期望 DB_NAME=${expectedTestDatabase}，實際為 ${String(configuredDatabase)}。`,
  )
}
```

本機要跑測試，`.env.test` 必須存在（不進版控）：

```
DB_NAME=sundial_test
TEST_DB_NAME=sundial_test
```

沒有這支檔案，`bun test` 會沿用 `.env` 的 `sundial_dev`，被上面的守衛直接中止——這是刻意設計，不是 bug。

---

## 4. 覆蓋率門檻與路徑自檢（現況：未實作）

`dev-standards-general.md` §7.5 規定只對純計算邏輯（`modules/*/*/domain/**`）設 ≥90% 行與分支覆蓋率門檻；`dev-standards-backend.md` §7.5 加碼要求每組覆蓋率路徑 glob 必須有「匹配數 > 0」的自檢，否則 glob 失效時覆蓋率會靜靜通過。

**查證結果：這兩層目前在程式碼裡都不存在。**

- `bunfig.toml` 只有 `[test].preload` 與 `[install].exact`，沒有任何 `coverageThreshold` 或覆蓋率路徑設定。
- 根 `package.json` 與 `apps/api/package.json` 都沒有 `test:coverage` 之類的 script，也沒有 `bun test --coverage` 出現在 `ci` script 裡。
- 全 repo 搜尋 `coverageThreshold`／`--coverage` 沒有命中任何專案程式碼（只有第三方套件與文件裡的敘述文字提到「coverage」）。

寫程式碼時**不要假設覆蓋率門檻會擋你**——§7.1 的「一定要寫的測試」要靠人自己對照著寫，沒有數字會在你漏測時變紅。這件事需要另外排一個任務去補（設定 bun test 覆蓋率門檻 ＋ 寫路徑自檢腳本），不在本檔範圍內動手做，只記錄現況。

---

## 5. 指令清單

以下全部從 repo 根目錄執行，指令與其在 `package.json` 的定義逐字對應（`D:\work\sundial\package.json`）。

```bash
# 型別檢查（tsconfig.base.json 的 strict 全套，含 apps/web）
bun run typecheck

# 前端型別檢查（會先驗證 OpenAPI 產生物存在，見下方 gen:api）
bun run typecheck:web

# lint + 格式檢查
bun run check

# 依賴方向與模組邊界（.dependency-cruiser.cjs，只掃 apps/api/src）
bun run check:layers

# 產生 OpenAPI 契約與前端型別／API client（必須在未啟動服務、無 DB 的情況下可執行，§1.7）
bun run gen:api

# 個別自製掃描腳本（見下一節哪些真的存在）
bun run check:i18n               # apps/api/scripts/check-message-params.ts
bun run check:audit-policy       # apps/api/scripts/check-audit-policy.ts
bun run check:audit-transaction  # apps/api/scripts/check-audit-transaction.ts
bun run check:migration-journal  # apps/api/scripts/check-migration-journal.ts
bun run check:n-plus-one         # apps/api/scripts/check-n-plus-one.ts
bun run check:dataset-code       # apps/api/scripts/check-dataset-code.ts
bun run check:number-cast        # apps/api/scripts/check-number-cast.ts（前端專用）
bun run check:tz-leak            # apps/api/scripts/check-tz-leak.ts
bun run check:api-artifacts      # apps/api/scripts/check-api-artifacts.ts

# 跑全部測試（bun 內建 test runner，preload 會擋非測試 DB）
bun test

# 只跑一個檔案
bun test apps/api/src/modules/employments/main/__tests__/employments-main.endpoints.test.ts

# 只跑名稱包含某字串的測試（integration 描述的那批需要真的 MariaDB）
bun test --test-name-pattern integration

# 前端測試子集
bun test apps/web/src

# 從空 DB 重跑 migration 再跑測試（通用規範 §7.4 要求 CI 這樣做）
bun run db:migrate:test && bun test

# 一次跑完 CI 會跑的全部步驟（本機唯一的把關方式，見下方「沒有 CI」的說明）
bun run ci
```

`ci` script 的實際串接順序（`bun run check && bun run typecheck && bun run gen:api && bun run typecheck:web && bun run check:layers && bun run check:i18n && bun run check:audit-policy && bun run check:audit-transaction && bun run check:migration-journal && bun run check:n-plus-one && bun run check:dataset-code && bun run check:number-cast && bun run check:tz-leak && bun run test`）——`gen:api` 刻意排在需要 DB 的步驟之前，證明「只要有原始碼就產得出契約」；覆蓋率沒有出現在這條鏈裡，因為它根本沒有被設定（見第 4 節）。

**沒有 CI、也沒有 git hook**：repo 裡沒有 `.github/workflows/*.yml`，也沒有 `.husky/` 或 `lint-staged` 設定（`package.json` 沒有 `prepare` script、沒有 `husky`／`lint-staged` 依賴）。`dev-standards-general.md` §7.3 描述的 pre-commit／pre-push／CI 三層目前全部**沒有接上任何自動觸發**，`bun run ci` 是一條純手動指令。送交前必須自己跑，沒有機制會替你擋。

---

## 6. §8 檢查一覽 vs 實作現況對照表

`dev-standards-backend.md` §8 開頭就自承「9 條依賴 dependency-cruiser 的規則，因為 `.dependency-cruiser.cjs` 目前不存在」——**這句話已經過期，是本次查證找到的最大落差**：`D:\work\sundial\.dependency-cruiser.cjs` 確實存在，內容完整，`check:layers` 可以正常執行。以下是逐類別的現況：

| 檢查方式（§8 用語）                            | 涵蓋的規則例                                                                                                                                                                                                                                                                                                                                                                                                   | 實作現況                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **dependency-cruiser**                         | #3 跨模組限 index.ts／repository 邊界、#6 routes.ts 唯一組裝點、#8/#9 impl/ 邊界、#21 發證能力、#34 service/domain 禁 http、#38 裸 db client 限資料層（部分）、#60~#64 頂層目錄依賴方向表全套                                                                                                                                                                                                                  | **已實作**。`.dependency-cruiser.cjs` 逐條規則都在，且每條都在 `comment` 裡附了違反後果與對應章節號，`bun run check:layers` 可執行。文件說它不存在是舊資訊。                                                                                                                                                                                                                                                                                                       |
| **自製掃描腳本（業務／稽核／時區等特定用途）** | #42 迴圈內 N+1（含掃描器自我檢查）、#53 業務時間欄位、#66 migration journal 同步（含自我檢查）、稽核政策、稽核與交易同一 handle、i18n 訊息參數、OpenAPI 產生物形狀                                                                                                                                                                                                                                             | **已實作**，各自對應：`check-n-plus-one.ts`、`check-tz-leak.ts`、`check-migration-journal.ts`、`check-audit-policy.ts`、`check-audit-transaction.ts`、`check-message-params.ts`、`check-api-artifacts.ts`、`check-dataset-code.ts`、`check-live-sources.ts`（後者刻意不進 `ci`，見腳本檔頭）。`check-n-plus-one.ts` 與 `check-migration-journal.ts` 內都能找到「掃到 0 個檔案即失敗」的自我檢查（例：`if (files.length === 0) { selfCheckFailures.push(...) }`）。 |
| **自製掃描腳本（§0 模組結構／路徑命名類）**    | #1 檔名等於目錄路徑、#2 modules/ 底下允許檔名清單、#4/#5 index.ts／routes.ts 只 re-export、#7 入口檔只做委派、#10 companyId 不得來自客戶端、#11/#12/#13/#14/#15 路徑與 cmd 規則、#18/#20/#23/#26 認證與 envelope 邊界、#22/#24/#25 schema 與 envelope 手刻、#30 端點宣告完整性、#33 行內重寫共用型別、#35 業務錯誤禁 throw、#41 軟刪除、#45 敏感欄位遮罩、#47 權限碼機械轉換、#57/#58/#59/#65 目錄與副作用清單 | **未實作**。搜尋 `apps/api/scripts/`、`scripts/`、`tools/` 全 repo，找不到任何涵蓋這批規則的腳本；`package.json` 也沒有對應的 `check:*` script。這是全表裡缺口最大的一塊——約 30 條規則寫在文件裡但沒有任何程式碼在擋，等同靠 review。                                                                                                                                                                                                                              |
| **TypeScript 型別**                            | #16 錯誤碼集中聯集型別、#17 errors 僅 300 非空（判別式聯集）                                                                                                                                                                                                                                                                                                                                                   | 結構性成立（型別系統本身的行為），但沒有獨立的「型別測試」去釘住它不會被繞過；一般由 `bun run typecheck` 間接保證。                                                                                                                                                                                                                                                                                                                                                |
| **測試**                                       | #19 901/900 的 expiresIn、#31 跨公司回應逐項相同、#32 登入失敗四種原因相同、#46 每端點 403 測試、#48~#51 refresh token 撤銷鏈                                                                                                                                                                                                                                                                                  | **已有真實測試覆蓋**，抽查確認：`departments-main.endpoints.test.ts` 有跨公司逐項相同斷言；`sessions-main.revoke-on-reuse.test.ts` 存在（對應 #48）。#27「測試中 errors code 必須在宣告清單內」目前是每個測試檔手寫 `declaredCodes(...).toContain(...)` 斷言，**不是**一支掃過所有測試檔的自動腳本，文件寫的「自製掃描腳本 ＋ 測試」只有後半成立。                                                                                                                 |
| **啟動自檢**                                   | #52 DB session 時區 +08:00                                                                                                                                                                                                                                                                                                                                                                                     | **已實作**：`apps/api/src/db/client.ts` 建連線池時把每條連線 `timezone: '+08:00'`，另有 `apps/api/src/db/time-zone-guard.ts` 的 `assertDatabaseTimeZone` 在啟動時再驗一次（`apps/api/src/index.ts` 呼叫）。                                                                                                                                                                                                                                                        |
| **測試啟動檢查**                               | #55 測試不得連非測試 DB                                                                                                                                                                                                                                                                                                                                                                                        | **已實作**：`apps/api/test-setup.ts`，見第 3.2 節。                                                                                                                                                                                                                                                                                                                                                                                                                |
| **ESLint**                                     | #36 禁止空 catch、#54 禁止 `new Date()`/`Date.now()`                                                                                                                                                                                                                                                                                                                                                           | **已實作**：`eslint.config.js` 有 `no-restricted-syntax` 規則（含台北時間換算模組的例外開關）；`no-floating-promises`／`no-explicit-any`／`no-non-null-assertion`／`eqeqeq`／`no-console` 等通用規範 §4.2 要求的規則也都設為 `error`。                                                                                                                                                                                                                             |
| **CI（作為流水線）**                           | #29 gen:api 無 DB job、#37 migration diff 檢查、#56 覆蓋率路徑自檢                                                                                                                                                                                                                                                                                                                                             | **完全未落地**：repo 沒有任何 CI 工作流程檔（`.github/workflows/` 不存在），這些規則目前只存在於「有人手動跑 `bun run ci`」這件事上，且覆蓋率門檻本身也沒設定（見第 4 節），#56 因此無從自檢起。                                                                                                                                                                                                                                                                   |

**結論**：dependency-cruiser 那 12～13 條與少數幾支特定用途掃描腳本是真的在擋；但涵蓋 §0 模組結構、路徑命名、契約形狀那一大類「自製掃描腳本」——數量上是全表最大宗——目前一條都沒有寫，加上完全沒有 CI／git hook 把關，這些規則現在**等於靠 review 自律**，與 `dev-standards-general.md` §7.1 「靠自律的規則遵守率隨時間趨近於零」正好是文件自己警告的那種狀態。寫新程式碼時不能假設這些規則會被機器擋下來，要自己對照 `dev-standards-backend.md` §0 逐條檢查。

---

## 7. §9 尚待拍板（實作前必須先確認，不要自行假設）

1. 軟刪除唯一鍵是否採 `deleted_seq NOT NULL DEFAULT 0`——需回寫資料模型文件（新增欄位）。
2. 稽核日誌表名與逐欄定義尚未定案，§5.3 只規定內容要求。
3. 帳號鎖定與密碼複雜度政策未定案；「管理者能否對其他員工執行 logout-all」也未定案（logout-all 機制本身已定案）。
4. 前後端若改為不同源部署，需補 CSRF token 並放寬 `SameSite`——目前是同源部署，`Lax` 已足夠，這條待部署拓樸確定才處理。
5. refresh token 30 天壽命與 access token 2 小時滑動視窗是初始值，調整時兩個數字要一起看。
6. `refresh_tokens` 代表「一次登入」的欄位名與型別未定（規則已定案，只差落地），且需與權限碼查詢共用同一次索引查詢。

寫到這些主題時先確認是否已拍板，不要憑自己判斷補完。

---

## 8. 交件前檢查清單

- [ ] 新增或改動的業務規則有對應測試，且測試分類符合第 1 節判準（該寫的都寫了，不該寫的沒有硬湊覆蓋率）。
- [ ] 端點測試打的是 HTTP 入口（`app.handle(new Request(...))`），沒有任何測試直接 import `impl/` 底下的檔案。
- [ ] 每個測試自建公司／員工，用 `crypto.randomUUID()` 或隨機後綴，沒有兩個測試共用同一筆可變 fixture。
- [ ] 測試裡的「現在」一律用 `fixedClock`，沒有出現裸的 `new Date()`。
- [ ] 沒有為了製造前置狀態而繞過正式流程直接寫 DB；如果有例外，檔頭或該測試旁有註明理由。
- [ ] 跨公司存取的測試斷言是跟「目標不存在」逐項比較，不是各自硬編一份期望值。
- [ ] 多筆業務錯誤的端點至少一條測試證明 `errors` 同時回多筆。
- [ ] 本機執行過 `bun run ci` 且全部步驟通過（型別、lint、依賴邊界、各項自製掃描、測試）——這是唯一的把關，沒有 CI 會替你重跑。
- [ ] 若改動涉及 §0 模組結構、路徑命名、envelope／權限碼機械轉換等**沒有腳本在檢查**的規則（見第 6 節「未實作」那一列），自己對照 `dev-standards-backend.md` 逐條核對，不要假設會被擋下來。
- [ ] 若新增或改動 DB migration：`bun run check:migration-journal` 過、且從空 DB 跑過 `bun run db:migrate:test`。
- [ ] `.env.test` 存在且 `TEST_DB_NAME` 與 `DB_NAME` 一致指向測試庫，不是開發庫。
