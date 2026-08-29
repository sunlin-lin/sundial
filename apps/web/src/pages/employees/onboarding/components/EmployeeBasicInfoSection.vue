<script setup lang="ts">
/**
 * 新增員工表單：§2.1 基本資料（本頁私有子元件，§1.5——單一頁面內部拆分，不是共用元件）。
 *
 * 純呈現＋雙向綁定，不呼叫任何 API、不持有自己的驗證邏輯：欄位值透過多組 `defineModel`
 * 直接綁回 `.page.vue` 的表單狀態，「能不能送出」與「錯誤訊息」都由呼叫端算好傳進來
 * （§1.3：呈現決策與動作可用性不得留在 `.vue` 內，這裡只負責渲染）。
 */
import { ElDatePicker, ElFormItem, ElInput, ElRadio, ElRadioGroup } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { GenderFormValue } from '../employees-onboarding.payload.ts'
import { FIELD_ELEMENT_ID, formItemErrorProp, type OnboardingFormErrors } from '../employees-onboarding.errors.view.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ errors: OnboardingFormErrors; disabled: boolean }>()

const employeeCode = defineModel<string>('employeeCode', { required: true })
const name = defineModel<string>('name', { required: true })
// 用 `''` 表示還沒選，不是 `null`／`undefined`：`ElRadioGroup.modelValue` 的型別在本專案的
// `exactOptionalPropertyTypes` 底下不接受 `undefined`，理由見 `.payload.ts` 的 `GenderFormValue`。
const gender = defineModel<GenderFormValue>('gender', { required: true })
const identityNumber = defineModel<string>('identityNumber', { required: true })
const birthday = defineModel<string>('birthday', { required: true })
const phone = defineModel<string>('phone', { required: true })
const email = defineModel<string>('email', { required: true })
const address = defineModel<string>('address', { required: true })
</script>

<template>
  <section>
    <h2 class="text-base font-semibold text-ink">{{ $t('employees-onboarding.section.basic') }}</h2>
    <div class="mt-3 grid grid-cols-2 gap-x-6">
      <ElFormItem
        v-bind="formItemErrorProp(errors, 'employeeCode')"
        :id="FIELD_ELEMENT_ID.employeeCode"
        :label="$t('employees-onboarding.field.employee-code')"
      >
        <ElInput v-model="employeeCode" :disabled="disabled" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.name')">
        <ElInput v-model="name" :disabled="disabled" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.gender')">
        <ElRadioGroup v-model="gender" :disabled="disabled">
          <ElRadio value="MALE" :border="true">{{ $t('employees.gender.male') }}</ElRadio>
          <ElRadio value="FEMALE" :border="true">{{ $t('employees.gender.female') }}</ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(errors, 'identityNumber')"
        :id="FIELD_ELEMENT_ID.identityNumber"
        :label="$t('employees-onboarding.field.identity-number')"
      >
        <ElInput v-model="identityNumber" :disabled="disabled" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.birthday')">
        <ElDatePicker v-model="birthday" type="date" value-format="YYYY-MM-DD" :disabled="disabled" class="w-full" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.phone')">
        <ElInput v-model="phone" :disabled="disabled" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.email')">
        <ElInput v-model="email" :disabled="disabled" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.address')">
        <ElInput v-model="address" :disabled="disabled" />
      </ElFormItem>
    </div>
  </section>
</template>
