# 安全規範

本章對應 `docs/dev-standards-backend.md` §5（行 1143–1272）：密碼與敏感個資、權限檢查、稽核紀錄、
access token ＋ refresh token 雙票認證。共通手法是「靠型別逼你做對」：權限碼由路徑機械推導、禁止
手寫；`recordAudit` 收 `TransactionRunner` 而不是 `QueryRunner`，傳裸連線池進去在編譯期就報錯；
加密欄位有版本化格式；refresh 票只認一個端點、一次性輪替、重用即偷用。寫新端點前先確認：落在哪個
認證群組、有沒有欄位要加密與遮罩、這個動作要不要寫稽核。

## 目錄

1. [密碼與敏感個資](#1-密碼與敏感個資)
2. [權限檢查](#2-權限檢查)
3. [稽核紀錄](#3-稽核紀錄)
4. [認證雙票：access token ＋ refresh token](#4-認證雙票access-token--refresh-token)
5. [路由檔的認證群組怎麼選](#5-路由檔的認證群組怎麼選)
6. [新增端點的安全檢查清單](#6-新增端點的安全檢查清單)

---

## 1. 密碼與敏感個資

**密碼只保存單向 hash**：用 `Bun.password`，演算法固定 **Argon2id**
（`modules/sessions/main/domain/session-password.ts`）：

```ts
export const hashPassword = (plainPassword: string): Promise<string> =>
  Bun.password.hash(plainPassword, { algorithm: 'argon2id' })

export const verifyPassword = (plainPassword: string, storedHash: string): Promise<boolean> =>
  Bun.password.verify(plainPassword, storedHash, 'argon2id')
```

密碼錯回 `false`，不拋例外（§3.1.2）。查無帳號時要拿一個誰都不知道原文的假 hash 陪跑一次同樣的
Argon2id 驗證，否則「帳號存在（數十毫秒）」與「不存在（近乎即時）」的回應時間差會洩漏答案：

```ts
const ABSENT_ACCOUNT_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=2,p=1$...'
export const passwordHashToVerify = (storedHash: string | null): string => storedHash ?? ABSENT_ACCOUNT_PASSWORD_HASH
```

**禁止**保存、log、回傳明碼或 hash；管理者重設密碼要寫稽核，但**內容不得含密碼與 hash**。

**敏感個資（身分證、生日、電話、Email、地址）一律進 `*_encrypted` 欄位**（AES-256-GCM，
`apps/api/src/db/field-encryption.ts`），需比對重複的另存固定長度 `*_hash`（HMAC-SHA256 blind
index）：

```ts
export type FieldCipher = {
  encrypt(plaintext: string): Buffer
  decrypt(stored: Uint8Array): string
  blindIndex(plaintext: string): Buffer
}
```

儲存格式版本化，每次加密用隨機 IV（**同一明文每次加密結果不同**，GCM 的正確用法），因此加密欄位不
能比等，重複檢查一律走 blind index。加密金鑰與 blind index 金鑰**不得相同**，`createKeyRing` 啟動
時就擋下共用——索引金鑰外洩只讓人驗證「某值在不在」，加密金鑰外洩是整批明文。呼叫端範例
（`modules/employees/main/domain/employee-secrets.ts`）：

```ts
export const toEncryptedColumns = (cipher: FieldCipher, profile: EmployeeProfileInput): EncryptedEmployeeColumns => {
  const identityNumber = normalizeIdentityNumber(profile.identityNumber) // 先正規化再加密／算雜湊
  return {
    identityNumberEncrypted: cipher.encrypt(identityNumber),
    identityNumberHash: cipher.blindIndex(identityNumber),
    birthdayEncrypted: cipher.encrypt(profile.birthday),
    // ……phone / email / address 同理
  }
}
```

**禁止**新增這些資料的明文欄位或明文索引——資料庫一旦備份外流，加密欄位是唯一防線。

**對外回應一律遮罩，且遮罩發生在解密的當下**（`apps/api/src/db/field-masking.ts`），§5.1 寫死身分
證僅末 3 碼、銀行帳號僅末 4 碼：

```ts
const IDENTITY_NUMBER_VISIBLE_TAIL = 3
export const maskIdentityNumber = (identityNumber: string): string =>
  keepTail(identityNumber, IDENTITY_NUMBER_VISIBLE_TAIL)

// 解密後立刻遮罩，明文不往上層帶（employee-secrets.ts）
export const toMaskedSummary = (cipher: FieldCipher, row: EmployeeSummaryRow): EmployeeSummary => ({
  id: row.id,
  employeeCode: row.employeeCode,
  identityNumberMasked: maskIdentityNumber(cipher.decrypt(row.identityNumberEncrypted)),
})
```

輸出型別上根本不留明文欄位（只有 `xxxMasked`），漏寫一次遮罩是編譯錯誤，不是執行期才發現的疏忽：

```ts
// ✅ 正確
export type EmployeeSummary = { readonly identityNumberMasked: string }
// ❌ 錯誤：留一個明文欄位，指望 handler 記得呼叫遮罩函式——漏一支不會有任何測試變紅
export type EmployeeSummary = { readonly identityNumber: string }
```

**禁止把敏感值寫進 log 或 `errors[].data`**；log 一律先過欄位遮罩。敏感識別值的唯一性檢查只能回
「無法建立」，不能回聲哪一筆撞到、也不能回聲使用者送來的原值（等於幫攻擊者確認這個值存在）：

```ts
// employees-main.errors.ts —— data 只有欄位名，不提員工編號、不提原始身分證
export const employeeIdentityNumberDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: EmployeeErrorCode.IdentityNumberDuplicated,
  msg: EmployeeErrorCode.IdentityNumberDuplicated,
  data: { field: 'identityNumber' },
})
```

跨公司存取一律回「目標不存在」，與真的不存在**逐字相同**；實作上是查詢一律帶 `company_id`
（§4.2），兩條路徑自然走到同一行，不是「記得回同一句」。

---

## 2. 權限檢查

**兩層模型**：路由層做粗粒度權限（有沒有這個功能權限），service 層做細粒度檢查（是不是本人、是否
同公司、目標狀態允不允許）。只做粗粒度會退化成「有功能權限就能查任何人的資料」。

粗粒度檢查在 `apps/api/src/http/identity-guard.ts`，順序固定：驗票 → 續期 → 由路徑推導權限碼 →
查使用者實際擁有的權限碼 → 比對：

```ts
const identity = await ports.verifyAccessToken(token)
if (identity === null) {
  /* 401 + 900 */
}

const renewal = await ports.renewSession(identity) // 續期先做，與後續結果無關
context.requestContext.session = { identity, renewal }

const permissionCode = toPermissionCode(context.path) // 路徑機械推導
if (permissionCode === null) {
  /* 路徑不合法，一律拒絕 */
}

const grantedCodes = await ports.loadPermissionCodes(identity.companyId, identity.companyUserId)
if (!grantedCodes.has(permissionCode)) {
  /* 403 + 901，仍回續期後的 expiresIn */
}
```

細粒度檢查沒有共通中介層可掛：**查詢一律帶 `company_id`**，讓跨公司與不存在自然變成同一條路徑，
不是先查出資料再用 `if` 擋（漏一支就是一支真的越權查詢）。

**權限碼由路徑機械推導，禁止手寫**：規則與 `cmd`（§1.3）相同，去掉開頭 `/`、把 `/` 換成 `.`
（`shared/path-code.ts` 的 `pathToCode` ＝ `toPermissionCode`）：

```ts
// ✅ 正確：/employees/main/update → employees.main.update，identityGuard 執行期算，不必手寫
// ❌ 錯誤：在路由檔或角色設定裡手寫常數
const REQUIRED_PERMISSION = 'employees.update' // 與機械推導的 employees.main.update 對不上
```

漏掉會怎樣：路徑改名時手寫碼不會跟著改也不會變紅，角色設定裡授予的碼再也對不上端點，該權限**實際
上授不出去**（一律 403），或被別支端點誤用。多支端點共用權限時，在角色設定裡授予多個碼，不是讓兩
支端點共用同一碼——後者會讓推導規則失去自動檢查能力。公開群組內端點沒有權限碼。

**「本人」關係一律由 token 推導**，禁止信任請求帶來的識別碼。`VerifiedIdentity`
（`shared/access-control.ts`）只含 `sessionId`／`userId`／`companyId`／`companyUserId`。真實案例
（`sessions-main.logout-all.service.ts`）：作廢範圍是 `identity.companyUserId`，body 裡**沒有任何
欄位可以指定別人**——先做成「只能對自己」，日後開放管理者代踢時加新端點與新權限碼，不是在這支上加
一個「可選的目標成員」欄位（漏檢查一次就是越權）。

**權限 port 宣告在 `shared/access-control.ts`（只有型別），接線在 `app/session-access-control.ts`
（純組裝，一行判斷都沒有）**：

```ts
export type AccessControlPorts = {
  readonly verifyAccessToken: AccessTokenVerifier
  readonly renewSession: SessionRenewer
  readonly loadPermissionCodes: PermissionLookup
}

export const createAccessControlPorts = (context: SessionsMainContext): AccessControlPorts => ({
  verifyAccessToken: (accessToken) => verifyAccessToken(context, accessToken),
  renewSession: () => Promise.resolve(renewSession(context)),
  loadPermissionCodes: (companyId, companyUserId) => listPermissionCodes(context.db, companyId, companyUserId),
})
```

`AccessControlPorts`／`RefreshControlPorts` 刻意分開：合成一包會讓「已登入群組拿得到 refresh 票驗
證能力」在型別上成立，違反「refresh 票只認一個端點」。

漏掉會怎樣：端點沒落在任何認證群組，掃描器擋下（§1.9.2）；細粒度檢查漏掉的話不會報錯，只是「查得
到不該查到的那一筆」——因此每個端點都要有「無權限被 403」與「非本人被拒絕」測試。

---

## 3. 稽核紀錄

**白名單政策**：`modules/audit/main/domain/audit-field-policy.ts` 逐表逐欄宣告能記到什麼程度，三
級——`Value`（記前後值）、`Presence`（只記「變更了」不記值）、`Excluded`（明確不記）。未分類的欄位
執行期直接拋例外，掃描階段也變紅（黑名單的失敗模式是半年後加一欄沒人記得補，自動被記進稽核，不會
報錯）：

```ts
employees: {
  source: 'modules/employees/main/domain/employee-model.ts#EmployeeProfileInput',
  fields: {
    employeeCode: AuditFieldLevel.Value,        // 對外可見識別碼，記值不擴大外洩面
    identityNumber: AuditFieldLevel.Presence,   // 資料字典明文禁止身分證進稽核內容
    birthday: AuditFieldLevel.Presence,         // 對應 *_encrypted 欄位者一律 presence
  },
},
```

判準是機械的：對應 `*_encrypted` 欄位者一律 `presence`——記前後值會讓明文落在加密邊界之外
（`audit_logs.changes` 不加密、append-only），也會讓稽核變成遮罩規則的旁路。**必須寫稽核的類別**：
個資異動、金額設定異動、帳號啟停用與密碼重設、角色權限指派撤銷、審核結果變更。每筆至少記操作者、
時間、動作類型、資料主體、異動前後差異、必要時的生效日——缺「異動前值」等於沒寫。逐欄差異必須比對
**解密後的明文**，不能比密文：GCM 每次寫入 IV 不同，比密文會讓每次更新都誤判身分證被改過
（`buildAuditChanges`，入口 `modules/audit/index.ts`）。

**稽核與業務寫入必須同一交易，由型別在編譯期強制**：

```ts
// apps/api/src/db/client.ts
export type TransactionRunner = QueryRunner & Pick<DbTransaction, 'rollback'>
```

`recordAudit` 收 `TransactionRunner` 不是 `QueryRunner`——後者連線池與交易物件都滿足，會讓
`recordAudit(context.db, ...)`（裸連線池）與 `recordAudit(tx, ...)`（交易內）在編譯器眼裡等價。改
成 `TransactionRunner` 後前者是**編譯錯誤**（`rollback()` 只有交易物件有）。這條規則原本靠一支讀
語法樹的掃描腳本擋，現在型別接手，腳本只防「合法重構把裸連線池包裝成看起來像交易」這種型別擋不住
的邊角情形。真實呼叫（`employees-main.create.service.ts`）：

```ts
export const createEmployeeInTransaction = async (
  tx: TransactionRunner,
  context: EmployeesMainContext,
  input: CreateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => {
  const outcome = await insertEmployee(tx, context.cipher, context.companyId, { id: employeeId, profile: input, now })
  if (outcome === 'duplicate-code') return fail([employeeCodeDuplicated()])

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employees.main.create',
    subjectTable: 'employees',
    subjectId: employeeId,
    changes: buildAuditChanges('employees', null, input),
    effectiveDate: null,
    now,
  })
  // ……
}
```

`recordAudit` 失敗（拋例外）讓外層交易一起失敗——稽核沒有 `ServiceResult`，政策未分類、動作碼寫錯
都是系統錯誤（§3.1.2）；「改得成但沒有紀錄」本來就不該發生。一次編排橫跨多張表時
（`employees/onboarding/impl/employees-onboarding.create.service.ts`），**每一步各自呼叫一次
`recordAudit(tx, ...)`**，編排點本身不再另記一筆（否則同一項異動被記兩遍），規則因此自動成立，因
為每一步共用同一個 `tx`。

單一模組內、橫跨兩張表的簡單版本更好對照（`employments/main/impl/employments-main.leave.service.ts`）：
離職這個動作在同一個 `tx` 裡先更新任職資料記一筆稽核（`subjectTable: 'employee_employments'`），
再同步停用該員工的 `company_users` 帳號記第二筆稽核（`subjectTable: 'company_users'`），兩筆
`action` 相同（都是 `employments.main.leave`），差別只在主體：

```ts
await recordAudit(tx, {
  companyId: context.companyId,
  actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
  action: 'employments.main.leave',
  subjectTable: 'employee_employments',
  subjectId: input.id,
  changes: buildAuditChanges('employee_employments', beforeSnapshot, afterSnapshot),
  effectiveDate: input.leaveDate,
  now,
})

// 同步停用帳號（計畫 §7）。傳入本交易自己的 `tx`——見檔頭第 2 點。
const deactivation = await deactivateCompanyUser(tx, context.companyId, before.employeeId, now)
if (deactivation !== null) {
  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employments.main.leave',
    subjectTable: 'company_users',
    subjectId: deactivation.companyUserId,
    changes: buildAuditChanges('company_users', { status: 'ACTIVE' }, { status: 'INACTIVE' }),
    effectiveDate: null,
    now,
  })
}
```

判準要再精確一點：`deactivateCompanyUser`（`company-users/main/impl/company-users-main.deactivate.service.ts`）
本身**不呼叫 `recordAudit`**——它的檔頭明講「稽核由呼叫端負責」。所以「每一步各自記一筆」的「每一
步」是指每一項需要記的異動，不是每一個被呼叫的下游函式：下游動作若自己會記（像
`createEmployeeInTransaction`），編排點就不再重記；下游動作若設計成不記（像
`deactivateCompanyUser`），編排點就要替它把那一筆補上——兩種情況合起來仍然是「每項異動恰好一
筆」，不會因為呼叫鏈的形狀不同而漏記或重記。

測試怎麼驗證多筆稽核：`employments-main.audit.test.ts`「★ 離職留下兩筆稽核」那條，用
`subjectTable` 分開查詢（`employee_employments` 應有兩筆——`create`／`leave` 各一；`company_users`
應有一筆），對每一筆各自比對 `action`／`effectiveDate`／逐欄 `changes`，證明兩筆稽核各自完整、不
是只斷言「稽核表多了兩列」就收工。

系統自己偵測到的安全事件（偷用偵測，`sessions-main.revoke-on-reuse.service.ts`）
同樣把作廢與稽核包進同一交易——沒有交易時最糟結果是「作廢失敗、稽核成功」，紀錄說已作廢但攻擊者的
票其實還能用：

```ts
return context.db.transaction(async (tx) => {
  const revokedTokenIds = await revokeMemberChains(tx, identity.companyId, identity.companyUserId, {
    at: now,
    reason: RefreshTokenRevokeReason.ReuseDetected,
  })
  await recordAudit(tx, {
    companyId: identity.companyId,
    actor: { type: 'system' },
    action: 'sessions.main.refresh-token-reuse',
    subjectTable: 'company_users',
    subjectId: identity.companyUserId,
    changes: buildAuditChanges('company_users', null, {
      revokedTokenIds: serializeTokenIds(revokedTokenIds),
      reusedTokenId,
    }),
    effectiveDate: null,
    now,
  })
  return { revokedCount: revokedTokenIds.length }
})
```

```ts
// ❌ 錯誤：稽核另開連線池，rollback 時不會跟著回滾，且這行現在是編譯錯誤
await recordAudit(context.db, {/* ... */}) // context.db 不滿足 TransactionRunner
```

**稽核紀錄只能新增**：`audit-main.repository.ts` 永遠不會有 update／delete。空的 `changes` 也要寫
入——靜默跳過等於抹去「送出了一次修改、結果什麼都沒改」這個有價值的訊號。

---

## 4. 認證雙票：access token ＋ refresh token

|                   | 用途                                                     | 壽命                                              |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------- |
| **access token**  | 每次請求攜帶，用於身分驗證                               | 滑動視窗 2 小時，每次驗證通過即續期，且可即時撤銷 |
| **refresh token** | 只用於 `POST /sessions/main/refresh` 換發新 access token | 30 天                                             |

refresh token **只認一個端點**，出現在其他請求上一律視為錯誤。access token 續期不需要 refresh
token 參與，人還在操作滑動視窗就一直往後推。

**一次性輪替與偷用偵測**：每次 refresh，refresh token 也一併換新，舊的立即作廢；已作廢的票再次被
使用一律視為外洩，觸發該使用者所有 refresh token 全部作廢（`apps/api/src/http/refresh-guard.ts`）：

```ts
const verification = await ports.verifyRefreshTicket(rawTicket)
if (verification.outcome === 'reuse-detected') {
  await ports.revokeAllChainsOnReuse(verification.identity, verification.ticketId)
  logger.error(LogCategory.SecurityEvent, '偵測到已作廢的 refresh token 被重複使用，已作廢該成員的所有登入', {
    companyId: verification.identity.companyId,
    companyUserId: verification.identity.companyUserId,
  })
  context.set.status = HttpStatus.Unauthorized
  return authRequired()
}
```

**驗證與消耗是同一次條件式 UPDATE**，不拆兩步——拆開會讓兩個併發請求同時通過驗證、各自換到新票，
「舊票已作廢」這個前提就不成立。換票沿用同一條鏈（`sessionId` 不變），登出才能作廢得到整條鏈：

```ts
const ids = {
  sessionId: consumed.identity.sessionId,
  ticketId: crypto.randomUUID(),
  accessTokenId: crypto.randomUUID(),
}
```

登出作廢**整條鏈**，不是只作廢手上那一張——多分頁情境下手上的票不一定是最新那張，只作廢單張會出現
「畫面回到登入頁，session 卻沒斷」。登出所有裝置作廢**本人在本公司的所有登入，含當前裝置，沒有例
外**。

**儲存通道**：refresh token 走 **httpOnly + Secure + SameSite=Lax cookie**，access token 由前端存
記憶體（不進 `localStorage`）。全專案只有 `apps/api/src/http/refresh-ticket-transport.ts` 知道
refresh 票放在 cookie 裡：

```ts
export const REFRESH_TICKET_COOKIE_NAME = 'sundial_refresh_ticket'
const toSetCookieValue = (delivery: RefreshTicketDelivery): string => {
  const attributes = ['HttpOnly', 'Secure', 'SameSite=Lax', `Path=${COOKIE_PATH}`]
  if (delivery.kind === 'revoke') return [`${REFRESH_TICKET_COOKIE_NAME}=`, ...attributes, 'Max-Age=0'].join('; ')
  return [`${REFRESH_TICKET_COOKIE_NAME}=${delivery.ticket}`, ...attributes, `Max-Age=${delivery.maxAgeSeconds}`].join(
    '; ',
  )
}
```

端點不讀也不寫這個 cookie，只透過 `http/session-lifetime.ts` 的四個具名寫入點表意圖：
`recordIssuedSession`（發證）、`endSession`（登出後清空）、`deliverRefreshTicket`（交付新票）、
`withdrawRefreshTicket`（收回舊票）。`SameSite` 定案 `Lax`：本系統所有端點都是同源 POST XHR，
`Strict` 多買到的安全性趨近於零，代價卻是日後通知功能的外部連結會被誤導去登入頁。

**換發流程**：①客戶端帶 refresh cookie 打 `/sessions/main/refresh` → ②`refreshGuard` 驗票並同時消
耗它 → ③`refreshSession` 讀回剛消耗的那列以沿用同一條鏈的 30 天截止時刻（不重算，否則鏈可無限延
長），簽發新的一對票 → ④handler 呼叫 `deliverRefreshTicket` 交付新 cookie，回應 body 只帶新 access
token（refresh token 永遠不進 body）。

**access token 必須可即時撤銷，不做跨請求快取**：每個請求都查一次這條鏈是否還活著，同時完成續期
（`sessions-main.verify-access.service.ts`）：

```ts
const active = await touchAccessSession(
  context.db,
  claims.companyId,
  claims.sessionId,
  now,
  context.clock.after(context.session.accessTokenTtlSeconds),
)
if (!active) return null
```

> **規範與實作的落差**：§5.4.6 論證「額外成本接近零，撤銷狀態可搭權限碼查詢一起取回」，但
> `verify-access.service.ts` 檔頭明講**本實作沒有做到「同一次查詢」**——撤銷狀態在
> `refresh_tokens`（`sessions` 模組），權限碼在 `company_user_roles`（`company-users` 模組），跨
> 大目錄 join 違反 §0.3。實際成本是每個請求多一次資料庫往返，寫新程式碼時不要假設兩者已合流。

**明確不做的事**：本系統不做 step-up authentication，查看薪資、個資不會要求重新輸入密碼，因此輪替
偵測、登出所有裝置、改密碼作廢所有 session 是唯一防線，效力全部建立在「access token 即時撤銷」之
上。前端不得另外實作重新驗證的提示或流程。

> **規範與實作的落差**：§5.4.5 要求 `POST /credentials/main/update`（改密碼）與
> `POST /credentials/main/reset`（重設密碼）成功後作廢使用者所有 session。目前
> `apps/api/src/modules/` 底下**沒有 `credentials` 這個大目錄**，這兩支端點尚未實作——
> `session-password.ts` 的註解也寫著「目前只有測試與日後的 `credentials/main/*` 會用到」。補上時
> 必須照「作廢範圍含當前裝置、沒有例外」與「與密碼變更同一交易」的規則走。

---

## 5. 路由檔的認證群組怎麼選

認證方式是**群組的屬性**，端點自己不宣告（§1.9.1）。全系統只有三個認證群組，在唯一的路由組裝點
（`apps/api/src/app/routes.ts`）建立：

| 群組    | 憑證來源                        | 憑證驗證器                                | 續期行為         |
| ------- | ------------------------------- | ----------------------------------------- | ---------------- |
| 公開    | 無                              | `publicGuard`（明確的「不驗」，不是留空） | 不續期           |
| refresh | `sundial_refresh_ticket` cookie | `refreshGuard`                            | 不續期，改為發證 |
| 已登入  | `Authorization: Bearer`         | `identityGuard`                           | 續期             |

端點若分屬多個群組，模組的 `routes.ts` 要匯出多個 plugin。真實案例
（`modules/sessions/main/sessions-main.routes.ts`）：登入落公開群組，登出落已登入群組，各自是獨立的
具名匯出：

```ts
export const sessionsMainPublicRoutes = (dependencies: SessionsMainDependencies) =>
  new Elysia({ name: 'sessions-main-public-routes' }).post(
    '/sessions/main/login',
    (context) => handleLogin(dependencies, context),
    {/* ... */},
  )

export const sessionsMainAuthenticatedRoutes = (dependencies: SessionsMainDependencies) =>
  new Elysia({ name: 'sessions-main-authenticated-routes' }).post(
    '/sessions/main/logout',
    (context) => handleLogout(dependencies, context),
    {/* ... */},
  )
```

組裝點（`app/routes.ts`）決定哪個 plugin 掛進哪個群組——三行看得見的程式碼，掛錯就是掛不上：

```ts
const publicGroup = (dependencies: AppDependencies) =>
  new Elysia({ name: 'public-group' }).use(publicGuard).use(sessionsMainPublicRoutes(toSessionsContext(dependencies)))

const authenticatedGroup = (dependencies: AppDependencies) =>
  new Elysia({ name: 'authenticated-group' })
    .use(identityGuard(dependencies.accessControl))
    .use(sessionsMainAuthenticatedRoutes(toSessionsContext(dependencies)))
    .use(employeesMainRoutes({ db: database, cipher, clock })) // ……其餘業務模組
```

**新端點需要身分**：掛進已登入群組（多數情況）。**新端點刻意公開**：放進公開群組這個具名分組，不
能靠「沒加驗證」表示公開——「忘了加驗證」與「刻意公開」必須長得不一樣，前者是會失敗的檢查，後者是
一個看得見、可以在 PR 上被要求說明理由的宣告。目前沒有其他理由需要新增認證群組。

---

## 6. 新增端點的安全檢查清單

- [ ] 這支端點掛進哪一個認證群組（公開／refresh／已登入）？是刻意的，不是漏掛？
- [ ] 需要哪個權限碼？是路徑機械推導出來的，沒有手寫、沒有跨端點共用同一碼？
- [ ] 有沒有「本人」或「同公司」這類細粒度檢查？由 token 推導，不是信任 body／path 帶來的識別碼？
- [ ] 查詢與寫入是否都帶了 `company_id`，讓跨公司存取與「不存在」自然變成同一條路徑？
- [ ] 這個動作屬不屬於「必須寫稽核」的類別？如果是，`recordAudit` 有沒有與業務寫入收同一個
      `TransactionRunner`？
- [ ] 稽核的 `changes` 有沒有先查過 `AUDIT_FIELD_POLICY`？新加的欄位有沒有分類（沒分類會拋例外，
      不是靜默漏記）？
- [ ] 有沒有經手身分證、生日、電話、Email、地址等敏感欄位？寫入是否走 `FieldCipher` 加密？輸出型
      別上是不是只有 `xxxMasked`，沒有殘留明文欄位？
- [ ] 錯誤訊息與 `errors[].data` 會不會洩漏敏感值、洩漏「這個識別碼存在」這件事本身？
- [ ] log 有沒有可能印出密碼、hash、身分證明文、access token 或 refresh token 的任何片段？
- [ ] 若會發或收 refresh token，是不是透過 `deliverRefreshTicket`／`withdrawRefreshTicket`，不是
      自己動 `Set-Cookie`？
