<script setup lang="ts">
/**
 * §3.5 帳號與角色：帳號狀態與重設密碼（本頁私有子元件，§1.5）。
 *
 * **帳號啟用／停用沒有做成這裡的功能**：`company-users/main` 目前只有 `reset-password` 一支
 * 對外端點，啟用／停用只在離職流程內部發生（`company-users-main.deactivate.service.ts`），
 * 沒有給管理者的對外端點可以呼叫——已在交付報告回報這個缺口，這裡不硬湊一個看起來能動、
 * 實際上沒有後端可打的按鈕。畫面上顯示的「啟用中」不是查回來的欄位，而是由「這個分頁會被渲染」
 * 這件事本身推導出來的：`employees.main.get` 只在帳號啟用時才回非 `null` 的 `companyUserId`
 * （`employees-main.find.repository.ts` 的 `findActiveCompanyUserId`），因此只要
 * `.page.vue` 把 `companyUserId` 傳下來，帳號狀態必然是啟用中。
 *
 * **密碼只活在這個表單與送出當下**：送出成功後立刻清空欄位，本元件不對它做任何 `console`
 * 輸出，送出失敗時顯示的是後端 `errors[].msg`（後端不會把密碼寫進任何錯誤訊息或稽核內容，
 * 見 `company-users-main.routes.ts` 端點說明），理由與新增員工那一頁的
 * `EmployeeAccountSection.vue`（同一顆欄位）同構。
 */
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElForm, ElFormItem, ElInput, ElMessage, ElTag } from 'element-plus'
import { companyUsersMainResetPassword } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canResetPassword, canSubmitResetPasswordForm } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import { emptyResetPasswordFormState, toResetPasswordPayload } from '../employees-detail.payload.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ companyUserId: string; can: (code: PermissionCode) => boolean }>()

type FieldKey = 'newPassword'
const KNOWN_FIELD_KEYS: readonly FieldKey[] = ['newPassword']

const form = reactive(emptyResetPasswordFormState())
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<FieldKey>>(emptyFormErrors())

const canReset = computed(() => canResetPassword(props.can))
const canSubmit = computed(() => canSubmitResetPasswordForm({ isSubmitting: isSubmitting.value, form }))

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  companyUsersMainResetPassword(toResetPasswordPayload(props.companyUserId, form))
    .then(() => {
      ElMessage.success($t('employees-detail.account.toast.password-reset'))
      Object.assign(form, emptyResetPasswordFormState())
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessRuleError) {
        formErrors.value = toFormErrors(error.errors, KNOWN_FIELD_KEYS)
        return
      }
      formErrors.value = { fieldErrors: new Map(), generalMessages: [toGeneralFailureMessage(error, $t)] }
    })
    .finally(() => {
      isSubmitting.value = false
    })
}
</script>

<template>
  <section>
    <h3 class="text-sm font-semibold text-ink">{{ $t('employees-detail.account.section.status') }}</h3>
    <p class="mt-2">
      <ElTag type="success">{{ $t('employees-detail.account.status.active') }}</ElTag>
    </p>
    <ElAlert
      class="mt-2"
      type="info"
      show-icon
      :closable="false"
      :title="$t('employees-detail.account.status.no-toggle-hint')"
    />

    <h3 class="mt-6 text-sm font-semibold text-ink">{{ $t('employees-detail.account.section.reset-password') }}</h3>
    <ElForm v-if="canReset" class="mt-2" :inline="true" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-2 w-full"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'newPassword')"
        :label="$t('employees-detail.account.field.new-password')"
      >
        <ElInput v-model="form.newPassword" type="password" show-password :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem>
        <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
          {{ $t('employees-detail.account.action.reset-password') }}
        </ElButton>
      </ElFormItem>
    </ElForm>
    <p v-if="canReset" class="mt-1 text-xs text-ink-muted">
      {{ $t('employees-detail.account.field.new-password-hint') }}
    </p>
  </section>
</template>
