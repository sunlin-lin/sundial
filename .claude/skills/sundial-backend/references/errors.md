# 錯誤處理與 i18next

對應 `docs/dev-standards-backend.md` §3（行 917–1019）、§1.8（envelope 產出，行 723–835）。

**摘要**：業務拒絕一律用 `ServiceResult` 收集，全部檢查跑完才回傳；只有意外（DB 斷線、程式錯誤）才 `throw`。`*.errors.ts` 是每個模組唯一的錯誤字典，`msg` 只填自己的訊息 key，翻譯留給出口層。有些錯誤（登入失敗、跨公司存取）必須刻意含糊，寫程式前要先確認自己碰到的是不是這一類。交易內任一步失敗要嘛提早 `return fail(...)`、嘛強制 `tx.rollback()`，絕不能吞掉例外後繼續用同一個 `tx`。

## 目錄

1. [業務錯誤用「收集」，例外只留給意外](#1-業務錯誤用收集例外只留給意外)
2. [ServiceResult 的型別與標準寫法](#2-serviceresult-的型別與標準寫法)
3. [`*.errors.ts` 錯誤字典的標準形狀](#3-errorsts-錯誤字典的標準形狀)
4. [錯誤訊息的安全考量](#4-錯誤訊息的安全考量)
5. [禁止吞掉例外](#5-禁止吞掉例外)
6. [交易中的錯誤處理](#6-交易中的錯誤處理)
7. [錯誤如何流到 envelope](#7-錯誤如何流到-envelope)
8. [i18next 的實際用法](#8-i18next-的實際用法)
9. [檢查清單：新增一種業務錯誤](#9-檢查清單新增一種業務錯誤)

---

## 1. 業務錯誤用「收集」，例外只留給意外

**先判斷這件事是不是設計時就知道會發生**（§3.1.2）：

| 是（收集，走 `ServiceResult` 失敗）    | 不是（例外，走 `throw`）                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| 額度不足、狀態不符、目標不存在、無權限 | DB 連線失敗、外部依賴逾時、不該發生的 `undefined`、程式邏輯錯誤 |

- 業務規則不符時，把錯誤累積到陣列，**全部檢查跑完再一次回傳**，禁止第一筆就中斷。
- `service`／`domain` 禁止以拋例外表達業務拒絕，也禁止出現 HTTP 狀態碼字面值或 `WebFlowCode`——分組只能用具名常數 `ErrorGroup`（Conflict／Unprocessable／Forbidden）表達，數字留給邊界層決定。
- `ErrorGroup` 固定三個值，**不得為「未登入」新增第四個**：那件事永遠不是業務錯誤，由認證群組的憑證驗證器就地處理（`900`），根本走不到 service。

真實對照（`apps/api/src/modules/roles/main/domain/role-permission-rules.ts`）：迴圈跑完整個陣列、累積所有錯誤，沒有提早結束的路徑；`roles-main.create.service.ts` 則示範系統錯誤該用 `throw`。

```ts
// ✅ 正確：整個迴圈跑完，逐筆累積，errors 陣列可以裝下每一筆勾錯的權限
export const collectPermissionSelectionErrors = (
  requestedIds: readonly string[],
  check: AssignabilityCheck,
): readonly DomainError[] => {
  const missing = new Set(check.missingIds)
  const errors: DomainError[] = []
  requestedIds.forEach((permissionId, index) => {
    if (missing.has(permissionId)) errors.push(permissionNotFound(index))
  })
  return errors
}

// ❌ 錯誤：第一筆不對就提早 throw，errors 陣列永遠只裝得下一個元素
requestedIds.forEach((permissionId) => {
  if (missing.has(permissionId)) throw new Error('permission not found')
})

// ✅ 正確：剛寫進去的角色讀不回來，是資料庫或程式的問題，走例外才會帶著堆疊進告警
const detail = await findRoleDetail(tx, context.companyId, roleId)
if (detail === null) throw new Error(`角色 ${roleId} 建立後於同一交易內讀不回來`)
return succeed(detail)
```

「找不到」分兩類（§3.1.3），界線是「使用者有沒有嘗試對它做一件事」：

| 端點類別                                   | 目標不存在時                                                | 是否進 errors |
| ------------------------------------------ | ----------------------------------------------------------- | ------------- |
| 查詢類（`list`／`get`）                    | HTTP 200 ＋ `code='200'` ＋ `data: null`                    | 不算錯誤      |
| 動作類（`update`／`delete`／`approve` 等） | `code='300'` 邏輯錯誤，需要自己的 `<模組>.errors.not-found` | 算錯誤        |

## 2. ServiceResult 的型別與標準寫法

型別定義在 `apps/api/src/shared/service-result.ts`：

```ts
export const ErrorGroup = { Conflict: 'conflict', Unprocessable: 'unprocessable', Forbidden: 'forbidden' } as const
export type ErrorGroupValue = (typeof ErrorGroup)[keyof typeof ErrorGroup]

export type DomainError = {
  readonly group: ErrorGroupValue
  readonly code: ErrorCode // 訊息 key，見第 3、8 節
  readonly msg: ErrorCode // 必須等於 code 本身，型別上綁死
  readonly data?: Record<string, unknown> // 慣例帶 field（dot-path），不得放敏感值
  // 需要插值的 key 上 params 是必填；不需要的 key 上 params 不得填
}

export type ServiceResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly DomainError[] }

export const succeed = <T>(value: T): ServiceResult<T> => ({ ok: true, value })
export const fail = (errors: readonly DomainError[]): ServiceResult<never> => ({ ok: false, errors })
```

**`fail` 收一整包陣列，不是一筆**——收一筆的簽章會讓「第一筆就 return」變成最順手的寫法，正是要防的事。

service 標準寫法（`apps/api/src/modules/roles/main/impl/roles-main.create.service.ts`，精簡）：

```ts
export const createRole = async (
  context: RolesMainContext,
  input: CreateRoleInput,
): Promise<ServiceResult<RoleDetail>> => {
  // 1. 唯讀檢查放在交易之前（§3.4：避免多持有列鎖）
  const permissionErrors = collectPermissionSelectionErrors(
    input.permissionIds,
    await checkAssignable(context.db, input.permissionIds),
  )
  if (permissionErrors.length > 0) return fail(permissionErrors)

  return context.db.transaction(async (tx): Promise<ServiceResult<RoleDetail>> => {
    const outcome = await insertRole(tx, context.companyId, {/* ... */})
    if (outcome === 'duplicate-code') return fail([roleCodeDuplicated()])

    await replaceRolePermissions(tx, context.companyId, roleId, dedupePermissionIds(input.permissionIds), now)
    const detail = await findRoleDetail(tx, context.companyId, roleId)
    if (detail === null) throw new Error(`角色 ${roleId} 建立後於同一交易內讀不回來`) // 系統錯誤，見第 1 節
    return succeed(detail)
  })
}
```

## 3. `*.errors.ts` 錯誤字典的標準形狀

每個模組一支 `<大目錄>-<次目錄>.errors.ts`（§0.4「errors 不拆」），內容固定四段：**錯誤碼常數**（`satisfies Record<string, ErrorCode>` 釘在集中聯集上，漏寫訊息時整份檔案編譯不過）→ **建構函式**（每個碼對應一個回傳 `DomainError` 的函式）→ **端點錯誤碼宣告**（`XXX_ENDPOINT_ERRORS`，沒有錯誤也要宣告空陣列，§1.8.3）→ **`describeXxxErrors`**（轉成 OpenAPI 的 `description`）。

命名格式：訊息 key 一律四段、由模組路徑機械推導 `<大目錄>.<次目錄>.<類別>.<訊息名>`，全 kebab-case，不做人工判斷。例：`roles-main.errors.ts` 在 `modules/roles/main/`，因此一律 `roles.main.errors.*`。

```ts
// apps/api/src/modules/roles/main/roles-main.errors.ts（節錄）
export const RoleErrorCode = {
  CodeDuplicated: 'roles.main.errors.code-duplicated',
  NotFound: 'roles.main.errors.not-found',
  InUse: 'roles.main.errors.in-use',
} as const satisfies Record<string, ErrorCode>

// 不帶插值：分組決定 HTTP status 走向，msg 只填自己的 code
export const roleNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: RoleErrorCode.NotFound,
  msg: RoleErrorCode.NotFound,
  data: { field: 'id' },
})

// 帶插值：params 在型別上被要求填齊，少填是編譯錯誤
export const roleInUse = (assignedUserCount: number): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleErrorCode.InUse,
  msg: RoleErrorCode.InUse,
  params: { assignedUserCount }, // 餵給出口層翻譯
  data: { field: 'id', assignedUserCount }, // 回給前端定位/顯示，兩者刻意分開
})

export const ROLE_ENDPOINT_ERRORS = {
  list: [], // 查詢類：沒有業務錯誤也要明寫空陣列
  create: [conflict(RoleErrorCode.CodeDuplicated), unprocessable(RoleErrorCode.PermissionNotFound)],
} as const satisfies Record<string, readonly RoleErrorDeclaration[]>
```

分組怎麼選：

- **`Conflict`（→ 409）**：這個值與另一筆既有資料撞了，或條件式 UPDATE 影響 0 列（樂觀鎖，§4.4）。使用者的處置是換個值或重新載入，不是重填整張表。
- **`Unprocessable`（→ 422）**：格式合法但業務條件不成立，例如「目標不存在」「權限不可指派」。
- **`Forbidden`（→ 403／`901`）**：無權限。這個分組的錯誤**不得**與另外兩種混在同一次回應裡並列——集合內只要出現一筆，整體就是 `901`，其餘一律不輸出，細節只進 log（§3.1.1、§4 節有進一步說明）。

同一語意若在不同情境要回不同 status，**拆成兩個錯誤碼**，不要讓同一個碼有兩種結果（例：`NotFound` 與 `StateChanged` 是兩個碼，即使都源自「動作打在同一筆資料上」）。

## 4. 錯誤訊息的安全考量

某些錯誤**必須刻意含糊**，這是規格不是疏漏，改動前要先讀該錯誤碼在 `*.errors.ts` 上的說明：

| 情境                                                                           | 必須回                                                                                 | 禁止回                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 登入失敗（四種原因：公司代號不存在／帳號不存在／密碼錯誤／帳號不屬於這家公司） | 同一個 `sessions.main.errors.invalid-credentials`，同 HTTP status、同 `code`、同 `msg` | 任何可區分四種原因的訊息；也禁止回 `900`（§1.3：登入失敗是顯示業務訊息，不是導向登入頁） |
| 查詢類端點存取不屬於本公司的資料                                               | 與「查無資料」完全相同：200 ＋ `data: null`                                            | 403／`901` 或任何回聲該 id 的訊息                                                        |
| 動作類端點對不屬於本公司的目標操作                                             | 與「目標不存在」完全相同：同 status、同 `code`、同 `msg`、同 `errors[].code`           | 403／`901`，或讓「別家的」與「不存在」可被區分                                           |
| 敏感識別值（身分證等）唯一性檢查                                               | 只回「無法建立」                                                                       | 回聲與哪一筆重複                                                                         |

真實範例（`apps/api/src/modules/employees/main/employees-main.errors.ts`）：

```ts
// ✅ 正確：身分證重複，只說「無法建立」，data 只有欄位名，不回聲任何人的身分證或員工編號
export const employeeIdentityNumberDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: EmployeeErrorCode.IdentityNumberDuplicated,
  msg: EmployeeErrorCode.IdentityNumberDuplicated,
  data: { field: 'identityNumber' },
})

// ✅ 正確：跨公司存取與「id 根本不存在」共用同一個建構函式，兩條路徑走同一行程式碼
export const employeeNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: EmployeeErrorCode.NotFound,
  msg: EmployeeErrorCode.NotFound,
  data: { field: 'id' },
})

// ❌ 錯誤：分別回應「查無此帳號」與「密碼錯誤」，訊息就算寫得像，仍是可枚舉的破口
if (companyNotFound) return fail([{ code: 'company-not-found' /* ... */ }])
if (passwordWrong) return fail([{ code: 'password-wrong' /* ... */ }])
```

實作上不是「記得回同一句」，而是**讓兩條路徑走同一行程式碼**——查詢一律帶 `company_id`（§4.2），四種登入失敗原因用單一查詢條件解析身分。想寫出不一致的回應都寫不出來，這是唯一可靠的做法。

例外訊息與 `errors[].data` 禁止包含密碼、密碼 hash、完整身分證、完整銀行帳號、加密金鑰、SQL 原文——這些一旦進 log，log 的保存期就變成個資保存期。

## 5. 禁止吞掉例外

- **禁止空 catch**。需要忽略時必須註明理由與已知範圍。
- **禁止 catch 後回傳預設值**（`return null`、`return []`）掩蓋錯誤。
- 重拋時必須保留成因：`throw new UpstreamFailure('...', { cause: e })`。重拋一律是系統錯誤路徑——業務拒絕不走這裡。

```ts
// ✅ 正確：明說為什麼可以吞
try {
  await auditLog.write(entry)
} catch (e) {
  // 稽核寫入失敗不可讓主要業務操作失敗；改記系統日誌並告警。
  logger.error({ err: e }, 'audit write failed')
}

// ❌ 錯誤：額度扣抵失敗被吞掉，餘額與紀錄不一致且無人知情
try {
  await deductBalance(...)
} catch {}
```

## 6. 交易中的錯誤處理

三條硬規則（§3.4）：

- 交易回呼內**禁止吞例外後繼續使用同一個 `tx`**——錯誤已使交易進入待回滾狀態，後續寫入不是失敗就是寫進一個注定回滾的交易。
- 交易內**禁止**呼叫外部 HTTP、寄信、寫檔或執行長時間計算——交易期間持有列鎖，一次外部逾時就會連鎖鎖住整張表。
- 需要在成功後才做的副作用（通知、快取失效、重算排程）一律放在交易 commit **之後**。

**最容易忘記的陷阱**：drizzle 的 `db.transaction(cb)` 只依 `cb` 是否 reject 決定 commit／rollback，**不看回傳值的內容**。`ServiceResult` 的失敗分支不是例外——如果編排函式中途 `fail(...)` 但外層原樣 `return`，drizzle 會當成「回呼正常結束」而 **commit**，前面已寫入的資料全部留在資料庫。

跨多個子動作編排的正確寫法（`apps/api/src/modules/employees/onboarding/employees-onboarding.service.ts`，精簡）：

```ts
export const createOnboarding = async (
  context: OnboardingContext,
  input: CreateOnboardingInput,
): Promise<ServiceResult<OnboardingResult>> => {
  let failure: ServiceResult<OnboardingResult> | null = null

  try {
    return await context.db.transaction(async (tx) => {
      const result = await createOnboardingInTransactionImpl(tx, context, input)
      if (result.ok) return result

      // 任一步失敗：記下要回傳的內容，再強制 ROLLBACK。
      failure = result
      return tx.rollback() // 型別是 never，之後的程式碼不會執行到
    })
  } catch (error) {
    if (failure !== null) return failure
    // 其餘一律是真正的意外，原樣往上拋，保留堆疊與成因（§5）。
    throw error
  }
}
```

`tx.rollback()` 丟一個內部例外終止交易，因此外層要 `try/catch` 接住那個 reject、換回原本要回的 `ServiceResult`，不能讓它原樣冒出去變成看起來像系統錯誤的 500。被編排的每個子步驟（`.../impl/employees-onboarding.create.service.ts`）只管「跑到哪一步失敗」，不管交易怎麼收尾：

```ts
export const createOnboardingInTransaction = async (
  tx: TransactionRunner,
  context: OnboardingContext,
  input: CreateOnboardingInput,
): Promise<ServiceResult<OnboardingResult>> => {
  const employeeResult = await createEmployeeInTransaction(tx, employeesContext, {/* ... */})
  if (!employeeResult.ok) return fail(employeeResult.errors)
  const employee = employeeResult.value

  const employmentResult = await createEmploymentInTransaction(tx, employmentsContext, {/* ... */})
  if (!employmentResult.ok) return fail(employmentResult.errors)
  // ...後續每一步同樣模式：不 ok 就 return fail(...)，往下傳遞
}
```

`TransactionRunner` 型別定義在 `apps/api/src/db/client.ts`，它是 `QueryRunner & Pick<DbTransaction, 'rollback'>`——只要函式簽章收 `TransactionRunner`，就代表這段程式碼一定在交易內執行、且拿得到 `rollback()`。

## 7. 錯誤如何流到 envelope

完整路徑（§1.8.0）：

```text
service 收集業務錯誤，回傳 ServiceResult<T> 的失敗分支
      ▼
handler：resolveServiceResult(result, toData)（apps/api/src/http/error-boundary.ts）
      ▼
邊界層錯誤映射 mapDomainErrors：整包錯誤集合 → HTTP status ＋ code ＋ errors[]
  規則：出現任一 Forbidden → 403／'901'；否則有 Conflict → 409／'300'；其餘 → 422／'300'
      ▼
envelope 產生函式：包成 { code, msg, errors, data }（msg／errors[].msg 仍是 key）
      ▼
出口層 finalizeEnvelope（apps/api/src/http/response-envelope.ts）：
  補 rspTS／cmd／locale／expiresIn／exp，並依 locale 把 key 翻成字串
      ▼
HTTP 回應
```

未攔截的意外走另一條、但共用同一個出口（`apps/api/src/http/error-handler.ts`）：統一 `onError` 攔到框架錯誤或未捕捉例外，映射成 500 ＋ `code='400'`，一樣呼叫 `finalizeEnvelope`——成功與失敗路徑不得分開組 envelope（§1.8.4）。`error-boundary.ts` 的核心：

```ts
export const mapDomainErrors = (errors: readonly DomainError[]): BoundaryResponse<null> => {
  const first = errors[0]
  if (first === undefined) {
    // service 回了失敗卻沒有任何錯誤：這是程式錯誤，走系統錯誤路徑才會進告警
    logger.error(LogCategory.UnhandledException, 'service 回傳失敗結果但錯誤集合為空')
    return { status: HttpStatus.InternalServerError, body: systemError() }
  }
  if (errors.some((error) => error.group === ErrorGroup.Forbidden)) {
    logger.warn(LogCategory.PermissionDenied, '請求被權限規則拒絕', {/* 只進 log，不回前端 */})
    return { status: HttpStatus.Forbidden, body: permissionDenied() }
  }
  const status = errors.some((error) => error.group === ErrorGroup.Conflict)
    ? HttpStatus.Conflict
    : HttpStatus.UnprocessableEntity
  return { status, body: logicError(errors.map(toErrorView), first.msg, first.params) }
}
```

handler 只呼叫 `resolveServiceResult`，不自己判斷 status（`apps/api/src/modules/roles/main/roles-main.handler.ts`）：

```ts
export const handleRoleCreate = async (dependencies, context) => {
  const result = await createRole(toRoleContext(dependencies, identity), {/* ... */})
  const outcome = resolveServiceResult(result, toRoleDetailData) // 成功／失敗都在這裡決定
  context.set.status = outcome.status
  return outcome.body // 不得再手動改 code／errors
}
```

**HTTP status ↔ envelope code 映射表**（`apps/api/src/http/http-code-map.ts`）：

| HTTP      | code  | 前端動作                                               |
| --------- | ----- | ------------------------------------------------------ |
| 200       | `200` | 正常                                                   |
| 400       | `100` | 進錯誤回報（呼叫端 bug）                               |
| 401       | `900` | 導向登入頁（唯一產出者是憑證驗證器，service 不得產出） |
| 403       | `901` | 顯示無權限                                             |
| 404       | `400` | 顯示系統錯誤                                           |
| 409 / 422 | `300` | 顯示業務訊息，讀 `errors`                              |
| 500       | `400` | 顯示系統錯誤                                           |

## 8. i18next 的實際用法

分工（§1.8.2）：

| 層                                   | 決定                 | 產物                     |
| ------------------------------------ | -------------------- | ------------------------ |
| service／`*.errors.ts`               | 哪一則訊息           | 訊息 **key**（不是字串） |
| 邊界層錯誤映射                       | 把 key 放進 envelope | 仍然是 key               |
| **出口層**（`response-envelope.ts`） | 哪一種語言           | 依 `locale` 翻成字串     |

**翻譯只發生在出口層**，那是全站唯一一處——service 一旦產出翻譯後的字串，同一段業務規則被第二種入口（設備、對外 API）呼叫時，那個入口的語系就再也蓋不掉業務層當初挑的那一種。

目錄結構：`shared/i18n/messages.ts`（查詢入口 `translate(key, locale, params)`、`ErrorCode` 型別、i18next 初始化）＋ `message-tree.ts`（巢狀樹 → 攤平 key 的型別工具）＋ `locales/zh-TW/index.ts`（把各大目錄的語系檔組裝成一棵樹）＋ 每個大目錄一支語系檔（`roles.ts`、`sessions.ts`……）。語系檔在原始碼裡是巢狀樹（跟著模組結構長），查詢用的 key 是攤平後的點分隔字串——`keySeparator: false`／`nsSeparator: false` 已在 `messages.ts` 關閉，i18next 不會把攤平後的 `roles.main.errors.in-use` 誤解成巢狀路徑。

**新增一組訊息的實際步驟：**

1. 在 `<模組>-<次目錄>.errors.ts` 加錯誤碼常數，例如 `roles-main.errors.ts` 的 `RoleErrorCode.XxxNew: 'roles.main.errors.xxx-new'`。
2. 在 `shared/i18n/locales/zh-TW/roles.ts` 的 `errors` 物件下加同名 key 與中文句子：`'xxx-new': '這裡放中文訊息'`。忘記做這步的話，`satisfies Record<string, ErrorCode>` 那一行**直接編譯不過**——`ErrorCode` 型別由 `locales/zh-TW` 這棵樹反推，新碼還沒進語系檔就不存在於這個聯集裡。
3. 若這句話要插值，在 `messages.ts` 的 `MESSAGE_PARAM_SPECS` 宣告變數名與型別，句子裡用 `{{變數名}}` 對應（i18next 預設插值語法）：

```ts
export const MESSAGE_PARAM_SPECS = {
  'roles.main.errors.in-use': { assignedUserCount: 'number' },
  'roles.main.errors.xxx-new': { someCount: 'number' }, // 新增這一行
} as const satisfies Readonly<Partial<Record<MessageKey, Readonly<Record<string, MessageParamKind>>>>>
```

4. 在建構函式裡把 `params` 填上（型別會強制要求，漏填即編譯錯誤）：

```ts
export const roleInUse = (assignedUserCount: number): DomainError => ({
  group: ErrorGroup.Conflict,
  code: RoleErrorCode.InUse,
  msg: RoleErrorCode.InUse,
  params: { assignedUserCount }, // 餵給翻譯；不會出現在 JSON 回應裡
  data: { field: 'id', assignedUserCount }, // 回給前端的定位/顯示資訊，是另一份拷貝，不互相繼承
})
```

## 9. 檢查清單：新增一種業務錯誤

- [ ] 確認這是「設計時就知道會發生」的業務拒絕，不是意外（第 1 節）；若是意外，直接 `throw`，不要走這份清單。
- [ ] 在對應模組的 `<大目錄>-<次目錄>.errors.ts` 加錯誤碼常數，格式 `<大目錄>.<次目錄>.errors.<訊息名>`，`satisfies Record<string, ErrorCode>`；選對 `ErrorGroup`（資料衝突／樂觀鎖 → `Conflict`；業務條件不成立 → `Unprocessable`；無權限 → `Forbidden`，且不得與其他分組混在同一次回應）。
- [ ] 寫建構函式，回傳 `DomainError`，`msg` 只填自己的 `code`；`data` 慣例帶 `field`，且不放敏感值。
- [ ] 檢查是否落入「必須刻意含糊」的情境（第 4 節），是的話與既有「目標不存在」共用同一個建構函式與同一條查詢路徑。
- [ ] 若訊息要插值，在 `shared/i18n/messages.ts` 的 `MESSAGE_PARAM_SPECS` 宣告變數並在建構函式的 `params` 填上；在 `shared/i18n/locales/zh-TW/<大目錄>.ts` 對應節點加中文句子，key 與錯誤碼逐字相同。
- [ ] 在 `XXX_ENDPOINT_ERRORS` 把新錯誤碼加進所有會吐出它的端點清單（§1.8.3：未宣告的碼不得在執行期出現）。
- [ ] 在 service 裡用「收集」而不是提早 `return`／`throw` 的方式產生這筆錯誤；若在迴圈裡，確認迴圈跑完整個陣列；若發生在交易內，確認失敗路徑立刻 `return fail(...)`，不再對同一個 `tx` 下任何寫入（第 6 節）。
- [ ] 補測試：斷言 `errors[].code` 就是這個新碼，且落在該端點的宣告清單內；含糊化的錯誤要斷言與對照情境的回應逐項相同（status／`code`／`msg`／`errors[].code`）。
