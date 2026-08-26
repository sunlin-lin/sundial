# UI 與 Schema 設計：我的資料／薪資單

## 確認狀態

本文件內容已由使用者明確確認，列為正式 UI、流程與 Schema 規劃。

## 導覽與可見條件

```text
我的資料
└─ 薪資單
```

- 只能查看目前登入員工本人。
- 薪資結算完成後才看得到；結算前不顯示。
- 直接依 `payrolls.status_code` 判斷，不另設發布狀態或發布時間。
- 不提供 PDF、下載或匯出。
- 不另設薪資單專用查看／下載紀錄；需要時沿用系統操作日誌。

## 查詢與列表

年度預設當年度，可依發放狀態查詢。列表按計薪期間由新到舊：

| 計薪月份 | 計薪期間 | 發薪日 | 應發金額 | 扣款金額 | 實發金額 | 發放狀態 | 操作 |
|---|---|---|---:|---:|---:|---|---|

操作只提供查看。

## 明細

- 基本資料：公司、員工編號、姓名、部門、職稱、計薪月份、期間及發薪日。
- 應發項目：`payroll_details.type_code = 1`。
- 扣款項目：`payroll_details.type_code = 2`。
- 總結：直接顯示 `payrolls.gross_amount`、`deduction_amount`、`net_amount`，不在查看時重算。
- 發放資料：由 `payroll_payments` 逐筆顯示；銀行帳戶只顯示末四碼。
- 分次付款時顯示每筆付款及已發放／待發放合計。

## 薪資單顯示快照

結算時保存下列欄位於 `payrolls`：

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `company_name_snapshot` | `string` | 必填 | 結算當時公司名稱 |
| `employee_code_snapshot` | `string` | 必填 | 結算當時員工編號 |
| `employee_name_snapshot` | `string` | 必填 | 結算當時員工姓名 |
| `department_name_snapshot` | `string` | 條件必填 | 結算當時部門；無部門時為空 |
| `job_title_name_snapshot` | `string` | 選填 | 結算當時職稱 |

結算後不可修改；歷史薪資單不得改讀目前最新人事資料。

## 薪資出勤計算快照

所有薪資單採用的出勤摘要都要在結算時記錄，不得在查看時即時讀取後來可能重算的出勤結果。採一張薪資單一筆 `payroll_attendance_snapshots`：

| 欄位 | 型態 | 必填性 | 註釋 |
|---|---|---|---|
| `id` | `uuid` | 必填 | PK |
| `payroll_id` | `uuid` | 必填 | FK → `payrolls.id`，一對一 |
| `attendance_days` | `decimal(6,2)` | 必填 | 結算採用的出勤天數，支援半日 |
| `worked_minutes` | `integer` | 必填 | 結算採用的實際工時分鐘 |
| `overtime_minutes` | `integer` | 必填 | 結算採用的核准加班分鐘 |
| `leave_minutes` | `integer` | 必填 | 結算採用的請假分鐘 |
| `late_days` | `integer` | 必填 | 結算採用的遲到天數 |
| `early_leave_days` | `integer` | 必填 | 結算採用的早退天數 |
| `absence_days` | `decimal(6,2)` | 必填 | 結算採用的缺勤天數，支援部分日 |
| `created_at` | `datetime` | 必填 | 快照建立時間 |

約束：`UNIQUE(payroll_id)`；所有數值不得為負；結算完成後不可修改。分鐘在畫面換算為小時，原始資料仍以分鐘保存。

## 隱私

後端依 `users`、目前公司 `company_users` 與員工連結限制本人資料，不接受任意其他員工 ID。銀行帳戶不得完整顯示。
