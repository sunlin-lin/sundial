<script setup lang="ts">
/**
 * 「新增任職」對話框（本頁私有子元件，§1.5）。用於員工離職後重新回任：
 * 目前有一段在職中的任職時，父層（`EmployeeEmploymentTab.vue`）已經把觸發按鈕停用，
 * 這裡不重複判斷一次業務前置狀態，只管表單本身。
 *
 * 自己擁有整個表單與送出流程，理由與 `shifts/main/components/ShiftFormDialog.vue` 同構。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInputNumber,
  ElMessage,
  ElRadio,
  ElRadioGroup,
} from 'element-plus'
import { employmentsMainCreate } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { canSubmitEmploymentCreateForm } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import { emptyEmploymentCreateFormState, toEmploymentCreatePayload } from '../employees-detail.payload.ts'
import { EMPLOYMENT_TYPE_CODES, employmentTypeLabel } from '../employees-detail.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ open: boolean; employeeId: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [] }>()

type FieldKey = 'hireDate'
const KNOWN_FIELD_KEYS: readonly FieldKey[] = ['hireDate']
const ELEMENT_ID: Record<FieldKey, string> = { hireDate: 'employment-create-field-hire-date' }

const form = reactive(emptyEmploymentCreateFormState())
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<FieldKey>>(emptyFormErrors())

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    Object.assign(form, emptyEmploymentCreateFormState())
    formErrors.value = emptyFormErrors()
  },
)

const canSubmit = computed(() => canSubmitEmploymentCreateForm({ isSubmitting: isSubmitting.value, form }))

const onCancel = (): void => {
  emit('update:open', false)
}

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  employmentsMainCreate(toEmploymentCreatePayload(props.employeeId, form))
    .then(() => {
      ElMessage.success($t('employees-detail.employment.toast.created'))
      emit('saved')
      emit('update:open', false)
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessRuleError) {
        const result = toFormErrors(error.errors, KNOWN_FIELD_KEYS)
        formErrors.value = result
        const targetId = firstErroredElementId(result, KNOWN_FIELD_KEYS, ELEMENT_ID)
        if (targetId !== undefined) {
          document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
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
  <ElDialog
    :model-value="open"
    :title="$t('employees-detail.employment.dialog.create-title')"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:open', $event)"
  >
    <ElForm label-position="top" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-3"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />

      <ElFormItem :label="$t('employees-onboarding.field.employment-type')">
        <ElRadioGroup v-model="form.employmentTypeCode" :disabled="isSubmitting">
          <ElRadio v-for="code in EMPLOYMENT_TYPE_CODES" :key="code" :value="code" :border="true">
            {{ employmentTypeLabel(code, $t) }}
          </ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.employment-nature')">
        <ElInputNumber
          v-model="form.employmentNatureCode"
          :min="1"
          :controls="false"
          :disabled="isSubmitting"
          class="w-full"
        />
        <p class="mt-1 text-xs text-ink-muted">{{ $t('employees-onboarding.field.employment-nature-hint') }}</p>
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'hireDate')"
        :id="ELEMENT_ID.hireDate"
        :label="$t('employees-onboarding.field.hire-date')"
      >
        <ElDatePicker
          v-model="form.hireDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isSubmitting"
          class="w-full"
        />
      </ElFormItem>
    </ElForm>

    <template #footer>
      <ElButton :disabled="isSubmitting" @click="onCancel">{{
        $t('employees-detail.employment.form.cancel')
      }}</ElButton>
      <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
        {{ $t('employees-detail.employment.form.submit') }}
      </ElButton>
    </template>
  </ElDialog>
</template>
