# 薪資試算與結算 Schema（已確認）

> 本文件記錄使用者已同意的薪資試算、結算、人事成本與當期臨時薪資項目方案。常駐薪資設定與當期臨時項目必須分離。

## 已確認規則

- 進入功能預設顯示當月；已有試算時直接顯示最新結果。
- 未生成時可生成；已生成但未結算時可重新生成與修改；結算後鎖定，必須撤銷結算才能重新生成或修改。
- 每次首次生成與重新生成均建立新版本。
- 每一次生成、重新生成、結算及撤銷均保留歷程。
- 每位員工可有不限數量的當期臨時加發或扣款項目。
- 臨時項目不修改、不回寫 `employee_salary_settings`，且不自動帶入下月。
- 臨時項目可套用全體、複選部門（可含下層部門）或指定人員。
- 支援固定金額、逐人輸入、基底乘倍數、基底乘比率及多項基底合計計算。
- 保存計算公式、各基底金額快照、系統計算結果、最終金額與覆寫原因。
- 薪資結果同時保存應發、代扣、實發、雇主負擔及公司總成本。

## 既有表調整

### `payroll_periods`

**用途：** 保存公司某薪資月份的計薪期間及目前生命週期狀態。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `company_id` | `uuid` | 必填 | 公司外鍵 |
| `period_code` | `string` | 必填 | 薪資月份代碼 |
| `start_date` | `date` | 必填 | 計薪開始日 |
| `end_date` | `date` | 必填 | 計薪結束日 |
| `pay_date` | `date` | 必填 | 預定發薪日 |
| `status_code` | `integer` | 必填 | 尚未生成、已生成、已結算或已撤銷 |
| `current_version_id` | `uuid` | 選填 | 最新試算版本外鍵 |
| `generated_by` | `uuid` | 選填 | 最近生成者 |
| `generated_at` | `datetime` | 選填 | 最近生成時間 |
| `settled_by` | `uuid` | 選填 | 目前有效結算者 |
| `settled_at` | `datetime` | 選填 | 目前有效結算時間 |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 修改時間 |

**約束：** 同一公司 `period_code` 唯一；結算後不得重新生成或修改，除非先撤銷結算。歷史操作不得只存在本表，必須寫入事件表。

### `payrolls`

**用途：** 保存某試算版本中每位員工的薪資及公司成本結果。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `payroll_period_id` | `uuid` | 必填 | 計薪期間外鍵 |
| `payroll_version_id` | `uuid` | 必填 | 試算版本外鍵 |
| `employee_id` | `uuid` | 必填 | 員工外鍵 |
| `employment_id` | `uuid` | 必填 | 任職外鍵 |
| `gross_amount` | `decimal` | 必填 | 應發 |
| `deduction_amount` | `decimal` | 必填 | 員工代扣 |
| `net_amount` | `decimal` | 必填 | 實發 |
| `employer_cost_amount` | `decimal` | 必填 | 雇主負擔 |
| `company_total_cost_amount` | `decimal` | 必填 | 公司總成本 |
| `calculation_status_code` | `integer` | 必填 | 正常、警告或異常 |
| `status_code` | `integer` | 必填 | 薪資結果狀態 |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 修改時間 |

**約束：** `UNIQUE(payroll_version_id, employee_id)`；公司總成本＝應發＋雇主負擔。

### `payroll_details`

**用途：** 保存常駐薪資、系統計算與不限數量的當期臨時薪資明細。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `payroll_id` | `uuid` | 必填 | 員工薪資結果外鍵 |
| `salary_item_id` | `uuid` | 選填 | 永久薪資項目外鍵；臨時項目可空 |
| `temporary_item_batch_id` | `uuid` | 選填 | 臨時項目批次外鍵 |
| `item_name` | `string` | 必填 | 當期名稱快照 |
| `type_code` | `integer` | 必填 | 應發或扣款 |
| `source_type_code` | `integer` | 必填 | 常駐設定、系統計算或臨時新增 |
| `calculated_amount` | `decimal` | 選填 | 公式原始結果 |
| `final_amount` | `decimal` | 必填 | 最終採用金額 |
| `is_overridden` | `boolean` | 必填 | 是否人工覆寫 |
| `override_reason` | `string` | 選填 | 覆寫時必填 |
| `status_code` | `integer` | 必填 | 有效或已撤銷 |
| `description` | `string` | 選填 | 說明 |
| `created_by` | `uuid` | 必填 | 建立者 |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 修改時間 |
| `cancelled_by` | `uuid` | 選填 | 撤銷者 |
| `cancelled_at` | `datetime` | 選填 | 撤銷時間 |
| `cancel_reason` | `string` | 選填 | 撤銷原因 |

## 新增資料表

### `payroll_calculation_versions`

**用途：** 保存每次生成或重新生成的不可覆蓋試算版本。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `payroll_period_id` | `uuid` | 必填 | 計薪期間外鍵 |
| `version_number` | `integer` | 必填 | 版本序號 |
| `status_code` | `integer` | 必填 | 生成中、完成、失敗或被取代 |
| `employee_count` | `integer` | 必填 | 員工人數 |
| `gross_amount` | `decimal` | 必填 | 應發合計 |
| `deduction_amount` | `decimal` | 必填 | 代扣合計 |
| `net_amount` | `decimal` | 必填 | 實發合計 |
| `employer_cost_amount` | `decimal` | 必填 | 雇主負擔合計 |
| `company_total_cost_amount` | `decimal` | 必填 | 公司總成本 |
| `generated_by` | `uuid` | 必填 | 生成者 |
| `generated_at` | `datetime` | 必填 | 生成時間 |
| `created_at` | `datetime` | 必填 | 建立時間 |

**約束：** `UNIQUE(payroll_period_id, version_number)`。

### `payroll_temporary_item_batches`

**用途：** 保存一次批次建立的當期臨時加發或扣款設定。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `payroll_period_id` | `uuid` | 必填 | 薪資月份外鍵 |
| `item_name` | `string` | 必填 | 臨時項目名稱 |
| `type_code` | `integer` | 必填 | 加發或扣款 |
| `calculation_type_code` | `integer` | 必填 | 固定、逐人、倍數或比率 |
| `multiplier` | `decimal` | 選填 | 計算倍數 |
| `rate` | `decimal` | 選填 | 計算比率 |
| `proration_type_code` | `integer` | 必填 | 比例計算方式 |
| `is_taxable` | `boolean` | 必填 | 是否列入所得 |
| `affects_related_calculations` | `boolean` | 必填 | 是否影響其他計算 |
| `is_personnel_cost` | `boolean` | 必填 | 是否列入公司成本 |
| `reason` | `string` | 必填 | 新增原因 |
| `description` | `string` | 選填 | 備註 |
| `status_code` | `integer` | 必填 | 有效或已撤銷 |
| `created_by` | `uuid` | 必填 | 建立者 |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `cancelled_by` | `uuid` | 選填 | 撤銷者 |
| `cancelled_at` | `datetime` | 選填 | 撤銷時間 |
| `cancel_reason` | `string` | 選填 | 撤銷原因 |

### `payroll_temporary_item_scopes`

**用途：** 保存批次原始選擇的全體、部門或人員範圍。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `batch_id` | `uuid` | 必填 | 臨時項目批次外鍵 |
| `scope_type_code` | `integer` | 必填 | 全體、部門或人員 |
| `department_id` | `uuid` | 選填 | 部門外鍵 |
| `employee_id` | `uuid` | 選填 | 員工外鍵 |
| `include_child_departments` | `boolean` | 必填 | 是否包含下層部門 |
| `created_at` | `datetime` | 必填 | 建立時間 |

### `payroll_temporary_item_bases`

**用途：** 保存一個臨時項目公式使用的每個常駐薪資基底。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `batch_id` | `uuid` | 必填 | 臨時項目批次外鍵 |
| `salary_item_id` | `uuid` | 必填 | 作為基底的薪資項目 |
| `operator_code` | `integer` | 必填 | 加入或減去 |
| `sequence` | `integer` | 必填 | 公式順序 |
| `created_at` | `datetime` | 必填 | 建立時間 |

### `payroll_temporary_item_calculations`

**用途：** 保存臨時項目套用到每位員工後的公式快照與最終結果。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `batch_id` | `uuid` | 必填 | 臨時項目批次外鍵 |
| `payroll_id` | `uuid` | 必填 | 員工薪資結果外鍵 |
| `base_amount` | `decimal` | 選填 | 基底合計快照 |
| `multiplier` | `decimal` | 選填 | 實際倍數 |
| `rate` | `decimal` | 選填 | 實際比率 |
| `proration_rate` | `decimal` | 必填 | 實際比例 |
| `calculated_amount` | `decimal` | 必填 | 系統計算結果 |
| `final_amount` | `decimal` | 必填 | 最終採用金額 |
| `is_excluded` | `boolean` | 必填 | 是否在預覽排除 |
| `override_reason` | `string` | 選填 | 覆寫理由 |
| `created_at` | `datetime` | 必填 | 建立時間 |
| `updated_at` | `datetime` | 必填 | 修改時間 |

### `payroll_operation_logs`

**用途：** 保存每次生成、重新生成、結算與撤銷結算事件。

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | 主鍵 |
| `payroll_period_id` | `uuid` | 必填 | 薪資月份外鍵 |
| `payroll_version_id` | `uuid` | 選填 | 試算版本外鍵 |
| `operation_type_code` | `integer` | 必填 | 生成、重新生成、結算或撤銷 |
| `before_status_code` | `integer` | 選填 | 操作前狀態 |
| `after_status_code` | `integer` | 必填 | 操作後狀態 |
| `reason` | `string` | 選填 | 撤銷時必填 |
| `operated_by` | `uuid` | 必填 | 操作者 |
| `operated_at` | `datetime` | 必填 | 操作時間 |

## 關聯摘要

```text
payroll_periods
├─ payroll_calculation_versions
│  └─ payrolls
│     ├─ payroll_details
│     └─ personnel_costs
├─ payroll_temporary_item_batches
│  ├─ payroll_temporary_item_scopes
│  ├─ payroll_temporary_item_bases
│  └─ payroll_temporary_item_calculations
└─ payroll_operation_logs
```

## 設計理由

- 版本獨立保存，才能追查每次重新生成與每次結算使用的結果。
- 臨時項目與常駐薪資分離，避免一次性獎金或扣款污染員工長期薪資設定。
- 批次、範圍、公式及逐人結果分表，才能同時還原「選了誰、怎麼算、各自算出多少」。
- 結算與撤銷使用事件表，避免只保留最後狀態而失去歷史。
- 雇主負擔與實發薪資分開保存，才能正確呈現完整公司人事成本。
