# HR SaaS 功能與 Schema 總索引

> 來源：ChatGPT 原始對話〈整理人資系統需求〉，依對話時間順序讀取並採用每輪最後確認版本。中途被使用者否決的方案不列入正式 Schema。

> 恢復判準：只收錄使用者明確要求「記錄起來／定案／確認」後仍未被後續修正推翻的內容。較晚版本覆蓋較早提案；只能確認表存在而無法逐欄恢復者，一律標示「已確認存在／欄位待恢復」，不得拿示例或一般慣例補欄位。`06` 是一致性索引，欄位完整定義以 `01`–`05` 主題文件為準。

## 整體計畫

```text
多公司 SaaS Tenant
├─ 公司資料
├─ 系統管理
│  ├─ 角色／權限
│  ├─ 法規設定
│  └─ 稽核日誌
├─ 組織／人事
│  ├─ 部門樹
│  ├─ 員工主檔
│  ├─ 多次任職
│  ├─ 部門／職稱／職務歷史
│  └─ 扶養及扣繳設定
├─ 薪資制度
├─ 人事成本
├─ 班別／排班
├─ 出勤／打卡
├─ 加班／補休
├─ 請假／公司贈與假
├─ 薪資結算
└─ 離職／最終結算
```

## 核心資料流

公司是 Tenant；員工主檔代表人事資料；任職、部門、職稱、職務與薪資均保存有效期間。班別是規則，班表是應出勤事實，打卡是實際事件，請假與加班不改寫班表。假別與補休採額度批次、交易帳本及 allocation。Payroll 事後結算並鎖定薪資、法規及計價 Snapshot；後續變更不得重寫歷史。

## 文件

- [01-company-access-organization.md](01-company-access-organization.md)
- [02-employee-payroll-cost.md](02-employee-payroll-cost.md)
- [03-scheduling-attendance.md](03-scheduling-attendance.md)
- [04-overtime-leave.md](04-overtime-leave.md)
- [05-regulatory-system.md](05-regulatory-system.md)
- [06-schema-dictionary.md](06-schema-dictionary.md) — 統一表格化資料字典
- [07-ui-role-permission.md](../ui/07-ui-role-permission.md) — 系統設定／角色與權限 UI 設計、刪除規則及 Schema 缺口
- [08-ui-organization-structure.md](../ui/08-ui-organization-structure.md) — 人事作業／組織架構列表、新增與修改流程
- [09-ui-all-attendance.md](../ui/09-ui-all-attendance.md) — 人事作業／全體出勤按月查詢與位置顯示
- [10-ui-dashboard-attendance.md](../ui/10-ui-dashboard-attendance.md) — 預設總覽、上下班打卡與撤銷規則
- [11-ui-my-profile.md](../ui/11-ui-my-profile.md) — 我的資料／唯讀個資與變更密碼
- [12-ui-my-attendance.md](../ui/12-ui-my-attendance.md) — 我的資料／本人按月出勤統計與列表
- [13-ui-attendance-correction.md](../ui/13-ui-attendance-correction.md) — 我的資料／補打卡申請、撤回與審核
- [14-ui-my-leave.md](../ui/14-ui-my-leave.md) — 我的資料／逐筆假期餘額與請假申請
- [15-ui-my-overtime.md](../ui/15-ui-my-overtime.md) — 我的資料／加班申請、完整打卡前提與撤回
- [16-ui-my-payroll.md](../ui/16-ui-my-payroll.md) — 我的資料／已結算薪資單、顯示與出勤快照
- [17-ui-attendance-correction-approval.md](../ui/17-ui-attendance-correction-approval.md) — 簽核／補打卡簽核、撤銷審核與分頁
- [18-ui-overtime-approval.md](../ui/18-ui-overtime-approval.md) — 簽核／加班簽核、整筆核准與撤銷結果
- [19-ui-leave-approval.md](../ui/19-ui-leave-approval.md) — 簽核／請假簽核、整筆核准與額度返還
- [20-employee-list.md](../ui/20-employee-list.md) — 人事作業／員工清單、新增、修改及離職
- [21-ui-company-leave-grants.md](../ui/21-ui-company-leave-grants.md) — 人事作業／特休與補休贈與、發放列表及撤銷
- [22-ui-shift-settings.md](../ui/22-ui-shift-settings.md) — 人事作業／班別設定與完整排班模式範圍

## 全域規則

- 不使用 DB ENUM；固定代碼用 `integer` 或 `string`，意義寫入欄位註釋。
- 通用型態：`uuid`、`string/varchar`、`integer`、`decimal`、`boolean`、`date/time/datetime`、`text/json`、`binary/varbinary`。
- 加密內容使用 `binary/varbinary`；查詢 Hash 使用固定長度 binary。
- 原始事實、規則、額度交易、結算 Snapshot 分離。
- 歷史不可用 UPDATE 或 DELETE 抹除；撤銷、更正、返還均留紀錄。
- 所有 Tenant 資料必須可追溯至 Company。
