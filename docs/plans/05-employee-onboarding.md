# 實作計畫：建立員工（組織、任職與單頁新增）

> Schema 依據：[01-company-access-organization.md](../schema/01-company-access-organization.md)、[02-employee-payroll-cost.md](../schema/02-employee-payroll-cost.md)
> UI 依據：[20-employee-list.md](../ui/20-employee-list.md)、[08-ui-organization-structure.md](../ui/08-ui-organization-structure.md)（皆已定案）
> 開發規範依據：[dev-standards-backend.md](../dev-standards-backend.md)、[dev-standards-frontend.md](../dev-standards-frontend.md)

## 1. 目標

**讓「新增員工」這一頁真的送得出去。**

現況：`employees` 只有人員主檔（編號、姓名、性別、身分證、生日、電話、Email、地址），而 UI 定案要的是

> 新增員工採單頁輸入，不分步驟，一次建立**員工、任職、組織關係、登入帳號及角色**。
> 員工、任職、帳號及角色應一次建立；**任一失敗時整筆取消**。

那一頁需要的表，目前一張都沒有。

## 2. 為什麼這條線值得優先

`employee_employments` 不只是員工模組要它。**排班、出勤、薪資全部綁 `employment_id`**：

```
employee_schedules.employment_id            排班
attendance_records.employment_id            出勤
attendance_correction_requests.employment_id 補打卡
payrolls.employment_id                      薪資單
employee_salary_settings.employment_id      薪資設定
```

[04 班別設定](04-shift-definitions.md) §2 就是因為它不存在，才只做得了班別、做不了排班。

**做這條線的效益不是解開一個畫面，是一次解開四個模組的前置。**

---

## 3. 要建的表

現有 14 張表裡沒有任何一張屬於組織或任職。

### 3.1 擋住整個新增流程的（UI 上是必填）

| 表                              | 對應欄位                           | 前置           |
| ------------------------------- | ---------------------------------- | -------------- |
| `departments`                   | 部門（**必填**）                   | 無（自關聯樹） |
| `employee_employments`          | 僱用類型（必填）、任職性質、到職日 | `employees`    |
| `employee_department_histories` | 部門歸屬                           | 上面兩張       |
| `employee_withholding_settings` | 薪資扣繳方式（**必填**）           | `employees`    |

### 3.2 UI 上「依公司設定」

| 表                                                   | 欄位           |
| ---------------------------------------------------- | -------------- |
| `job_titles` ＋ `employee_job_title_histories`       | 職稱           |
| `job_positions` ＋ `employee_job_position_histories` | 職務（可多個） |

可做成非必填，但**列表欄位有「職稱」**——不做的話那一欄永遠空白。

### 3.3 可建立後補登

`employee_dependents`（眷屬，UI 明說可後補）、`employee_labor_pension_settings`（勞退自願提繳率）。

### 3.4 已經有的

**帳號與角色不必做。** `company_users`、`company_user_roles`、`roles` 都在，角色指派端點也上線了。UI 要的「一定建立登入帳號、至少指派一個角色」是把既有能力接進同一個交易。

---

## 4. 三個必須先解決的設計問題

### 4.1 跨模組的單一交易：每一支參與的 service 都要能收外部交易

UI 定案要求「任一失敗時整筆取消」，而這一筆橫跨**四個以上的大目錄**：

```
employees          人員主檔
employments        任職（新）
departments        部門歷史（新）
company-users      登入帳號
company-users/roles 角色指派
withholding        扣繳設定（新）
audit              稽核（每一項異動）
```

**現況做不到**：只有 `recordAudit(tx, ...)` 收外部交易 handle，其餘 service 各自開自己的連線。任一支中途失敗，前面已經 commit 的就留在資料庫裡——**一個沒有任職、沒有帳號的員工**，而畫面上會顯示成一列正常的資料。

**定案：所有會被編排進同一筆業務的 service 動作，一律收交易 handle 作為第一個參數。** 與 `recordAudit` 同一形狀，理由也同一條（[02 稽核](02-audit-logs.md) §5）：自己另開連線的話，外層 rollback 時它不會跟著回捲。

**編排點放哪：新開一個 `employees/onboarding` 次目錄。**

不放進 `employees/main.create`，因為那會讓「建立人員主檔」與「建立一個完整的員工」變成同一支函式的兩種行為，而呼叫端從簽章上看不出差別。次目錄名為 `onboarding`（子實體是「到職這件事」，不是「員工」），符合 §0.2。

### 4.2 既有的 `employees/main/create` 必須關掉對外的口

它現在只建人員主檔。單頁新增上線之後，系統會有**兩條建立員工的路**，而其中一條會產出「沒有任職、沒有帳號」的員工。

**那不是可以用文件約束的事**——下一個人看到兩支端點都叫 create，會挑看起來簡單的那一支。

**定案：`/employees/main/create` 端點移除**，其 service 動作保留但只被 `onboarding` 呼叫（§0.4 明文允許「沒有端點的業務動作」放在入口檔）。權限碼 `employees.main.create` 一併停用。

> 這是**破壞性變更**。目前沒有任何前端在用它（員工頁還沒做），所以現在改的成本是零；等前端接上去之後再改就要走兩步走（§1.6）。

### 4.3 有效期間不得重疊，而資料庫擋不住

三張表都有這個約束：

- `employee_employments`：同一員工同一時間最多一筆有效任職
- `employee_department_histories`：同一任職同一時間只能有一筆有效部門
- `employee_withholding_settings`：同一員工的有效期間不得重疊

**MariaDB 沒有 exclusion constraint，這三條沒有任何 DB 約束擋得住。** 純應用層檢查在併發下必漏：兩個請求同時讀到「沒有重疊」，然後兩個都寫進去。

**定案**（比照 [01 法規](01-regulatory-dataset-versioning.md) 對 `company_regulatory_settings` 的處置）：

- 加 `UNIQUE(<擁有者>, effective_from)` 擋掉最常見的同日重複
- 寫入前對該擁有者的既有紀錄 `SELECT ... FOR UPDATE` 序列化

不完美，但把失敗模式從**靜默重疊**變成**拿不到鎖而失敗**。

`employee_job_position_histories` 是例外——字典明文「同一任職可同時有多個有效職務，但同一職務期間不得重疊」，鎖的粒度是 `(employment_id, job_position_id)`。

---

## 5. `departments`：自關聯樹的四個坑

字典：「公司部門主檔，以自關聯建立無限層級組織樹」。UI 定案（`docs/ui/08`）是左右分欄的樹狀列表。

四件事字典沒寫，本計畫定案：

1. **不得成環。** `parent_id` 指到自己的子孫會讓任何遞迴查詢無限跑。寫入前檢查「新的上層是不是自己的子孫」，是則拒絕。
2. **不得跨公司。** `parent_id` 必須與自己同公司——複合外鍵 `(company_id, parent_id) → departments(company_id, id)`，理由同 `audit_logs`：單欄外鍵讓 A 公司的部門掛在 B 公司底下，而**資料庫完全接受**。
3. **有子部門時不得刪除**，也不得在有成員時刪除。字典說「成員人數由員工目前有效的部門歷史紀錄計算，不存入 `departments`」，所以那個檢查要去查歷史表。
4. **搬移子樹**（改 `parent_id`）是合法操作，但**不改寫任何員工的部門歷史**——歷史記的是「那一天他在哪個部門」，部門自己搬家不改變那件事。

---

## 6. 稽核：這條線會用掉 [02](02-audit-logs.md) 的 Stage 2

UI 定案與資料字典明列這些必須留稽核，而它們全都在這條線上：

- 員工建立、**員工編號修改**
- 基本資料修改
- **任職資料與離職操作**
- **部門、職稱及職務異動**
- 眷屬新增、修改及終止
- 扣繳方式與勞退自願提繳率異動
- 帳號啟用、停用及管理者重設密碼
- 角色指派與撤銷

[02 稽核](02-audit-logs.md) 的 Stage 2（補三筆欠帳）**必須在這條線之前或同時完成**——否則這一整批異動全部沒有紀錄，而稽核事後補不回來。

**連帶**：`audit_logs.subject_id` 已經是 `varchar(64)`，`employee_employments` 的 `uuid` 存得下。

---

## 7. 離職

字典的約束要照做：

- `leave_date`、`last_working_date`、`leave_reason_code` **同時必填**
- `last_working_date ≤ leave_date`
- 完成後**同步停用該員工的 `company_users`**，但**不刪除帳號與角色歷史**
- 離職不修改舊任職，**回任是新增一筆**

離職是一個獨立的業務動作（不是 `update`），因為它同時動到任職與帳號，而那是一個交易。

---

## 8. 分階段

### Stage 1 — `departments`

表 ＋ 模組 ＋ 端點 ＋ 前端組織架構頁（UI 定案 `docs/ui/08` 有規格）。**沒有前置，可以先做完整一塊。**

### Stage 2 — 稽核 Stage 2

補 [02](02-audit-logs.md) 的三筆欠帳。排在這裡是因為 Stage 3 開始的每一個動作都要留紀錄。

### Stage 3 — 任職與扣繳

`employee_employments`、`employee_department_histories`、`employee_withholding_settings` 三張表 ＋ 期間重疊的鎖（§4.3）。

### Stage 4 — 交易編排

所有參與的 service 改成收交易 handle（§4.1）、新增 `employees/onboarding` 次目錄、移除 `/employees/main/create` 端點（§4.2）。

**驗收**：一次建立員工＋任職＋部門＋帳號＋角色＋扣繳；**故意讓角色指派失敗，確認前面五項全部沒有留下**。

### Stage 5 — 職稱與職務

`job_titles`／`job_positions` 兩張主檔 ＋ 兩張歷史表。

### Stage 6 — 前端員工清單與新增／修改／離職

UI 定案 `docs/ui/20`。修改採分頁呈現、每個分頁獨立儲存。

### Stage 7 — 眷屬與勞退自願提繳率

補登類，可最後做。

---

## 9. 明確不在本計畫內

| 項目                       | 為什麼                                           |
| -------------------------- | ------------------------------------------------ |
| 薪資設定、薪轉帳戶         | 屬於薪資模組                                     |
| 排班、出勤                 | 本計畫交付 `employment_id` 之後才輪到它們        |
| 員工自助入口、我的資料     | 另有 UI 定案，等這條線完成                       |
| 「歷史紀錄」分頁的整合查詢 | 字典說由各歷史表與稽核紀錄整合查詢，那是另一件事 |

## 10. 已定案的決策

- **§4.1** 所有參與同一筆業務的 service 一律收交易 handle；編排點是新的 `employees/onboarding` 次目錄
- **§4.2** 移除 `/employees/main/create` 端點（現在改成本為零）
- **§4.3** 期間重疊用 `UNIQUE(擁有者, effective_from)` ＋ `SELECT ... FOR UPDATE`
- **§5** 部門樹的四條規則（不成環、不跨公司、有子或有成員不得刪、搬移不改寫歷史）
- **§6** 稽核 Stage 2 排在任職之前
