# 公司、角色權限與組織

## 公司功能重點

- SaaS 多公司；`id` 與業務用 `company_code` 分離。
- 公司 Code：統編＋3 碼流水號；個人 Code：建立日 `YYYYMMDD`＋3 碼流水號；無分隔符。
- 流水號只增不減、不重用；`company_code` 全域唯一。
- 同一負責人可以對應多家公司，身分證 Hash 不作為拒絕建立公司的唯一條件。
- 地址直接放公司主檔，只有登記、實際、發票三組。
- 負責人、業務、會計統一放聯絡人表。

## `companies`

**資料表註釋：** SaaS Tenant／公司或個人雇主主檔，保存法定識別、三組地址及系統狀態。

**設計理由：** 將公司作為 Tenant 根節點，可讓所有公司資料以 company_id 隔離；業務編號與內部 UUID 分離，避免可讀編碼規則影響關聯主鍵。三組地址直接隨公司保存，是因目前只確認固定三種地址，尚無建立通用地址子表的需求。

| 欄位名稱                 | 資料型態   | 必填性 | 欄位註釋               |
| ------------------------ | ---------- | ------ | ---------------------- |
| `id`                     | `uuid`     | 是     | PK，系統內部 Tenant ID |
| `company_code`           | `string`   | 是     | 全域唯一業務編號       |
| `company_type`           | `string`   | 是     | 公司／個人；不用 ENUM  |
| `legal_type`             | `string`   | 是     | 法律型態               |
| `tax_id`                 | `string`   | 條件   | 統編；公司型主體使用   |
| `name`                   | `string`   | 是     | 正式名稱／個人姓名     |
| `short_name`             | `string`   | 否     | 簡稱                   |
| `registered_postal_code` | `string`   | 選填   | 登記地址郵遞區號       |
| `registered_city`        | `string`   | 選填   | 登記地址縣市           |
| `registered_district`    | `string`   | 選填   | 登記地址行政區         |
| `registered_address`     | `string`   | 選填   | 登記地址詳細內容       |
| `actual_postal_code`     | `string`   | 選填   | 實際地址郵遞區號       |
| `actual_city`            | `string`   | 選填   | 實際地址縣市           |
| `actual_district`        | `string`   | 選填   | 實際地址行政區         |
| `actual_address`         | `string`   | 選填   | 實際地址詳細內容       |
| `invoice_postal_code`    | `string`   | 選填   | 發票地址郵遞區號       |
| `invoice_city`           | `string`   | 選填   | 發票地址縣市           |
| `invoice_district`       | `string`   | 選填   | 發票地址行政區         |
| `invoice_address`        | `string`   | 選填   | 發票地址詳細內容       |
| `status`                 | `string`   | 是     | 公司資料狀態           |
| `created_at`             | `datetime` | 是     | 建立時間               |
| `updated_at`             | `datetime` | 是     | 修改時間               |
| `deleted_at`             | `datetime` | 否     | Soft delete            |

約束：`UNIQUE(company_code)`。識別碼、統編、郵遞區號均用字串，不用整數。

## `company_contacts`

**資料表註釋：** 公司負責人、業務與會計聯絡窗口；Company 1:N Contacts。

**設計理由：** 聯絡人與公司主檔分表，是因同一公司可有負責人、業務、會計等多個窗口，且敏感資料需要個別加密與雜湊；如此不會讓公司主檔因聯絡人數量增加而重複。

| 欄位名稱                    | 資料型態   | 必填性 | 欄位註釋                       |
| --------------------------- | ---------- | ------ | ------------------------------ |
| `id`                        | `uuid`     | 是     | PK                             |
| `company_id`                | `uuid`     | 是     | FK → `companies.id`            |
| `contact_type`              | `string`   | 是     | `OWNER`／`SALES`／`ACCOUNTING` |
| `name`                      | `string`   | 是     | 姓名，明文                     |
| `identity_number_encrypted` | `binary`   | 條件   | 身分證加密值                   |
| `identity_number_hash`      | `binary`   | 條件   | 查詢 Hash；不是公司唯一限制    |
| `birthday_encrypted`        | `binary`   | 否     | 生日加密值                     |
| `phone_encrypted`           | `binary`   | 否     | 電話加密值                     |
| `email_encrypted`           | `binary`   | 否     | Email 加密值                   |
| `created_at`                | `datetime` | 必填   | 建立時間                       |
| `updated_at`                | `datetime` | 必填   | 修改時間                       |

## 角色／權限

### UI 規劃補充

- 系統設定下設「權限／角色」頁面。
- 左側為單一角色清單，不在 UI 區分預設／自訂；右側顯示角色資料與大／小權限樹。
- 支援新增、編輯、停用及刪除角色；刪除使用 `deleted_at` Soft Delete。
- 已被公司成員使用的角色必須先移轉才能刪除；公司最後一個管理角色不得刪除。
- `permissions` 後續建議補 `is_assignable` 與 `sort_order`。
- 帳號／公司成員與角色的關聯尚未定案；待帳號模型確認後再正式命名與定義，不直接補猜 Schema。
- 詳細流程見 [07-ui-role-permission.md](../ui/07-ui-role-permission.md)。

### `roles`

**資料表註釋：** 公司角色主檔；不預先寫死 HR、主管等角色。

**設計理由：** 角色採公司內可設定的主檔，不把 HR、主管等名稱寫死，讓各公司能建立自己的權責模型； is_system 用來區分系統預設與公司自訂角色。

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋            |
| ------------- | ---------- | ------ | ------------------- |
| `id`          | `uuid`     | 必填   | PK，角色唯一識別碼  |
| `company_id`  | `uuid`     | 必填   | FK → `companies.id` |
| `code`        | `string`   | 必填   | 公司內角色代碼      |
| `name`        | `string`   | 必填   | 角色名稱            |
| `description` | `string`   | 選填   | 角色用途說明        |
| `is_system`   | `boolean`  | 必填   | 是否系統預設角色    |
| `status`      | `string`   | 必填   | 角色狀態，不用 ENUM |
| `created_at`  | `datetime` | 必填   | 建立時間            |
| `updated_at`  | `datetime` | 必填   | 修改時間            |
| `deleted_at`  | `datetime` | 選填   | Soft Delete 時間    |

### `permissions`

**資料表註釋：** 系統權限主檔，以自關聯建立任意層級的大權限／次權限。

**設計理由：** 權限獨立於角色並以 parent_id 自關聯，可讓同一權限被多個角色重用，也能建立不限固定層數的權限樹，因此不需要額外的 permission_type。

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋                             |
| ------------- | ---------- | ------ | ------------------------------------ |
| `id`          | `uuid`     | 必填   | PK，權限唯一識別碼                   |
| `parent_id`   | `uuid`     | 選填   | FK → `permissions.id`；根權限為 NULL |
| `code`        | `string`   | 必填   | 權限唯一代碼                         |
| `name`        | `string`   | 必填   | 權限名稱                             |
| `description` | `string`   | 選填   | 權限用途說明                         |
| `status`      | `string`   | 必填   | 權限狀態，不用 ENUM                  |
| `created_at`  | `datetime` | 必填   | 建立時間                             |
| `updated_at`  | `datetime` | 必填   | 修改時間                             |
| `deleted_at`  | `datetime` | 選填   | Soft Delete 時間                     |

`permission_type` 最終不採用；層級只由 `parent_id` 表示。

### `role_permissions`

**資料表註釋：** 角色與權限多對多關聯。

**設計理由：** 角色與權限是多對多關係，使用純關聯表可避免在角色或權限欄位中存放清單；複合唯一鍵已能識別一組綁定，所以不另設沒有業務意義的 id。

| 欄位名稱        | 資料型態   | 必填性 | 欄位註釋              |
| --------------- | ---------- | ------ | --------------------- |
| `role_id`       | `uuid`     | 必填   | FK → `roles.id`       |
| `permission_id` | `uuid`     | 必填   | FK → `permissions.id` |
| `created_at`    | `datetime` | 必填   | 綁定建立時間          |

約束：`UNIQUE(role_id, permission_id)`；不建立獨立 `id`。

## 登入帳號、公司成員與角色指派

本節依「員工清單」UI 的新增／修改流程完成責任與欄位確認。完整操作規格見 [員工清單 UI 定案](../ui/20-employee-list.md)。

### `users`

**資料表註釋：** 全域登入帳號與驗證資料；不得併入 `employees`。

**設計理由：** 登入身分與員工任職生命週期不同；同一帳號可加入多家公司，員工離職亦不得抹除帳號及歷史操作。

| 欄位名稱               | 資料型態   | 必填性 | 欄位註釋                         |
| ---------------------- | ---------- | ------ | -------------------------------- |
| `id`                   | `uuid`     | 必填   | PK                               |
| `username`             | `string`   | 必填   | 登入帳號，全域唯一               |
| `password_hash`        | `string`   | 必填   | 單向密碼雜湊；不得保存或回傳明碼 |
| `must_change_password` | `boolean`  | 必填   | 首次登入是否強制修改密碼         |
| `password_changed_at`  | `datetime` | 選填   | 最近一次完成密碼變更時間         |
| `created_at`           | `datetime` | 必填   | 建立時間                         |
| `updated_at`           | `datetime` | 必填   | 修改時間                         |

新增員工時由建立者設定初始密碼，`must_change_password=true`。管理者可直接替員工重設密碼，不發送 Email、簡訊或系統通知；重設行為要留下稽核紀錄，但不得記錄密碼或密碼 Hash。

### `company_users`

**資料表註釋：** 登入帳號加入公司的成員關係，必要時連結該公司員工。

**設計理由：** 將 Tenant 成員關係與全域帳號分離，可支援同一帳號加入多家公司及非員工協作者。

| 欄位名稱         | 資料型態   | 必填性   | 欄位註釋                                          |
| ---------------- | ---------- | -------- | ------------------------------------------------- |
| `id`             | `uuid`     | 必填     | PK                                                |
| `company_id`     | `uuid`     | 必填     | FK → `companies.id`                               |
| `user_id`        | `uuid`     | 必填     | FK → `users.id`                                   |
| `employee_id`    | `uuid`     | 條件必填 | FK → `employees.id`；員工帳號必填，外部協作者可空 |
| `status`         | `string`   | 必填     | 公司內帳號狀態；不用 DB ENUM                      |
| `activated_at`   | `datetime` | 選填     | 啟用時間                                          |
| `deactivated_at` | `datetime` | 選填     | 停用時間                                          |
| `created_at`     | `datetime` | 必填     | 建立時間                                          |
| `updated_at`     | `datetime` | 必填     | 修改時間                                          |

約束：`UNIQUE(company_id, user_id)`；同公司一名員工只能連結一個有效公司帳號。辦理離職時停用 `company_users`，不刪除 `users`、角色或歷史紀錄。

### `company_user_roles`

**資料表註釋：** 公司成員與角色的指派及撤銷歷史。

**設計理由：** 公司成員可同時擁有多個角色；以撤銷時間結束指派而非刪除，可保留指派者、撤銷者與有效歷程。

| 欄位名稱          | 資料型態   | 必填性 | 欄位註釋                |
| ----------------- | ---------- | ------ | ----------------------- |
| `id`              | `uuid`     | 必填   | PK                      |
| `company_user_id` | `uuid`     | 必填   | FK → `company_users.id` |
| `role_id`         | `uuid`     | 必填   | FK → `roles.id`         |
| `assigned_at`     | `datetime` | 必填   | 指派時間                |
| `assigned_by`     | `uuid`     | 必填   | 指派者公司成員 ID       |
| `revoked_at`      | `datetime` | 選填   | 撤銷時間；NULL 表示有效 |
| `revoked_by`      | `uuid`     | 選填   | 撤銷者公司成員 ID       |
| `created_at`      | `datetime` | 必填   | 建立時間                |

約束：同一公司成員與角色同時只能有一筆有效指派。每個員工公司帳號至少保留一個有效角色；撤銷最後一個角色必須由服務層交易拒絕。

## 已確認的「我的資料／個資」UI

- 左選單新增「我的資料」，下設「個資」。
- 同一頁分為「個人資料」與「變更密碼」頁籤。
- 個人資料只能查看本人資料，不提供修改或儲存。
- 本人關係由目前登入帳號、目前公司成員及其連結的員工資料判定。
- 密碼變更屬於 `users`，不寫入 `employees`；新密碼只保存單向雜湊。
- 密碼欄位、複雜度與其他裝置登出規則仍待逐欄／逐項確認。
- 詳細規劃見 [11-ui-my-profile.md](../ui/11-ui-my-profile.md)。

### 員工清單 UI 補充

- 新增員工時必須同步建立 `users`、`company_users`，並至少建立一筆有效 `company_user_roles`。
- 員工離職時停用公司帳號，但保留角色關聯及操作歷史。
- 完整流程見 [員工清單 UI 定案](../ui/20-employee-list.md)。

## `departments`

**資料表註釋：** 公司部門樹；以 `parent_id` 支援無限層級。

**設計理由：** 部門使用 parent_id 建樹，可同時表達總部、處、部、課等不同深度；保留 company_id 並限制父子同公司，是為了防止跨 Tenant 串接組織。

| 欄位名稱      | 資料型態   | 必填性 | 欄位註釋                             |
| ------------- | ---------- | ------ | ------------------------------------ |
| `id`          | `uuid`     | 必填   | PK，部門唯一識別碼                   |
| `company_id`  | `uuid`     | 必填   | FK → `companies.id`                  |
| `parent_id`   | `uuid`     | 選填   | FK → `departments.id`；根部門為 NULL |
| `code`        | `string`   | 必填   | 公司內部門代碼                       |
| `name`        | `string`   | 必填   | 部門名稱                             |
| `description` | `string`   | 選填   | 部門說明                             |
| `status`      | `string`   | 必填   | 部門狀態，不用 ENUM                  |
| `created_at`  | `datetime` | 必填   | 建立時間                             |
| `updated_at`  | `datetime` | 必填   | 修改時間                             |
| `deleted_at`  | `datetime` | 選填   | Soft Delete 時間                     |

約束：父子部門必須屬於同一 `company_id`；不得跨 Tenant 建樹。

#### 定案：樹的四條規則 ＋ 六項待定的處置

**執行手段是複合外鍵 `(company_id, parent_id) → departments(company_id, id)`，不是單欄外鍵。** 單欄外鍵下，A 公司的部門可以掛在 B 公司底下而**資料庫完全接受**——查詢有回資料、沒有任何錯誤。

四條規則：

1. **不得成環。** 上層指到自己的子孫會讓任何遞迴查詢無限跑。寫入前檢查「新的上層是不是自己的子孫」，是則拒絕。
2. **不得跨公司**（上述複合外鍵）。
3. **有子部門或有有效成員時不得刪除。** 成員數要查 `employee_department_histories`（字典明說不存在部門表上）。
4. **搬移子樹不改寫任何員工的部門歷史。** 歷史記的是「那一天他在哪個部門」，部門自己搬家不改變那件事。

原標「後續需再確認」的六項，處置如下：

| 項目                     | 定案                                           | 為什麼                                                                                 |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| 有子部門或有成員時刪除   | **禁止刪除**，先移轉                           | 移轉是業務決定，不該藏在刪除動作裡。強制先移轉，那個決定就會被看見                     |
| 停用後既有員工與未來指派 | 停用**只影響「能不能被選為新部門」**，不動歷史 | 歷史是事實。停用一個部門不改變「他去年在那裡」                                         |
| **部門主管**             | **不做**                                       | 見下                                                                                   |
| 主管任期與歷史           | 不做                                           | 同上                                                                                   |
| 部門排序欄位             | **不做**，樹狀按名稱排                         | 排序欄位要維護，而部門樹通常不大                                                       |
| 拖拉調整階層             | **不做**，用「修改上層部門」達成               | 搬移子樹是有後果的操作（見規則 4），應該要有明確的確認步驟，不該是一個手滑就完成的手勢 |

**部門主管為什麼特別定為不做**：這套系統的權限模型是**扁平的**——角色 ＋ 權限碼，不看部門。一旦有了「部門主管」欄位，下一步一定有人拿它做權限判斷（「主管可以看自己部門的出勤」），而那會繞過整套權限碼機制，長出**第二套授權邏輯**，且不受任何權限碼檢查約束。

**連帶：簽核的範圍也一律靠權限碼判定**（「有沒有審核權限」），不引入部門主管。三份簽核 UI 定案寫的都是「具權限角色審核」，本定案與它們一致。日後若要限制簽核範圍（例如只審自己部門），正確的作法是**在權限碼上加範圍**——前端規範 §4.1 已經預留了 `scope(resource)` 這支原語——而不是加部門主管欄位。

### 已確認的組織架構 UI

- 「人事作業」下設「組織架構」。
- 左側以部門樹呈現階層；右側查看及修改所選部門。
- 支援新增根部門與在所選部門下新增子部門。
- 新增欄位為部門名稱、部門代碼、上層部門及部門說明。
- 修改欄位為部門名稱、部門代碼、上層部門、狀態及部門說明。
- 成員人數由員工目前有效的部門歷史紀錄計算，不存入 `departments`。
- 部門主管、部門排序及拖拉調整尚未定案。
- 詳細流程見 [08-ui-organization-structure.md](../ui/08-ui-organization-structure.md)。
