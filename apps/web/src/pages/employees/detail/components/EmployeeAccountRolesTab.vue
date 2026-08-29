<script setup lang="ts">
/**
 * §3.5 帳號與角色（本頁私有子元件，§1.5）。**本輪沒有實作實際功能，只顯示說明訊息。**
 *
 * UI 定案要求這個分頁能管理登入帳號狀態、重設密碼、增加／移除角色，對應端點是
 * `company-users/main/reset-password` 與 `company-users/roles/list`／`create`／`revoke`。
 * 但這三支端點全部要求 `companyUserId`，而**目前的 API 表面完全沒有辦法由 `employeeId` 查出
 * 對應的 `companyUserId`**：
 *
 * - `employees.main.get` 的回應（`EmployeeSummarySchema`）沒有這個欄位。
 * - `company-users/main` 只有一支端點 `reset-password`，沒有 `get`／`list`。
 * - `company-users/roles/list` 的 `companyUserId` 是**選填**的查詢條件（拿掉就查全公司），
 *   不是「用員工反查帳號」的入口；就算不帶這個條件把全公司的角色指派都撈出來，回應裡的
 *   `assignedByName` 是「執行指派這個動作的人」，不是「被指派角色的這位員工」，一樣拼不回這位員工。
 *
 * 這條連結只存在後端內部（`company_users` 表有 `employee_id` 外鍵，`company-users/main/impl/
 * find-active-by-employee.repository.ts` 用得到，但那是離職流程內部呼叫，沒有對外的 HTTP 端點）。
 * 因此這個分頁目前**畫不出任何一顆能動的按鈕**——沒有 id 就沒有東西可以查詢或送出，
 * 硬做一個「猜」的方案（例如拿員工姓名去比對某個列表）在多人同名或帳號名稱與員工姓名不同時
 * 會查到別人的帳號，那是比「這個功能不能用」更糟的結果。已在交付報告回報，需要後端補上
 * 對應的查詢端點（或在 `employees.main.get`／`employments.main.get` 之類的回應中带出
 * `companyUserId`）才能接上。
 */
import { useI18n } from 'vue-i18n'
import { ElAlert } from 'element-plus'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'

const { t } = useI18n()
const $t: TranslateMessage = t
</script>

<template>
  <ElAlert
    type="warning"
    show-icon
    :closable="false"
    :title="$t('employees-detail.account.blocked-title')"
    :description="$t('employees-detail.account.blocked-message')"
  />
</template>
