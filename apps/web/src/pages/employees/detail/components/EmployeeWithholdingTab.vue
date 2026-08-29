<script setup lang="ts">
/**
 * §3.4 眷屬、扣繳與勞退自願提繳率（本頁私有子元件，§1.5，計畫 05 Stage 7）。
 *
 * **這個分頁原本只有扣繳**（Stage 6 第二段）：本輪把眷屬（`DependentsSection.vue`）與勞退
 * 自願提繳率（`LaborPensionSection.vue`）接進來，扣繳原本的內容抽成 `WithholdingSection.vue`
 * ——三段各自擁有完整的清單載入與新增流程（各自打自己的 API），這裡只做編排，形狀比照
 * `EmployeeOrganizationTab.vue` 組 `DepartmentHistorySection`／`JobTitleHistorySection`／
 * `JobPositionHistorySection` 三支的方式。
 *
 * **眷屬與勞退都是「員工明細頁補登」，不接新增員工的單一交易**：UI 定案 §2.3 把眷屬與勞退
 * 畫在新增表單裡，但計畫 §3.3／§4.1／§8 Stage 7 把兩者歸類為「可建立後補登」，新增員工的
 * 原子性交易只涵蓋員工／任職／帳號／角色四項——UI 定案在這裡與後端實作的範圍不一致，
 * `employees/onboarding` 那一頁本輪不動，見交付報告。
 */
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import DependentsSection from './DependentsSection.vue'
import LaborPensionSection from './LaborPensionSection.vue'
import WithholdingSection from './WithholdingSection.vue'

defineProps<{ employeeId: string; can: (code: PermissionCode) => boolean }>()
</script>

<template>
  <section class="space-y-6">
    <DependentsSection :employee-id="employeeId" :can="can" />
    <WithholdingSection :employee-id="employeeId" :can="can" />
    <LaborPensionSection :employee-id="employeeId" :can="can" />
  </section>
</template>
