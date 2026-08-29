<script setup lang="ts">
/**
 * 「辦理離職」對話框（本頁私有子元件，§1.5）。
 *
 * **離職是獨立動作，不是 update**：呼叫 `employments.main.leave`，不是 `employments.main.update`
 * （後者根本不存在——任職沒有一般性的修改端點）。UI 定案 `docs/ui/20-employee-list.md` §3.2／
 * 計畫 §7 明文要求完成後同步停用登入帳號，**這裡把這件事在對話框內用 `ElAlert` 明講一次**，
 * 不是送出之後才讓使用者發現帳號不見了。
 *
 * `open` 沒有走 `defineModel`／`v-model`，而是「`employment !== null` 就是開啟」：
 * 觸發來源（`EmployeeEmploymentTab.vue`）本來就要決定「對哪一筆任職辦理離職」，
 * 讓那份資料本身兼職「有沒有開啟」的旗標，呼叫端就不必再多維護一個獨立的布林。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElDatePicker, ElDialog, ElForm, ElFormItem, ElInputNumber, ElMessage } from 'element-plus'
import { employmentsMainLeave } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { canSubmitEmploymentLeaveForm } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import { emptyEmploymentLeaveFormState, toEmploymentLeavePayload } from '../employees-detail.payload.ts'
import type { EmploymentItem } from '../employees-detail.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ employment: EmploymentItem | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

type FieldKey = 'lastWorkingDate'
const KNOWN_FIELD_KEYS: readonly FieldKey[] = ['lastWorkingDate']
const ELEMENT_ID: Record<FieldKey, string> = { lastWorkingDate: 'employment-leave-field-last-working-date' }

const form = reactive(emptyEmploymentLeaveFormState())
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<FieldKey>>(emptyFormErrors())

const isOpen = computed(() => props.employment !== null)

watch(
  () => props.employment,
  (next) => {
    if (next === null) return
    Object.assign(form, emptyEmploymentLeaveFormState())
    formErrors.value = emptyFormErrors()
  },
)

const canSubmit = computed(() => canSubmitEmploymentLeaveForm({ isSubmitting: isSubmitting.value, form }))

const onCancel = (): void => {
  if (isSubmitting.value) return
  emit('close')
}

const onSubmit = (): void => {
  if (!canSubmit.value || props.employment === null) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  employmentsMainLeave(toEmploymentLeavePayload(props.employment.id, form))
    .then(() => {
      ElMessage.success($t('employees-detail.employment.toast.left'))
      emit('saved')
      emit('close')
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
    :model-value="isOpen"
    :title="$t('employees-detail.employment.dialog.leave-title')"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="onCancel"
  >
    <ElAlert
      type="warning"
      show-icon
      :closable="false"
      :title="$t('employees-detail.employment.dialog.leave-notice')"
    />

    <ElForm class="mt-4" label-position="top" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-3"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />

      <ElFormItem :label="$t('employees-detail.employment.field.leave-date')">
        <ElDatePicker
          v-model="form.leaveDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isSubmitting"
          class="w-full"
        />
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'lastWorkingDate')"
        :id="ELEMENT_ID.lastWorkingDate"
        :label="$t('employees-detail.employment.field.last-working-date')"
      >
        <ElDatePicker
          v-model="form.lastWorkingDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isSubmitting"
          class="w-full"
        />
      </ElFormItem>
      <ElFormItem :label="$t('employees-detail.employment.field.leave-reason-code')">
        <ElInputNumber
          v-model="form.leaveReasonCode"
          :min="1"
          :controls="false"
          :disabled="isSubmitting"
          class="w-full"
        />
        <p class="mt-1 text-xs text-ink-muted">{{ $t('employees-detail.employment.field.leave-reason-hint') }}</p>
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
