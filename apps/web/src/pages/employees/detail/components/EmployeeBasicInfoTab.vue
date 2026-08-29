<script setup lang="ts">
/**
 * §3.1 基本資料（本頁私有子元件，§1.5）。
 *
 * **自己擁有整個編輯／送出流程**：呼叫 `employees.main.update`，成功後把後端回傳的最新明細
 * `emit` 回 `.page.vue`（頁首要顯示最新的員工編號／姓名），理由與 `ShiftFormDialog.vue`
 * 「自己打 API、自己處理 loading／錯誤」同構。
 *
 * **`identityNumber`／`birthday`／`phone`／`email`／`address` 每次都要求重新完整輸入**：
 * `employees.main.get` 只回遮罩字串，`employees.main.update` 卻要完整值——兩支端點在這五欄上
 * 不對稱，前端沒有辦法「預先帶出目前值讓使用者只改一格」。畫面上方另外顯示一次遮罩值供對照，
 * 讓使用者至少看得到「目前生效的是哪一組值的遮罩版本」。細節見 `.payload.ts` 的
 * `toBasicInfoFormState` 檔頭；此為後端目前的端點形狀限制，已在交付報告回報。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElRadio,
  ElRadioGroup,
} from 'element-plus'
import { employeesMainUpdate } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canEditBasicInfo, canSubmitBasicInfoForm } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import { toBasicInfoFormState, toBasicInfoUpdatePayload } from '../employees-detail.payload.ts'
import { emailMaskedDisplay, type EmployeeSummary } from '../employees-detail.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ employee: EmployeeSummary; can: (code: PermissionCode) => boolean }>()
const emit = defineEmits<{ updated: [employee: EmployeeSummary] }>()

type BasicFieldKey = 'employeeCode' | 'identityNumber'
const KNOWN_FIELD_KEYS: readonly BasicFieldKey[] = ['employeeCode', 'identityNumber']
const ELEMENT_ID: Record<BasicFieldKey, string> = {
  employeeCode: 'employee-detail-basic-field-employee-code',
  identityNumber: 'employee-detail-basic-field-identity-number',
}

const form = reactive(toBasicInfoFormState(props.employee))
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<BasicFieldKey>>(emptyFormErrors())

// 員工切換（理論上不會在同一個掛載週期內發生，但 prop 一變就重新以最新明細填表單，避免殘留上一位員工的輸入）。
watch(
  () => props.employee,
  (next) => {
    Object.assign(form, toBasicInfoFormState(next))
    formErrors.value = emptyFormErrors()
  },
)

const canEdit = computed(() => canEditBasicInfo(props.can))
const canSubmit = computed(() => canSubmitBasicInfoForm({ isSubmitting: isSubmitting.value, form }))

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  employeesMainUpdate(toBasicInfoUpdatePayload(props.employee.id, form))
    .then((updated) => {
      ElMessage.success($t('employees-detail.basic.toast.updated'))
      Object.assign(form, toBasicInfoFormState(updated))
      emit('updated', updated)
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
  <section>
    <h2 class="text-base font-semibold text-ink">{{ $t('employees-detail.basic.current-title') }}</h2>
    <div class="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
      <p>
        <span class="text-ink-muted">{{ $t('employees-onboarding.field.identity-number') }}：</span
        >{{ employee.identityNumberMasked }}
      </p>
      <p>
        <span class="text-ink-muted">{{ $t('employees-onboarding.field.birthday') }}：</span
        >{{ employee.birthdayMasked }}
      </p>
      <p>
        <span class="text-ink-muted">{{ $t('employees-onboarding.field.phone') }}：</span>{{ employee.phoneMasked }}
      </p>
      <p>
        <span class="text-ink-muted">{{ $t('employees-onboarding.field.email') }}：</span
        >{{ emailMaskedDisplay(employee) }}
      </p>
      <p class="col-span-2">
        <span class="text-ink-muted">{{ $t('employees-onboarding.field.address') }}：</span>{{ employee.addressMasked }}
      </p>
    </div>

    <h2 class="mt-6 text-base font-semibold text-ink">{{ $t('employees-detail.basic.form-title') }}</h2>
    <p class="mt-1 text-xs text-ink-muted">{{ $t('employees-detail.basic.sensitive-hint') }}</p>

    <ElForm class="mt-3" label-position="top" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-3"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />

      <div class="grid grid-cols-2 gap-x-6">
        <ElFormItem
          v-bind="formItemErrorProp(formErrors, 'employeeCode')"
          :id="ELEMENT_ID.employeeCode"
          :label="$t('employees-onboarding.field.employee-code')"
        >
          <ElInput v-model="form.employeeCode" :disabled="!canEdit || isSubmitting" />
        </ElFormItem>
        <ElFormItem :label="$t('employees-onboarding.field.name')">
          <ElInput v-model="form.name" :disabled="!canEdit || isSubmitting" />
        </ElFormItem>
        <ElFormItem :label="$t('employees-onboarding.field.gender')">
          <ElRadioGroup v-model="form.gender" :disabled="!canEdit || isSubmitting">
            <ElRadio value="MALE" :border="true">{{ $t('employees.gender.male') }}</ElRadio>
            <ElRadio value="FEMALE" :border="true">{{ $t('employees.gender.female') }}</ElRadio>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem
          v-bind="formItemErrorProp(formErrors, 'identityNumber')"
          :id="ELEMENT_ID.identityNumber"
          :label="$t('employees-onboarding.field.identity-number')"
        >
          <ElInput v-model="form.identityNumber" :disabled="!canEdit || isSubmitting" />
        </ElFormItem>
        <ElFormItem :label="$t('employees-onboarding.field.birthday')">
          <ElDatePicker
            v-model="form.birthday"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled="!canEdit || isSubmitting"
            class="w-full"
          />
        </ElFormItem>
        <ElFormItem :label="$t('employees-onboarding.field.phone')">
          <ElInput v-model="form.phone" :disabled="!canEdit || isSubmitting" />
        </ElFormItem>
        <ElFormItem :label="$t('employees-onboarding.field.email')">
          <ElInput v-model="form.email" :disabled="!canEdit || isSubmitting" />
        </ElFormItem>
        <ElFormItem :label="$t('employees-onboarding.field.address')">
          <ElInput v-model="form.address" :disabled="!canEdit || isSubmitting" />
        </ElFormItem>
      </div>

      <div class="mt-4 flex justify-end">
        <ElButton type="primary" :loading="isSubmitting" :disabled="!canEdit || !canSubmit" @click="onSubmit">
          {{ $t('employees-detail.basic.action.save') }}
        </ElButton>
      </div>
    </ElForm>
  </section>
</template>
