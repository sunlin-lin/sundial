# 實作計畫：稽核紀錄 `audit_logs`

> Schema 依據：[docs/schema/05-regulatory-system.md](../schema/05-regulatory-system.md)「稽核日誌」
> 開發規範依據：[dev-standards-backend.md](../dev-standards-backend.md)（§ 編號皆指這份）
> 前置於：[01-regulatory-dataset-versioning.md](01-regulatory-dataset-versioning.md)（該計畫的 Stage 0）

## 1. 為什麼先做這件事

資料字典把稽核表留成「已確認功能、表名與逐欄 Schema 尚未定案」，於是前三個模組各自留了一筆欠帳：

| 模組 | 該記卻沒記的事 |
|---|---|
| 角色 | 誰在什麼時候把某個角色指派給某人／撤銷 |
| 員工 | 誰把員工編號從 `E001` 改成 `E002` |
| 登入 | refresh token 被重複使用（可能是憑證外洩） |

**這些欠帳的共同性質是「補不回來」**：稽核紀錄只能在事情發生的當下寫，事後補的表裡不會有已經發生過的異動。每多做一個模組，就多一段永遠空白的歷史。

緊接在後的 `company_regulatory_settings`（公司投保設定）一定會欠第四筆——「誰把公司職災行業別從甲類改成乙類」正是必須留紀錄的異動，而職災費率會跟著變。所以在那之前先把這張表做完。

## 2. 這張表只做稽核

**已定案的邊界：`audit_logs` 只承載「誰改了什麼資料」。**

以下都**不**放進來，日後若有需要各自做自己的紀錄：

- 登入行為、IP、User-Agent、裝置資訊
- 系統執行 log、錯誤 log、效能追蹤
- 使用者瀏覽／查詢行為

理由：混進來之後，這張表會同時被兩種需求拉扯——稽核要求「一筆都不能少、永久保存、不可修改」，行為紀錄要求「量大、可過期清理、可取樣」。兩種保存策略互斥，而混在同一張表裡就只能取其一，通常取到的是後者，於是稽核紀錄跟著被清掉。

**「員工修改頁的歷史紀錄把歷史表與稽核紀錄整合查詢」也不在本輪。** 那是同一種混雜的另一個形式。

---

## 3. `audit_logs`

| 欄位 | 型態 | 必填 | 說明 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `company_id` | `uuid` | 必填 | 所屬公司（全域規則：Tenant 資料必須可追溯至 Company） |
| `actor_type_code` | `integer` | 必填 | 1 公司成員、2 系統（排程／驗證器）。整數而非字串，見下 |
| `actor_company_user_id` | `uuid` | 條件必填 | `actor_type_code=1` 時必填；**複合外鍵**，見 §3.1 |
| `action` | `varchar(150)` | 必填 | 動作碼，由模組路徑推導，見 §4.1 |
| `subject_table` | `varchar(64)` | 必填 | 資料主體所在的表，例如 `employees` |
| `subject_id` | `varchar(64)` | 必填 | 資料主體主鍵的**字串形式**，見 §3.2 |
| `changes` | `json` | 必填 | 逐欄差異，見 §4.2 |
| `effective_date` | `date` | 選填 | 帶生效日的異動才有（部門異動、扣繳方式、投保設定） |
| `created_at` | `datetime` | 必填 | 建立時間，**即字典所稱的「操作時間」**，見 §3.3 |

### 3.0 代碼欄位的型態慣例：`_code` 用整數，狀態用字串

`actor_type_code` 是**全站第一個整數代碼欄位**，而既有的 `gender`、`status`、`revoke_reason` 全是 `varchar` ＋ 字串 const object——看起來像不一致，其實不是。

資料字典一貫的作法是：**欄位名以 `_code` 結尾者用 `integer`，狀態語意的欄位（`status`、`gender`）用 `string`**。既有那幾欄在字典裡標的就是 `string`，所以它們用字串是照字典；`actor_type_code` 用整數也是照字典。日後大量的 `employment_type_code`、`relationship_code`、`leave_reason_code` 都會是整數。

判準寫出來是為了讓下一個人不必重新判斷：**看欄位名的後綴，不看直覺。**（兩者都不使用 DB ENUM，代碼值的唯一來源一律是 TypeScript 的 const object。）

### 3.1 `actor_company_user_id` 是複合外鍵

```sql
FOREIGN KEY (company_id)                            -- 這一條不能省，理由見下
  REFERENCES companies(id),
FOREIGN KEY (company_id, actor_company_user_id)
  REFERENCES company_users(company_id, id)
```

**不是單欄 `actor_company_user_id → company_users.id`。** 專案裡每一個跨公司範圍的 actor 外鍵都是這個形狀（`company-user-roles.ts` 的 `assigned_by`／`revoked_by`、`refresh-tokens.ts`），`company_users` 也早就備好了支撐用的 `uq_company_users_company_id`。

單欄外鍵的破口在既有註解裡已經寫過：**一筆「A 公司的稽核紀錄」可以指向 B 公司的成員，而資料庫完全接受**——查詢有回資料、沒有任何錯誤。稽核紀錄的可信度整個建立在「這個 ID 對得到本公司的人」上面，這個破口等於把它拆掉。

`actor_type_code=2`（系統）時該欄為 NULL。InnoDB 的 MATCH SIMPLE 語意下，複合外鍵只要有任一欄為 NULL 就不檢查，因此 NULL 是合法的——這點與 `company_user_roles.revoked_by` 的先例一致。

#### 為什麼 `company_id → companies.id` 這條單欄外鍵**不能**省

**這一句非寫不可，因為既有檔案的註解說的正好相反。** `refresh_tokens` 與 `company_user_roles` 都明文寫著「`company_id` 由複合外鍵間接受約束，因此不需要（也不該）再單獨拉一條 FK 到 `companies`」——照那句話讀，本表這條會被下一個人當成多餘而順手清掉。

差別在可空性：那兩張表的成員欄位是 `NOT NULL`，複合外鍵永遠會被檢查；**本表的 `actor_company_user_id` 允許 NULL**，而 MATCH SIMPLE 下只要有一欄是 NULL，整條複合外鍵就不檢查。於是**所有 `actor_type_code=2`（系統產生）的列，`company_id` 會完全沒有任何約束**——排程寫進一個不存在的公司 ID，資料庫照收。

系統事件正是最不會有人盯著看的那一類稽核紀錄，這個破口不會有症狀。

### 3.2 `subject_id` 是 `varchar(64)`，不是 `uuid`

**全站的主鍵型態不是只有一種。** 法規三表用 `bigint` auto-increment（見 [01 計畫](01-regulatory-dataset-versioning.md) §3.2），而 `company_regulatory_settings` 的 `id` 也是 `bigint`——**那正是稽核表要服務的第一個對象**（本計畫 §1 的存在理由）。

若 `subject_id` 訂成 `uuid`，會出現文件自相矛盾的局面：一邊說「稽核表非先做不可，因為公司投保設定馬上要用」，另一邊的型態設計讓它用不了。而發現的時機會是那個模組動工的當下，屆時 `audit_logs` 已經上線，已套用的 migration 不得修改（§4.1），只能再加一支 `ALTER` 並轉換既有資料。

因此語意訂為「**主體主鍵的字串形式**」：uuid 直接存，`bigint` 存十進位字串。

> 另一條路是規定「`bigint` 主鍵表不進 `audit_logs`，另行處理」。不採用，因為那會推翻本計畫 §1 的論證本身。

### 3.3 用 `created_at`，不另設 `occurred_at`

字典要求稽核紀錄能表達「操作時間」。**本表的 `created_at` 就是操作時間**——稽核與業務同一個交易寫入（§5），兩者必然相同。

不設兩個時間欄位：並存的話，「哪一個才是真正的操作時間」會變成一個每次讀稽核都要重新想一次的問題，而它沒有意義。

用 `created_at` 這個名字，也讓它落在通用規範 §1.4 的欄位命名慣例內。該節需要一處配套修訂，見 §9。

### 3.4 沒有 `updated_at`，也沒有 `deleted_at`

**這是刻意的，不是漏了。** 稽核紀錄一旦寫入就不得修改或刪除；有這兩欄就等於在 schema 上宣告「這筆可以改」，而下一個人看到別的表都有、這張沒有，第一個念頭會是補上去。

配套：

- service 層**不提供** update／delete 動作（`impl/` 底下不會有這兩個切片）。
- 資料庫帳號層面另給只有 `INSERT`／`SELECT` 權限的連線——**本輪不做**，記在 §8。

### 3.5 索引

| 索引 | 對應的查詢 |
|---|---|
| `(company_id, subject_table, subject_id, created_at)` | 「這筆資料被誰改過」——最主要的用途 |
| `(company_id, created_at)` | 「這家公司最近有哪些異動」 |
| `(company_id, actor_company_user_id, created_at)` | 「這個人做過什麼」 |

三支索引都以 `company_id` 開頭：所有查詢都必須帶公司範圍，索引前綴一致才不會有某支查詢退化成全表掃描。

### 3.6 進 `CompanyScopedTable`

有 `company_id`，因此要加進 `db/schema/index.ts` 的 `CompanyScopedTable` 聯集。這是刻意列舉的名單，新增一張帶公司範圍的表必須動到那個檔案——這一步是看得見的，不會被自動納入。

---

## 4. 三個機制

### 4.1 動作碼由模組路徑推導，不另編一套

```
employees.main.update                誰改了員工
company-users.roles.assign           誰指派了角色
sessions.main.refresh-token-reuse    偵測到憑證重用（無端點，由驗證器產生）
```

**這是同一個機制的第三次使用**：權限碼由路徑推導（§1.1）、i18n 訊息 key 由路徑推導（`sessions.main.errors.invalid-credentials`）、現在動作碼也是。

另編一套整數代碼（`1=建立員工、2=修改員工…`）的代價是**每加一支端點就要做一次命名判斷**，而那沒有標準答案：同一件事在不同人手上會變成 `employee_update`／`update_employee`／`EMPLOYEE_MODIFY`，每一個都「有道理」。由路徑推導則連判斷都不需要——動作在哪個目錄，前兩段就是什麼。

**附帶好處**：「誰被授權做這件事」（權限碼）與「誰真的做了這件事」（稽核動作碼）用的是同一個字串，可以直接對起來。

**沒有端點的事件**（排程、憑證驗證器偵測）沿用同一形狀：`<大目錄>.<次目錄>.<事件名>`，全部 kebab-case。它們不是端點，但一樣屬於某個模組。

### 4.2 逐欄差異，不存「前後兩包」

```json
[
  { "field": "employeeCode", "before": "E001", "after": "E002" }
]
```

**不採用** `{ "before": { 整筆 }, "after": { 整筆 } }`。

理由是具體的：那種寫法會把整筆資料複製兩份，**包含沒有改動的欄位**——而 `employees` 沒改動的欄位裡就有 `identity_number_encrypted`。也就是說，光是改一個員工編號，整份身分證資料就跟著進了稽核表，而那正是資料字典明文禁止的：

> 密碼、密碼 Hash、完整身分證字號與完整銀行帳號不得寫入稽核內容。

逐欄的話，只有真的被改到的欄位才有機會進來，而且每一欄都會先過 §4.3 的政策。

**新增與刪除**也走同一結構：新增時 `before` 為 `null`，刪除時 `after` 為 `null`。不為它們另開一種格式——讀稽核的人不必先判斷這是哪一種事件才知道怎麼解讀 `changes`。

### 4.3 欄位政策：白名單，三級

每一張會被稽核的表，逐欄宣告它能進稽核到什麼程度：

| 級別 | 意思 | 例子 |
|---|---|---|
| `value` | 記前後值 | `employeeCode`、`name`、`departmentId` |
| `presence` | **只記「這一欄變更了」，不記值** | `identityNumber`、`bankAccount`、`password` |
| `excluded` | 明確不記 | `id`、`createdAt`、`updatedAt` |

宣告位置：`modules/audit/main/domain/audit-field-policy.ts`。

#### key 是「業務層欄位名」，不是資料庫欄位名

**這一點必須寫死，否則掃描器會變成一個看起來在跑、其實沒命中任何東西的東西。**

`AUDIT_FIELD_POLICY` 的 key 一律是**業務層的欄位名**（camelCase，與 `EmployeeProfileInput` 那一套輸入型別同一組），因此 `check:audit-policy` 比對的對象是**業務型別的欄位**，不是 Drizzle schema 的欄位。

理由是兩邊的詞彙本來就對不上：**一個業務欄位可能對應多個實體欄位。** 「身分證」在業務上是一個欄位 `identityNumber`，在資料庫裡是兩欄——`identityNumberEncrypted`（密文）與 `identityNumberHash`（blind index）；schema 裡沒有任何一欄叫 `identityNumber`。

若掃描器照「讀 Drizzle schema 比對政策」的字面意思實作，`identityNumber` 對不到任何 schema 欄位，CI 直接紅。**那還算好的，至少會被發現。** 真正危險的是下一步：有人為了讓它過而把掃描器改成鬆散比對（正規化大小寫、剝掉 `_encrypted`／`_hash` 後綴）——從此它驗證的是一份人工拼湊的映射，跟 `recordAudit` 執行時真正收到的欄位集合對不上，而**掃描器是綠的**。

**未出現在政策裡的欄位 → 掃描器變紅**（§6）。三級而不是兩級，是為了讓「刻意不記」與「忘了分類」分得開——只有 `value`／`presence` 兩級的話，`created_at` 這種本來就不該記的欄位會跟漏掉的新欄位長得一模一樣。

**執行期若真的送進未分類的欄位，拋例外（系統錯誤 `400`），不靜默丟棄。** 靜默丟棄的話，稽核會少一欄而沒有任何人知道。

#### 為什麼是白名單而不是黑名單

具體場景：

> 半年後有人在 `employees` 加一欄 `passport_number_encrypted`（護照號碼）。
>
> **黑名單**：沒有人記得把它加進黑名單，於是它自動被記進稽核。不會有任何地方報錯，資料就這樣進去了。
> **白名單**：它沒有被分類，掃描器當場變紅。

兩者的失敗模式差別是：**黑名單漏了 → 敏感資料外洩，而且沒有症狀；白名單漏了 → 稽核少一欄，會紅。**

#### 判準（已定案）：對應到 `*_encrypted` 欄位的業務欄位一律 `presence`

**生日、電話、Email、地址一律只記「有調整」，不記內容。** 這是明確的定案，不是保守的暫時處置——請勿日後「補上」前後值。

字典禁止寫入的名單是「密碼、密碼 Hash、**完整**身分證字號、**完整**銀行帳號」，這四樣確實不在名單上。**擴大到所有 `*_encrypted` 欄位是刻意的**，因為 `changes` 是未加密且 append-only 的 JSON，寫明文進去有兩個具體後果：

1. 在加密邊界之外留下一份**永久且刪不掉**的副本——欄位加密等於被繞過，而且是被我們自己的稽核繞過的。
2. 稽核變成 §5.1 遮罩規則的旁路：同一份地址，員工詳情端點會遮罩，稽核卻是完整的。於是「看不到完整地址」這條限制，只要有稽核查詢權限就形同不存在。

代價是實的、也是接受的：查稽核只看得到「地址在某天被改過」，看不到「從 A 改成 B」。字典把「基本資料修改」列為必須稽核的事件，而「誰在何時動了這個人的哪一個欄位」已經滿足那個要求——**稽核要回答的是「有沒有人動過」，不是「現在的值是什麼」**，後者去查資料本身即可。

判準做成機械規則（看是不是 `*_encrypted` 欄位）而不是逐欄判斷，是為了讓下一張表不必重新討論一次：新增的個資欄位只要是加密的，級別就已經決定了。

#### `presence` 這一級是必要的

資料字典明列「帳號啟用、停用及管理者重設密碼」要稽核，也明列密碼不得寫入。兩條同時成立的唯一解就是**記事件、不記值**。身分證同理——「誰改了某人的身分證」是重要異動，但號碼不能進去。

`presence` 級的 `changes` 長這樣：

```json
[
  { "field": "identityNumber", "changed": true }
]
```

刻意**不**帶 `before`／`after` 欄位（而不是塞 `"***"`）：塞遮罩字串的話，讀的程式仍然要判斷「這個值是真的還是遮罩」，而判斷錯的後果是把 `***` 當成使用者真的填了三個星號。結構不同，就沒有這個判斷。

### 4.4 `presence` 的變更判定必須基於明文

**這一節是 `presence` 這一級能不能成立的關鍵，不是實作細節。**

三條規則：

1. **`recordAudit` 收到的 `before`／`after` 一律是業務層的明文物件**（`EmployeeProfileInput` 那一套），不是資料庫 row。`audit-change-set.ts` 是零 IO 的純函式，它比對的是已經解密／解析好的業務值。
2. **加密欄位的變更判定在加密之前完成**：拿使用者送進來的明文，比對資料庫現值解密後的明文，兩者不同才標 `changed: true`。
3. **Stage 1 必須有這筆測試**：「只改姓名 → `identityNumber` 不得出現在 `changes` 裡」，而且**測試不得使用確定性的 mock cipher**。

#### 不寫死這三條會發生什麼

員工更新是**全量提交**——`UpdateEmployeeInput = { id } & EmployeeProfileInput`，使用者送出表單時身分證明文會原封不動地一起送回來、再被重新加密一次。而 AES-256-GCM **每次寫入的 IV 都不同**（`0006` migration 與 `field-encryption.ts` 都寫明了這件事，那是刻意的設計，不是意外）。

於是：**HR 只改了一個電話號碼，`identityNumberEncrypted` 的密文也一定跟改之前不同。**

如果變更判定是拿密文位元組去比，這一次更新就會產生 `{ "field": "identityNumber", "changed": true }`——身分證根本沒被動過。

**這不是偶發，是每一次員工資料更新都會發生。** 稽核表裡「這個人的身分證被改過幾次」會變得跟「這個人的資料被改過幾次」完全同義，`presence` 這一級存在的唯一理由（把「真的動了敏感欄位」這個訊號分辨出來）整個失效。

第 3 條那句「不得使用確定性 mock cipher」是配套：用固定 IV 的假加密器寫的測試，密文相同就相同，**完全看不出這個問題，CI 全綠**。

### 4.5 政策是兩層結構：外層資料表名，內層業務欄位名

**這一節是為了防止上一節被誤讀。** §4.3 花了整段強調「不要混用資料庫詞彙與業務詞彙」，而政策本身**兩種詞彙都用**——只是用在不同層：

```ts
export const AUDIT_FIELD_POLICY = {
  // 外層 key = 資料表名（snake_case），也就是 subject_table 的合法值
  employees: {
    // 型別來源要明寫，掃描器靠它找到要比對的欄位清單
    source: 'modules/employees/main/domain/employee-model.ts#EmployeeProfileInput',
    // 內層 key = 業務層欄位名（camelCase），見 §4.3
    fields: {
      employeeCode: 'value',
      name: 'value',
      identityNumber: 'presence',
      // ...
    },
  },
} as const
```

- **外層是資料表名**，因為它要當 `subject_table` 的值——那一欄記錄的是「這筆稽核講的是哪張表的哪一列」。
- **內層是業務欄位名**，因為它要對上 `recordAudit` 實際收到的 `changes`（§4.3）。
- **`source` 明寫型別來源**，不用目錄慣例去猜。掃描器要知道拿哪一個型別的欄位清單來比對，靠約定命名的話，改檔名就會讓它安靜地掃不到東西。

`subject_table` 的合法值就是外層 key 的聯集，型別上收斂。不另外維護一份「哪些表會被稽核」的清單：多維護一份的下場是兩邊會少一邊，而少的那邊不會報錯。

---

## 5. 寫入時機：與業務同一個交易

`recordAudit` 收一個交易 handle，由呼叫端傳入：

```ts
recordAudit(tx, { companyId, actor, action, subjectTable, subjectId, changes, effectiveDate, now })
```

- `actor` 是**可辨識聯集**（公司成員 / 系統），因此「`actor_type_code=1` 卻沒有成員 ID」在型別上寫不出來，不必靠 runtime 檢查。
- `now` 由呼叫端注入，且**必須與同一交易的業務寫入用同一個值**（§6、§3.3）：稽核在 service 內自己取一次時間的話，同一筆操作會出現兩個相差幾毫秒的時間戳，而事後沒有任何方式判斷哪一個才是「操作時間」。
- `id` 在 service 內產生。

`changes` 由入口的另一支動作產生：

```ts
buildAuditChanges(subjectTable, before, after)
```

**它必須放在入口 service，不能讓呼叫端直接用 `domain/` 的純函式。** §0.3 規定 `index.ts` 只 export service，其他模組本來就拿不到 `domain/`；而套政策這件事若散到各模組自己做，§4.3 的白名單就有了繞過的路徑——那道牆的價值全在「沒有第二條路」。

**它必須與業務寫入同生共死。**

- 自己另開連線的話，業務 rollback 時稽核不會跟著 rollback，於是庫裡會出現「稽核說改過、資料實際沒改」的紀錄——而查稽核的人沒有任何辦法分辨那一筆是真的還是幽靈。
- 丟 queue 事後補的話，漏記**等於沒有稽核**，而且漏記沒有症狀：沒有錯誤、沒有告警，只有事後查不到那一筆。

稽核寫入只是一次 INSERT，失敗機率跟業務寫入同級；把它排除在交易外並沒有換到多少可用性。

**代價要講清楚：稽核寫失敗，業務也會失敗。** 這是接受的——「改得成但沒有紀錄」在稽核的語意下就是不該發生的事。

---

## 6. 模組結構

```
modules/audit/
├── index.ts                          → service（所有其他模組由此呼叫）
└── main/
    ├── audit-main.service.ts         入口：recordAudit、buildAuditChanges
    ├── audit-main.repository.ts      入口：insertAuditLog
    ├── domain/
    │   ├── audit-action.ts           動作碼的型別（由模組路徑推導）
    │   ├── audit-field-policy.ts     ★ 欄位政策，見 §4.3
    │   └── audit-change-set.ts       逐欄 diff 的純函式（不碰 IO）
    ├── impl/
    │   ├── audit-main.record.service.ts
    │   └── audit-main.insert.repository.ts
    └── __tests__/
```

次目錄叫 `main`：這個子實體就是這個領域本身（§0.2）。

**沒有 `routes.ts`、`handler.ts`、`errors.ts`**，三者都不是漏掉：

- 本輪不開任何端點（§7），所以沒有 routes 與 handler。
- 稽核寫入不是使用者發起的動作，**沒有業務錯誤可以收集**（§3.1.1）。政策違規是程式錯誤，屬於系統錯誤，拋例外處理。

`recordAudit` 是「沒有端點的業務動作」，§0.4 已經涵蓋這種情形：它一樣放入口檔，因為它同樣是這個次實體對外的介面，只是呼叫者不是前端而是其他模組。

**大目錄層沒有 `routes.ts`**，這也不是漏掉。§0.3 規定的是「對外有哪兩個出口、各自能被誰 import」，不是「兩個都必須存在」。補上判準（通用規範 §7.6 要求規則的補集必須可枚舉）：**零端點的大目錄可以只有 `index.ts`**；生一個什麼都不 re-export 的 `routes.ts` 只會多一個空殼，而路由組裝點還是得記得別去 import 它。

### 6.1 檢查腳本：欄位分類完整性

新增 `bun run check:audit-policy`，掛進 `ci`：

- 讀**業務層輸入型別**的欄位清單（見 §4.3「key 是業務層欄位名」），比對 `AUDIT_FIELD_POLICY`。**不是**讀 Drizzle schema——兩邊的詞彙對不上，理由見該節。
- 有欄位未被分類 → 失敗。
- 政策裡有型別上已經不存在的欄位 → 失敗（欄位改名時政策沒跟著改，會讓那一欄變成未分類而不自知）。
- **自我檢查**（通用規範 §7.2）：掃到的型別數與欄位數必須大於零，否則腳本本身視為失敗。

### 6.2 呼叫覆蓋率：`recordAudit` 漏呼叫怎麼辦

**這是本計畫唯一沒有辦法完全兌現「一筆都不能少」的地方，寫在這裡而不是略過。**

§5 保證的是「`recordAudit` 一旦被呼叫，就會與業務同生共死」。它**不保證**它一定被呼叫——工程師新增一支端點時忘了寫那一行，型別不會反應、既有測試不會紅、CI 沒有訊號、也不會有例外。而稽核紀錄事後補不回來（§1）。

本輪採取的措施：

- **資料字典稽核範圍清單裡的每一個動作，都必須有一支整合測試**，斷言「執行這個動作之後，`audit_logs` 恰好新增預期筆數、`subject_table` 組合正確、`changes` 內容正確」。
- Stage 2 的驗收條件逐項列出這份清單（見 §7）。
- **多實體動作要驗全部主體**：一個業務動作若動到兩張表（例如日後的員工＋任職），測試要斷言「有且僅有預期的 `subject_table` 組合」，不能只驗其中一張。只記到一半比完全沒記更難察覺——「查得到紀錄」會讓人以為稽核是完整的。

**這只擋得住已經列入清單的動作，擋不住「新增了一個沒人想到要列進清單的動作」。** 這句話要留著，不要在日後被讀成「稽核覆蓋率有保障」。

> 曾考慮但本輪不採：讓寫入切片回傳一個必須被消費掉的 audit token，由入口層檢查。它能把漏呼叫變成編譯錯誤，但要改動每一個 service 的回傳型別，而且會讓「這個動作不需要稽核」變成一個必須繞過型別系統的操作——那條逃生口一開，保證就跟現在一樣強而已。

---

## 7. 分階段

### Stage 1 — 表與寫入機制

- migration `0010_create_audit_logs.sql`
- Drizzle schema、`CompanyScopedTable` 加入
- `audit` 模組（§6 的結構）
- `check:audit-policy` 掃描腳本（§6.1）
- 測試：政策三級各自的行為、未分類欄位拋例外、`recordAudit` 在交易 rollback 時不留紀錄
- **測試：「只改姓名 → `identityNumber` 不得出現在 `changes` 裡」，且不得使用確定性 mock cipher**（§4.4）

### Stage 2 — 補上三筆欠帳

| 模組 | 動作碼 | 主體 |
|---|---|---|
| 角色指派／撤銷 | `company-users.roles.*` | `company_users` |
| 員工建立／修改／刪除 | `employees.main.*` | `employees` |
| refresh token 重用偵測 | `sessions.main.refresh-token-reuse` | `refresh_tokens`，`actor_type_code=2` |

順手把 `employees` 與 `company_users` 的欄位政策補齊——這一步做完，`check:audit-policy` 才會第一次真的擋到東西。

三個動作各自要有 §6.2 所要求的整合測試。

**驗收**：改一次員工編號、指派一次角色、觸發一次 token 重用，三筆稽核都進得去且內容正確；`employees` 的身分證欄位在稽核裡只有 `changed: true`，沒有值；而**只改姓名時身分證不出現在 `changes` 裡**。

---

## 8. 本輪不做

| 項目 | 為什麼 | 什麼時候 |
|---|---|---|
| **稽核查詢端點** | 已定案：稽核歸稽核，不與歷史表整合查詢。純稽核的查詢等有明確使用場景再開 | 有使用場景時 |
| **登入行為、IP、User-Agent** | 已定案：不放進這張表，見 §2 | 各自做自己的紀錄，另有規劃 |
| **只有 INSERT 權限的資料庫帳號** | 屬於部署層設定，不是應用程式碼 | 部署規劃時 |
| **保存期限與清理** | 見 §10 | — |

## 9. 連帶要改的規範（**已完成**）

> 本節已於 Stage 1 前完成，`docs/dev-standards-general.md` §1.4 已寫入補集。保留下面的說明，是因為那條規則的理由屬於本計畫。

**通用規範 §1.4 原本只寫「主檔表必備 `created_at`、`updated_at`」，沒有定義什麼不是主檔表。**

`audit_logs` 是 append-only 的事件流水表：它必須有 `created_at`（§3.3），也必須**沒有** `updated_at`／`deleted_at`（§3.4）——這兩件事在現行條文下同時成立不了，而該條標了 ✅（schema 掃描）。

要補的判準：

> 主檔表必備 `created_at`、`updated_at`；**append-only 的事件流水表只需 `created_at`，且不得有 `updated_at`、`deleted_at`。**

不補的話，掃描器實作那天只能各自解讀 `audit_logs` 屬於哪一類——而通用規範 §7.6 本身就要求「普世規則必須有可判定的定義域與可枚舉的補集」，這條規則現在的補集是空的。

> 那支 schema 掃描器目前還沒有實作（規範裡的 ✅ 檢查多數尚未落地），所以現在不會真的紅。但規則在，實作那天就會撞上。

## 10. 待定（不擋本輪）

**`excluded` 這一級目前沒有任何真實條目。** §4.5 把政策 key 的定義域釘在業務輸入型別上（`EmployeeProfileInput`），而那種型別裡本來就不含 `id`、`createdAt` 這類欄位——§4.3 舉的 excluded 例子在 `employees` 政策裡一個都放不進去（放了掃描器的「政策有、型別沒有」那條會紅）。也就是說，三級設計裡「刻意不記 vs. 忘了分類」這個區分，在純輸入型別上暫時沒有作用。等到有政策的來源型別確實含有不該記的欄位時，它才會第一次派上用場。這一級先留著，但不要以為它現在在做事。

**稽核紀錄要保留多久？** 資料字典沒有規定。不刪的話這張表會無限成長——以每家公司每天數百筆估算，幾年後是千萬列等級的表，而 §3.5 的三支索引會跟著長。

現在不需要決定（頭一兩年不會有問題），但**要在有量之前決定**，因為屆時「刪掉三年前的稽核」會是一個需要法遵確認的動作，不是技術決定。先記在這裡。
