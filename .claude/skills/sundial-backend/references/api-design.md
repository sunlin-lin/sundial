# API 設計與輸入輸出驗證

本檔對應 `docs/dev-standards-backend.md` §1（API 設計規範，行 275–896）與 §2（輸入與輸出驗證規範，行 897–916）。範圍限定在**「Web 前端」這一個入口**（§1.0）——本系統目前只有這一種呼叫者，本檔規定的路徑形狀、envelope、`cmd`、認證分組全部是這個入口的契約，不是放諸四海皆準的規則。寫程式碼時直接照抄本檔的「正確」寫法；「為什麼」只留一兩句並附規範章節號，完整理由回頭查 dev-standards-backend.md。

實際套件：`elysia`（HTTP 框架，路由與 `t`）、`@sinclair/typebox`（`t` 背後的 schema 系統，`Type.Integer` 等原生函式偶爾直接用）、`@elysiajs/openapi`（`gen:api` 用來把 Elysia app 轉成 OpenAPI，僅 devDependency）。

## 目錄

1. [路徑命名與 HTTP method](#1-路徑命名與-http-method)
2. [Request／Response envelope](#2-requestresponse-envelope)
3. [envelope 的唯一產生入口與分層責任](#3-envelope-的唯一產生入口與分層責任)
4. [List 端點：分頁、排序、篩選](#4-list-端點分頁排序篩選)
5. [所有參數一律走 request body](#5-所有參數一律走-request-body)
6. [TypeBox／Elysia `t` 的實際寫法](#6-typeboxelysia-t-的實際寫法)
7. [路由檔的分組結構](#7-路由檔的分組結構)
8. [handler 的標準四步形狀](#8-handler-的標準四步形狀)
9. [端點必須宣告的錯誤碼清單](#9-端點必須宣告的錯誤碼清單)
10. [OpenAPI 契約由程式碼產生](#10-openapi-契約由程式碼產生)
11. [新增一支端點的檢查清單](#11-新增一支端點的檢查清單)

---

## 1. 路徑命名與 HTTP method

**路徑固定三段：`/<大目錄>/<次目錄>/<動作>`，全部 kebab-case，前兩段必須與 `modules/<大目錄>/<次目錄>/` 目錄名完全一致**（§1.1）。第三段是動作，沒有預先核准的清單，但同一件事全站只能用同一個字（`list` 不得又叫 `lists`／`query`）。

```text
✅ 正確：POST /shifts/main/list、POST /shifts/main/copy、POST /sessions/main/logout-all
❌ 錯誤：GET /shifts/main（沒有動作片段、用了 GET）
❌ 錯誤：POST /shifts/{id}（帶路徑參數）
❌ 錯誤：POST /shifts/main/getShiftList（目錄名與贅詞混進動作片段）
```

- **一律 `POST`，不使用 `GET`／`PUT`／`PATCH`／`DELETE`**（§1.2）：`GET` 沒有 body 放不下 `rqTS`／`cmd`／`locale`；`PUT`／`PATCH` 在動作已寫進路徑、參數已全在 body 之下不再承載任何資訊。健康檢查等基礎設施端點不受此限，但必須集中在單一檔案並附註解（見 `apps/api/src/http/infrastructure-endpoints.ts`）。
- **路徑不得帶參數，也沒有巢狀**：沒有 `{id}`，沒有 query string，沒有第四段。識別碼一律放 body（§1.5）。
- **`companyId` 禁止出現在 request body**（§1.1）。公司範圍只能來自已驗證的 token；`companyCode`（登入頁輸入、待驗證的字串）不算在內。
- **`cmd` 是路徑的機械轉換**：去掉開頭 `/`，把其餘 `/` 換成 `.`，不做任何額外轉換（§1.3），集中定義在 `apps/api/src/shared/path-code.ts`：

  ```ts
  // apps/api/src/shared/path-code.ts
  export const pathToCode = (routePath: string): string | null => {
    const segments = routePath.replace(/^\//, '').split('/')
    if (segments.length !== SEGMENT_COUNT) return null
    if (!segments.every((segment) => KEBAB_CASE_SEGMENT.test(segment))) return null
    return segments.join('.')
  }
  export const toCommandCode = pathToCode
  export const toPermissionCode = pathToCode // 與 cmd 共用同一個推導，見 §5.2
  ```

  `POST /shifts/main/copy` 的 `cmd` 就是 `shifts.main.copy`；同一套推導也用來算權限碼，兩者字面值必須相同。

- **禁止在 body 帶 `status` 欄位**做狀態變更；狀態轉移一律走專屬動作端點（`approve`／`reject`／`revoke-approval`），且該端點必須在 `data` 回傳變更後的完整資源。

## 2. Request／Response envelope

**Request** 平鋪：三個基底欄位（`rqTS`／`cmd`／`locale`）與業務欄位在同一層，不開 `payload` 巢狀節點（list 端點的完整範例見 §4）：

```json
{ "rqTS": "2026-04-14T14:30:00+08:00", "cmd": "shifts.main.get", "locale": "zh-TW", "id": "..." }
```

**Response** 成功範例（`code='200'`）：

```json
{
  "code": "200",
  "msg": "",
  "errors": [],
  "data": { "id": "...", "code": "A01", "name": "早班", "isActive": true },
  "rspTS": "2026-04-14T14:30:01+08:00",
  "cmd": "shifts.main.get",
  "locale": "zh-TW",
  "expiresIn": 3600,
  "exp": "2026-08-19T18:28:28+08:00"
}
```

**Response** 失敗範例（`code='300'`，業務規則衝突，422）：

```json
{
  "code": "300",
  "msg": "shifts.main.errors.code-duplicated",
  "errors": [
    {
      "code": "shifts.main.errors.code-duplicated",
      "msg": "shifts.main.errors.code-duplicated",
      "data": { "field": "code" }
    }
  ],
  "data": null,
  "rspTS": "2026-04-14T14:30:01+08:00",
  "cmd": "shifts.main.create",
  "locale": "zh-TW",
  "expiresIn": 3600,
  "exp": "2026-08-19T18:28:28+08:00"
}
```

要點（§1.3）：

- **禁止裸陣列**——清單一律包在 `data` 內。
- `rspTS`／`cmd`／`locale`／`expiresIn`／`exp` **一律由出口層補上**，端點自己一個都不填。
- `errors` **只在 `code='300'` 時提供**，其餘一律空陣列；`code='100'`（schema 驗證失敗）**完全不提供 `errors`**——那是開發期問題，不是要引導使用者的問題。
- `errors[].data.field` 用 dot-path，陣列以 0 起算索引：`items.2.startTime`。
- HTTP status 與內部 `code` 的映射（六碼固定值，集中在 `apps/api/src/shared/web-flow-code.ts`）：`200→200`、`400→100`（資料不正確）、`401→900`（無有效身分，導登入頁）、`403→901`（無權限）、`404→400`（端點不存在）、`409/422→300`（邏輯錯誤，讀 `errors`）、`500→400`（系統錯誤）。分類軸是「前端該做什麼」不是 HTTP 語意，因此 404/500 同歸 `400`、409/422 同歸 `300`。**查無資料是 HTTP 200 + `data: null`，不是 404**——404 專指端點不存在。
- **`expiresIn` 是滑動視窗**：每次通過憑證驗證都續期，回續期後的剩餘秒數，不是遞減值；`exp` 只供 log 對時，禁止用於過期判斷或顯示給使用者。

## 3. envelope 的唯一產生入口與分層責任

**唯一產生入口**：`apps/api/src/shared/envelope.ts` 的 `ok()`／`logicError()`／`systemError()`／`authRequired()`／`permissionDenied()`，以及 `apps/api/src/http/response-envelope.ts` 的 `finalizeEnvelope()`。**禁止在 handler 或 routes 內以物件字面值手工組 envelope**（§1.8.1），掃描範圍涵蓋 `*.handler.ts` 與 `*.routes.ts` 兩種檔案。

```ts
// ✅ 正確：handler 只回業務資料，由產生函式與出口層負責包裝
return ok(toListView(rows, pagination))

// ❌ 錯誤：手工組。少了 locale、rspTS 拼錯，全部靜默通過型別檢查
return { code: '200', msg: '', errors: [], data: rows, rspTs: now(), expiresIn: 3600 }
```

分層責任表（§1.8.2）：

| 層                                       | 負責                                                                             | 禁止                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| service／domain                          | 回傳成功結果，或回傳收集到的錯誤集合（每筆帶分組與 `errors[].code`）             | 不得碰 envelope 任何欄位；不得出現 HTTP 狀態碼字面值或 `WebFlowCode`；不得以拋例外表達業務拒絕 |
| 憑證驗證器（認證群組）                   | 驗證身分、續期、把身分放進 context；`900` 就地回，不進 handler                   | 不得因處理結果改變是否續期                                                                     |
| 端點 handler                             | 宣告 `data` schema、宣告錯誤碼清單、呼叫 service、把結果映射成 `data`            | 不得自行設 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`；不得自組 `errors`             |
| 出口層（`response-envelope.ts`）         | 補 `rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，把訊息 key 依 `locale` 翻成字串 | —                                                                                              |
| 邊界層錯誤映射（`error-boundary.ts`）    | 把 service 的**整包**錯誤集合映射成 HTTP status + `code` + `errors[]`            | 不得判斷業務規則成不成立，不得只取第一筆                                                       |
| 統一 error handler（`error-handler.ts`） | 只處理未攔截例外，映射成 500 + `code='400'` 並記堆疊                             | 不得用來表達業務拒絕                                                                           |

`apps/api/src/http/error-boundary.ts` 的 `resolveServiceResult` 是 handler 與 envelope 之間唯一的橋：

```ts
// apps/api/src/http/error-boundary.ts
export const resolveServiceResult = <TValue, TData>(
  result: ServiceResult<TValue>,
  toData: (value: TValue) => TData,
): BoundaryResponse<TData> | BoundaryResponse<null> =>
  result.ok ? { status: HttpStatus.Ok, body: ok(toData(result.value)) } : mapDomainErrors(result.errors)
```

映射規則：錯誤集合內出現任一 `Forbidden` → 403／`901`；否則有 `Conflict` → 409／`300`；其餘 → 422／`300`。**成功與失敗走同一個出口**（§1.8.4）：兩者都只決定 status／`code`／`errors[]`，其餘欄位一律由 `finalizeEnvelope` 補，否則錯誤路徑會缺 `cmd`／`locale`／`expiresIn`，而那正是最需要它們的時候。

## 4. List 端點：分頁、排序、篩選

Request 平鋪 `perPage`／`currentPage`／`sort`，一律必填、有預設值：

```json
{
  "rqTS": "2026-04-14T14:30:00+08:00",
  "cmd": "shifts.main.list",
  "locale": "zh-TW",
  "keyword": "早班",
  "perPage": 20,
  "currentPage": 1,
  "sort": { "field": "createdAt", "order": "desc" }
}
```

- `perPage` 必填，預設 20，上限 100；`currentPage` 必填，預設 1（1 起算）。**禁止**改叫 `page`／`size`／`limit`／`offset`。
- `sort` 只有 `{ field, order }` 一組，不支援多欄排序；`field` **必須白名單**，直接把字串接進 SQL 等於開放 SQL injection。
- Response 的 `data` 收一層 pagination 結構，實際清單在 `data.data`，**不提供總頁數**（前端自算 `totalCount / perPage`），`search`／`sort` 必須原樣回聲以防 race condition：

  ```json
  "data": {
    "search":     { "keyword": "早班" },
    "sort":       { "field": "createdAt", "order": "desc" },
    "pagination": { "currentPage": 1, "perPage": 20, "totalCount": 137 },
    "data":       [ ]
  }
  ```

- **`search`／`sort` 回聲必須由共用函式 `toListView` 帶回，不得各端點自行填**（§1.8.1）。它在 `apps/api/src/shared/list-view.ts`：

  ```ts
  // apps/api/src/shared/list-view.ts
  export const toListView = <TSearch, TItem>(
    search: TSearch,
    sort: SortView,
    pagination: PaginationView,
    data: readonly TItem[],
  ): ListView<TSearch, TItem> => ({ search, sort, pagination, data: [...data] })
  ```

  `shifts-main.handler.ts` 呼叫它組裝 `data`：`toListView(toSearchEcho(body), query.sort, { currentPage, perPage, totalCount }, page.items.map(toShiftSummaryData))`。

- **列表端點一律分頁，不得無上限查詢。** `currentPage` 超出範圍時回空陣列與正確的 `pagination`，不得回 404。
- **篩選條件所指的目標找不到（不存在、已軟刪除、或屬於別家公司），一律比照「查無資料」回空清單，不新增錯誤碼。** 真實先例：`employments-main.list.repository.ts` 用 `query.employeeId` 篩選時直接把它拼進 `WHERE`，`employments-main.list.service.ts` 沒有任何一步驗證這個 `employeeId` 存不存在或屬不屬於本公司；查不到、已刪除、跨公司三種情況在 `TenantDatabase` 的公司範圍限制下，一律收斂成「這個條件查無符合列」，回應是同一個空陣列。不特別分辨的理由：這三種情況前端的處置完全相同（顯示「查無資料」），刻意分辨反而會洩漏「這個 id 在別家公司存在」——與§3.2「跨公司回應必須與目標不存在逐項相同」是同一條界線，只是這裡的「目標」是篩選條件指到的那筆，不是端點本身操作的那筆。

## 5. 所有參數一律走 request body

先分清楚兩類輸入（§1.5）：**業務參數**（識別碼、篩選、分頁、排序、要寫入的內容）一律走 body，**憑證**（access token／refresh token）一律不走 body，通道由所在的認證群組規定。

```ts
// ✅ 正確：JSON body，型別即是型別，schema 只驗證不轉型
body: t.Object({
  ...BaseRequest,
  keyword: t.Optional(t.String({ maxLength: 50 })),
  includeExpired: t.Optional(t.Boolean()),
  perPage: t.Integer({ minimum: 1, maximum: 100, default: 20 }),
  currentPage: t.Integer({ minimum: 1, default: 1 }),
})

// ❌ 錯誤：本專案不使用 query string，也不需要轉型 schema
query: t.Object({ page: t.Numeric(), includeExpired: t.BooleanString() })
```

- **禁止宣告 `query` 或 `params` schema**，路徑字串也不得含 `:` 或 `{`。
- **端點不讀 cookie／header／`Authorization`**，也不驗證憑證；只從 `context.requestContext.session` 取用已驗證身分。這件事發生在認證群組的憑證驗證器裡（見 §7）。

## 6. TypeBox／Elysia `t` 的實際寫法

### 6.1 共用欄位型別

集中定義在 `apps/api/src/shared/field-schemas.ts`，**禁止就地重寫**（§2）：

```ts
// apps/api/src/shared/field-schemas.ts
export const Uuid = t.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
})
export const IsoDate = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) // 業務日期 YYYY-MM-DD
export const TaipeiDateTime = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' }) // 不帶時區
export const TransportTS = t.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?[+-]\\d{2}:\\d{2}$',
})
export const Reason = t.String({ minLength: 1, maxLength: 500 })
export const Money = t.String({ pattern: '^-?\\d{1,13}(?:\\.\\d{1,2})?$' }) // decimal 字串，不是 number
export const Minutes = t.Integer({ minimum: 0 })

export const BaseRequest = { rqTS: TransportTS, cmd: t.String({ minLength: 1 }), locale: Locale } as const
export const PageRequest = {
  perPage: t.Integer({ minimum: 1, maximum: 100, default: 20 }),
  currentPage: t.Integer({ minimum: 1, default: 1 }),
} as const
export const sortRequest = <const TFields extends readonly string[]>(allowedFields: TFields) =>
  t.Object({ field: t.Union(allowedFields.map((field) => t.Literal(field))), order: SortOrder })
export const Nullable = <TInner extends TSchema>(schema: TInner) => t.Union([schema, t.Null()])
export const codeField = (maxLength: number) => t.String({ minLength: 1, maxLength, pattern: CODE_FIELD_PATTERN })
```

`BaseRequest`／`PageRequest` 是**可展開的物件字面值**，不是 `t.Object`——端點寫成 `t.Object({ ...BaseRequest, ...PageRequest, keyword })`，讓基底欄位與業務欄位平鋪在同一層。固定代碼欄位必須用聯集字面值，不可只寫 `t.Integer()`：

```ts
// apps/api/src/modules/shifts/main/shifts-main.routes.ts
const ShiftWorkTypeSchema = t.Union([t.Literal(1), t.Literal(2), t.Literal(3), t.Literal(4)])
```

```ts
// ✅ 正確：共用型別，一處修改全域生效
body: t.Object({ requestId: Uuid, workDate: IsoDate, reason: Reason })
// ❌ 錯誤：就地重寫，長度限制與別的端點不一致
body: t.Object({ requestId: t.String(), workDate: t.String(), reason: t.String({ maxLength: 200 }) })
```

### 6.2 Request body schema：真實宣告

以 `apps/api/src/modules/shifts/main/shifts-main.routes.ts` 的 `list` 端點為例：

```ts
.post('/shifts/main/list', (context) => handleShiftList(dependencies, context), {
  body: t.Object({
    ...BaseRequest,
    cmd: t.Literal('shifts.main.list'),           // cmd 必須收窄成字面值
    keyword: t.Optional(t.String({ maxLength: 128 })),
    workTypeCode: t.Optional(ShiftWorkTypeSchema),
    isActive: t.Optional(t.Boolean()),
    ...PageRequest,
    sort: t.Optional(sortRequest(SHIFT_SORT_FIELDS)),  // 排序欄位白名單
  }),
  response: {
    200: envelope(paginationResponse(ShiftSearchSchema, ShiftSummarySchema)),
    401: envelope(t.Null()),
    403: envelope(t.Null()),
    500: envelope(t.Null()),
  },
  detail: {
    summary: '查詢班別清單',
    description: describeShiftErrors(SHIFT_ENDPOINT_ERRORS.list),
  },
})
```

**`cmd` 一律用 `t.Literal('<推導值>')`**，不得手寫成別的字串——這既是契約也是端點清單快照比對的依據（見 §10）。

### 6.3 Response schema：`envelope(dataSchema)`，不是繼承

`envelope()` 定義在 `apps/api/src/shared/envelope.ts`，是**包裝函式，不是基底類別**（§1.7）——不建立 `BaseResponse` 給每支端點 `extends`，也不為每支端點手寫 `XxxResponse` 型別：

```ts
export const envelope = <TData extends TSchema>(dataSchema: TData) =>
  t.Unsafe<EnvelopeBody<Static<TData>>>(t.Intersect([BaseResponse, t.Object({ data: dataSchema })]))
```

查無資料的端點用 `Nullable(...)` 包一層；非業務失敗（401/403/500）與業務失敗（409/422）用共用物件展開，不逐支重寫：

```ts
response: { 200: envelope(Nullable(ShiftDetailSchema)), ...CommonFailureResponses }

const CommonFailureResponses = { 401: envelope(t.Null()), 403: envelope(t.Null()), 500: envelope(t.Null()) } as const
const BusinessFailureResponses = { 409: envelope(t.Null()), 422: envelope(t.Null()) } as const
```

### 6.4 List response 的組裝：`paginationResponse`

```ts
// apps/api/src/shared/field-schemas.ts
export const paginationResponse = <TSearch extends TSchema, TItem extends TSchema>(
  searchSchema: TSearch,
  itemSchema: TItem,
) => t.Object({ search: searchSchema, sort: SortRequest, pagination: Pagination, data: t.Array(itemSchema) })
```

`Pagination` 三欄用 TypeBox 原生的 `Type.Integer`，不是 Elysia 的 `t.Integer`：Elysia 把 `t.Integer` 重新定義成可強制轉型（給 query string 用），而分頁回應的三個數字是後端自己算出來的，不該被「字串也能通過」放寬，否則前端型別會混進 `string | number`。

## 7. 路由檔的分組結構

固定兩層巢狀：**入口群組 → 認證群組 → 端點**（§1.9）。端點檔（`*.routes.ts`）本身看不到任何「要不要驗身分」的字眼——認證方式是群組的屬性，由路由組裝點決定要把哪個 plugin 掛進哪個群組。

**唯一的組裝點**是 `apps/api/src/app/routes.ts`，只有這一個檔案能 import `modules/*/routes.ts`：

```ts
// apps/api/src/app/routes.ts
const publicGroup = (dependencies: AppDependencies) =>
  new Elysia({ name: 'public-group' }).use(publicGuard).use(sessionsMainPublicRoutes(toSessionsContext(dependencies)))

const authenticatedGroup = (dependencies: AppDependencies) => {
  const { database, clock, cipher } = dependencies
  return new Elysia({ name: 'authenticated-group' })
    .use(identityGuard(dependencies.accessControl))
    .use(sessionsMainAuthenticatedRoutes(toSessionsContext(dependencies)))
    .use(shiftsMainRoutes({ db: database, clock }))
    .use(departmentsMainRoutes({ db: database, clock }))
  // ……其餘模組
}

// 三個認證群組的具名清單，供端點清單快照使用（§10）
export const AUTHENTICATION_GROUPS = [
  { id: 'public', build: publicGroup },
  { id: 'refresh', build: refreshGroup },
  { id: 'authenticated', build: authenticatedGroup },
] as const

// 掛載順序刻意由寬到嚴：公開群組排最前，被多驗一次的絕不會是登入端點本身
export const registerRoutes = (dependencies: AppDependencies) =>
  new Elysia({ name: 'web-frontend-entry' })
    .use(publicGroup(dependencies))
    .use(refreshGroup(dependencies))
    .use(authenticatedGroup(dependencies))
```

本系統目前三個認證群組：

| 群組    | 憑證來源                        | 憑證驗證器                                                                                                                | 續期行為         |
| ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 公開    | 無                              | `publicGuard`（明確的「不驗」，不是留空——見 `apps/api/src/http/public-guard.ts`：`new Elysia({ name: 'public-guard' })`） | 不續期           |
| refresh | `sundial_refresh_ticket` cookie | `refreshGuard`                                                                                                            | 不續期，改為發證 |
| 已登入  | `Authorization: Bearer`         | `identityGuard`                                                                                                           | 續期             |

`identityGuard`（`apps/api/src/http/identity-guard.ts`）示範一個非公開群組要做的事：讀憑證 → 驗證 → 續期並寫進 `requestContext.session` → 由路徑推導權限碼比對授權，任一步失敗就地回 401/403，不進 handler（節錄，實際檔案對兩種 403 情境分別記不同的 log）：

```ts
export const identityGuard = (ports: AccessControlPorts) =>
  new Elysia({ name: 'identity-guard' }).use(requestContext).onBeforeHandle({ as: 'scoped' }, async (context) => {
    const token = readBearerToken(context.request.headers.get('authorization'))
    if (token === null) {
      context.set.status = HttpStatus.Unauthorized
      return authRequired()
    }

    const identity = await ports.verifyAccessToken(token)
    if (identity === null) {
      context.set.status = HttpStatus.Unauthorized
      return authRequired()
    }

    const renewal = await ports.renewSession(identity)
    context.requestContext.session = { identity, renewal } // 續期在權限判斷之前，§1.3

    const permissionCode = toPermissionCode(context.path) // 由路徑機械推導，與 cmd 同一函式
    const grantedCodes = await ports.loadPermissionCodes(identity.companyId, identity.companyUserId)
    if (permissionCode === null || !grantedCodes.has(permissionCode)) {
      context.set.status = HttpStatus.Forbidden
      return permissionDenied()
    }
  })
```

**大目錄的出口檔**（例如 `apps/api/src/modules/employments/routes.ts`）只做 `export … from`，把次目錄的 `*.routes.ts` 匯總給組裝點；模組本身**不建立群組、不宣告驗證方式**（§1.9）：

```ts
export { employmentsMainRoutes } from './main/employments-main.routes.ts'
export { employmentsDepartmentHistoriesRoutes } from './department-histories/employments-department-histories.routes.ts'
```

## 8. handler 的標準四步形狀

`*.handler.ts` 的每個函式只做四件事：**取出已驗證身分 → 把 body 轉成 service 輸入 → 呼叫 service → 用 `resolveServiceResult` 把結果收成 `data`**。以 `apps/api/src/modules/shifts/main/shifts-main.handler.ts` 的 `handleShiftCreate` 為例：

```ts
export const handleShiftCreate = async (
  dependencies: ShiftsMainDependencies,
  context: EndpointContext<ProfileBody>,
): Promise<EndpointResult<ShiftDetailData>> => {
  const identity = requireIdentity(context.requestContext.session) // ① 取身分
  const result = await createShift(toShiftContext(dependencies, identity), toProfileInput(context.body)) // ②③ 轉輸入、呼叫 service
  const outcome = resolveServiceResult(result, toShiftDetailData) // ④ 收成 data
  context.set.status = outcome.status
  return outcome.body
}
```

- **禁止把驗證後的 request 型別直接丟進 domain**，也**禁止把 service／repository 的回傳值直接指派給 `data`**——`toShiftDetailData` 這類映射函式是強制的，否則資料表加一個欄位就自動出現在 API 上。
- handler **不得自行填** `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自組 `errors`。
- 一個模組的所有端點 handler 放在同一個 `*.handler.ts`（§0.4 明定不拆）。

## 9. 端點必須宣告的錯誤碼清單

每支端點的錯誤碼清單來自該模組的 `*.errors.ts`（例如 `apps/api/src/modules/shifts/main/shifts-main.errors.ts`），三層構成：

1. **錯誤碼常數**，四段式、由模組路徑機械推導（`<大目錄>.<次目錄>.errors.<訊息名>`）：

   ```ts
   export const ShiftErrorCode = {
     CodeDuplicated: 'shifts.main.errors.code-duplicated',
     NotFound: 'shifts.main.errors.not-found',
     // ……
   } as const satisfies Record<string, ErrorCode>
   ```

2. **建構函式**，回傳帶分組（`ErrorGroup.Conflict`／`Unprocessable`／`Forbidden`）的 `DomainError`：`shiftCodeDuplicated = (): DomainError => ({ group: ErrorGroup.Conflict, code: ShiftErrorCode.CodeDuplicated, msg: ShiftErrorCode.CodeDuplicated, data: { field: 'code' } })`。分組決定邊界層映射的 HTTP status（§3）。

3. **端點錯誤碼宣告表**，每支端點列出自己可能吐出的碼，**不會吐錯誤的端點也要宣告空陣列**：

   ```ts
   export const SHIFT_ENDPOINT_ERRORS = {
     list: [],
     get: [],
     create: [conflict(ShiftErrorCode.CodeDuplicated), ...STRUCTURE_ERRORS],
     update: [unprocessable(ShiftErrorCode.NotFound), conflict(ShiftErrorCode.CodeDuplicated), ...STRUCTURE_ERRORS],
     delete: [unprocessable(ShiftErrorCode.NotFound), conflict(ShiftErrorCode.StateChanged)],
   } as const satisfies Record<string, readonly ShiftErrorDeclaration[]>
   ```

這份表餵進路由的 `detail.description`（`describeShiftErrors(...)`），成為 OpenAPI 上看得到的契約——**未宣告的 `errors[].code` 不得在執行期出現**（§1.8.3），由測試斷言（斷言到的碼必須在宣告清單內）把關。`*.errors.ts` **不得 import 任何 http／elysia 模組**：分組用具名常數表達，「分組在某入口對應什麼狀態碼」是入口的事，不是業務層的事。

## 10. OpenAPI 契約由程式碼產生

**路由宣告的 schema 是契約的唯一真相**，OpenAPI 文件由 `bun run gen:api` 產生，禁止手寫或手動維護 spec 檔（§1.7）。指令鏈：

```text
apps/api/src/app/app.ts 的路由宣告（唯一真相）
  ├─▶ openapi.json                             對外契約，機器可讀，不進版控
  └─▶ apps/web/src/api/generated/
        ├─ api-types.ts    由 openapi.json 產生的 TypeScript 型別
        ├─ api-guard.ts    執行期形狀檢查
        └─ api-client.ts   每支端點一個函式
```

`package.json` 的 script 是 `"gen:api": "bun run apps/api/scripts/generate-api.ts"`。這支腳本**只 import app 定義，不 `listen`、不連 DB、不讀 `.env`**（呼叫 `buildApp(contractOnlyDependencies())`）：**`app/` 這一層不能有副作用**——一旦組裝 app 需要先連上資料庫或啟動監聽，`gen:api` 在新人第一天、在 CI 沒有 DB service 的 job 裡就會直接失敗，「契約由程式碼產生」這句話就等於做不到。`ci` script 因此把 `gen:api` 排在**不需要 DB 的位置**（`check && typecheck && gen:api && typecheck:web && check:layers && …`）。`envelope` 在 OpenAPI 上表達成 `allOf [BaseResponse, { data }]`（§6.3），缺一項 schema 在 OpenAPI 上就是空洞（`{}`），前端只能被迫手寫 DTO。

**端點清單快照測試**（`apps/api/src/app/__tests__/endpoint-inventory.test.ts`，讀取邏輯在 `apps/api/src/app/endpoint-inventory.ts`）把每支端點的 `path`、`cmd`、**所屬認證群組**、必填欄位序列化成一份進版控的快照檔。這是拿掉版本前綴（§1.6）之後補的洞：OpenAPI 產生物不進版控，改一行 schema 不會出現在 PR diff 裡，但快照檔會——路徑改名、端點被搬到另一個認證群組、欄位從選填變必填，都會在快照上變成一段紅綠對照。快照同時免費做了兩項檢查：每支端點必須有 body schema 且 `cmd` 收窄成字面值；200 response 必須是 `envelope(...)` 的**同一個** `BaseResponse` 物件（`===` 比對，逐字相同的手寫 `t.Object` 也會被擋下）。

## 11. 新增一支端點的檢查清單

新增端點前，先確認目錄與模組已依 §0 建好；動手時逐項核對：

- [ ] 路徑是 `/<大目錄>/<次目錄>/<動作>` 三段，前兩段與 `modules/<大目錄>/<次目錄>/` 完全一致，動作片段與全站既有用詞一致（不是同義詞的新變體）。
- [ ] `cmd` 用 `t.Literal('<路徑機械轉換值>')`，不是手寫字串。
- [ ] `body` 引用 `...BaseRequest`（與 `...PageRequest`，若是 list）並平鋪業務欄位；沒有宣告 `query`／`params`。
- [ ] `body` 裡沒有 `companyId`、沒有 `status`（狀態變更走專屬動作端點）。
- [ ] 所有欄位長度／格式限制引用 `field-schemas.ts` 的共用型別，沒有就地重寫 `t.String({ maxLength: ... })`。
- [ ] 固定代碼欄位用 `t.Union([t.Literal(...)])`，不是 `t.Integer()`。
- [ ] `response` 用 `envelope(dataSchema)`，成功之外列出該端點可能回的每一種失敗 status（401/403/500 是共用的 `CommonFailureResponses`；有業務規則的加 `BusinessFailureResponses` 或個別列 409/422）。
- [ ] 查無資料的端點用 `Nullable(...)` 包 `data`。
- [ ] 在該模組的 `*.errors.ts` 補上這支端點的錯誤碼宣告（沒有業務錯誤也要宣告空陣列），並在 `detail.description` 用 `describeXxxErrors(...)` 帶出去。
- [ ] handler 遵守四步形狀：取身分 → 轉輸入 → 呼叫 service → `resolveServiceResult` 映射成 `data`；沒有手工組 envelope。
- [ ] 端點的 `.post(...)` 掛在正確的認證群組內（模組出口檔只 `export`，實際 `.use()` 只在 `apps/api/src/app/routes.ts`）。
- [ ] 若是 list 端點：`perPage`／`currentPage`／`sort`（帶欄位白名單）都在，`search`／`sort` 回聲透過 `toListView` 組裝，不自己填。
- [ ] 跑 `bun run gen:api` 確認能在未連 DB 的情況下產出契約，且新端點出現在 `openapi.json`。
- [ ] 跑一次端點清單快照測試，確認新增的一行（`path | cmd | authGroup | requiredBodyFields`）符合預期，並更新快照檔。
