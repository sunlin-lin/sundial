<script setup lang="ts">
/**
 * 新增員工表單：§2.2 任職與組織（本頁私有子元件，§1.5）。
 *
 * **部門／職稱／職務一律用 `ElTreeSelect`，不是 `ElSelect`／`ElOption`**：後者在本專案的
 * `exactOptionalPropertyTypes` 底下會讓 `vue-tsc` 對 `ElOption` 的 `value`／`label` 直接報型別錯誤
 * （與 `shifts-main` 的 `ElRadioGroup` 替代方案是同一個限制，理由見那裡的檔頭；這裡的欄位是
 * 部門樹與可能上百筆的職稱／職務清單，`ElRadioGroup` 撐不起這種量級，改用同樣不經過 `ElOption`
 * 的 `ElTreeSelect`——部門本來就是樹狀資料，職稱／職務攤成沒有 `children` 的單層樹一樣可用，
 * 已由本次開發的型別探測驗證過：純綁 `data`／`node-key`／`props` 不會撞上那個已知的型別問題）。
 */
import { ElDatePicker, ElFormItem, ElInputNumber, ElRadio, ElRadioGroup, ElTreeSelect } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { EmploymentTypeFormValue } from '../employees-onboarding.payload.ts'
import { FIELD_ELEMENT_ID, formItemErrorProp, type OnboardingFormErrors } from '../employees-onboarding.errors.view.ts'
import {
  EMPLOYMENT_TYPE_CODES,
  employmentTypeLabel,
  type DepartmentTreeNode,
  type JobDictionaryItem,
} from '../employees-onboarding.view.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{
  departmentTree: DepartmentTreeNode[]
  jobTitleOptions: JobDictionaryItem[]
  jobPositionOptions: JobDictionaryItem[]
  errors: OnboardingFormErrors
  disabled: boolean
}>()

// 用 `0` 表示還沒選（值域是 1–8），理由見 `.payload.ts` 的 `EmploymentTypeFormValue`。
const employmentTypeCode = defineModel<EmploymentTypeFormValue>('employmentTypeCode', { required: true })
const employmentNatureCode = defineModel<number | null>('employmentNatureCode', { required: true })
const hireDate = defineModel<string>('hireDate', { required: true })
const departmentId = defineModel<string | null>('departmentId', { required: true })
const jobTitleId = defineModel<string | null>('jobTitleId', { required: true })
const jobPositionIds = defineModel<string[]>('jobPositionIds', { required: true })
</script>

<template>
  <section class="mt-6">
    <h2 class="text-base font-semibold text-ink">{{ $t('employees-onboarding.section.employment') }}</h2>
    <div class="mt-3 grid grid-cols-2 gap-x-6">
      <ElFormItem :label="$t('employees-onboarding.field.employment-type')" class="col-span-2">
        <ElRadioGroup v-model="employmentTypeCode" :disabled="disabled">
          <ElRadio v-for="code in EMPLOYMENT_TYPE_CODES" :key="code" :value="code" :border="true">
            {{ employmentTypeLabel(code, $t) }}
          </ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.employment-nature')">
        <ElInputNumber v-model="employmentNatureCode" :min="1" :controls="false" :disabled="disabled" class="w-full" />
        <p class="mt-1 text-xs text-ink-muted">{{ $t('employees-onboarding.field.employment-nature-hint') }}</p>
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.hire-date')">
        <ElDatePicker v-model="hireDate" type="date" value-format="YYYY-MM-DD" :disabled="disabled" class="w-full" />
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(errors, 'departmentId')"
        :id="FIELD_ELEMENT_ID.departmentId"
        :label="$t('employees-onboarding.field.department')"
      >
        <ElTreeSelect
          v-model="departmentId"
          :data="departmentTree"
          node-key="id"
          :props="{ label: 'name', children: 'children' }"
          :disabled="disabled"
          filterable
          class="w-full"
        />
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(errors, 'jobTitleId')"
        :id="FIELD_ELEMENT_ID.jobTitleId"
        :label="$t('employees-onboarding.field.job-title')"
      >
        <ElTreeSelect
          v-model="jobTitleId"
          :data="jobTitleOptions"
          node-key="id"
          :props="{ label: 'name' }"
          :disabled="disabled"
          clearable
          filterable
          class="w-full"
        />
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(errors, 'jobPositionIds')"
        :id="FIELD_ELEMENT_ID.jobPositionIds"
        :label="$t('employees-onboarding.field.job-positions')"
        class="col-span-2"
      >
        <ElTreeSelect
          v-model="jobPositionIds"
          :data="jobPositionOptions"
          multiple
          show-checkbox
          node-key="id"
          :props="{ label: 'name' }"
          :disabled="disabled"
          filterable
          class="w-full"
        />
      </ElFormItem>
    </div>
  </section>
</template>
