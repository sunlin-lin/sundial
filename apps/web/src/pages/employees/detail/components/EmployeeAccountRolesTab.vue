<script setup lang="ts">
/**
 * §3.5 帳號與角色（本頁私有子元件，§1.5）。
 *
 * `companyUserId` 由 `.page.vue` 往下傳：`employees.main.get` 現在回這一欄（`null` 代表這位
 * 員工目前沒有有效的登入帳號——從未透過 onboarding 建立，或帳號已因離職而被停用；兩種情形對
 * 這個分頁而言是同一件事：沒有 id 就沒有東西可以查詢或送出，這是合理的畫面狀態，不是錯誤，
 * 因此用 `ElAlert type="info"` 而不是錯誤樣式呈現）。
 *
 * 兩個子區塊各自獨立打自己的 API、各自處理自己的 loading／錯誤——「帳號狀態與重設密碼」
 * （`AccountResetPasswordSection.vue`）與「角色指派」（`AccountRoleAssignmentSection.vue`），
 * 理由與 `EmployeeOrganizationTab.vue` 底下三個 History 子元件同構。
 *
 * **帳號啟用／停用沒有做成這裡的功能**：後端 `company-users/main` 目前只有 `reset-password`
 * 一支對外端點，啟用／停用只在離職流程內部發生，沒有給管理者的對外端點可以呼叫——已在交付
 * 報告回報這個缺口，細節見 `AccountResetPasswordSection.vue` 檔頭。
 */
import { useI18n } from 'vue-i18n'
import { ElAlert } from 'element-plus'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import AccountResetPasswordSection from './AccountResetPasswordSection.vue'
import AccountRoleAssignmentSection from './AccountRoleAssignmentSection.vue'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ companyUserId: string | null; can: (code: PermissionCode) => boolean }>()
</script>

<template>
  <section>
    <ElAlert
      v-if="companyUserId === null"
      type="info"
      show-icon
      :closable="false"
      :title="$t('employees-detail.account.no-active-account')"
    />
    <div v-else class="space-y-6">
      <AccountResetPasswordSection :company-user-id="companyUserId" :can="can" />
      <AccountRoleAssignmentSection :company-user-id="companyUserId" :can="can" />
    </div>
  </section>
</template>
