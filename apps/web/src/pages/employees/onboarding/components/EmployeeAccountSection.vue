<script setup lang="ts">
/**
 * 新增員工表單：§2.4 登入帳號與角色（本頁私有子元件，§1.5）。
 *
 * **初始密碼只活在這個欄位與送出當下的記憶體裡**：本元件不對它做任何 `console` 輸出，
 * `.page.vue` 的送出流程與錯誤處理也一樣（送出失敗時顯示的是後端 `errors[].msg`，
 * 後端不會把密碼寫進任何錯誤訊息或稽核內容，見 `employees-onboarding.errors.ts` 的錯誤字典）。
 * `show-password` 讓使用者能自行核對輸入正確，這是使用者主動的畫面內操作，不是外洩。
 *
 * **角色一律用 `ElTreeSelect` 而不是 `ElSelect`／`ElOption`**，理由同
 * `EmployeeEmploymentSection.vue` 檔頭。
 */
import { ElFormItem, ElInput, ElTreeSelect } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { FIELD_ELEMENT_ID, formItemErrorProp, type OnboardingFormErrors } from '../employees-onboarding.errors.view.ts'
import type { RoleDictionaryItem } from '../employees-onboarding.view.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ roleOptions: RoleDictionaryItem[]; errors: OnboardingFormErrors; disabled: boolean }>()

const username = defineModel<string>('username', { required: true })
const initialPassword = defineModel<string>('initialPassword', { required: true })
const roleIds = defineModel<string[]>('roleIds', { required: true })
</script>

<template>
  <section class="mt-6">
    <h2 class="text-base font-semibold text-ink">{{ $t('employees-onboarding.section.account') }}</h2>
    <div class="mt-3 grid grid-cols-2 gap-x-6">
      <ElFormItem
        v-bind="formItemErrorProp(errors, 'username')"
        :id="FIELD_ELEMENT_ID.username"
        :label="$t('employees-onboarding.field.username')"
      >
        <ElInput v-model="username" :disabled="disabled" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-onboarding.field.initial-password')">
        <ElInput v-model="initialPassword" type="password" show-password :disabled="disabled" />
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(errors, 'roleIds')"
        :id="FIELD_ELEMENT_ID.roleIds"
        :label="$t('employees-onboarding.field.roles')"
        class="col-span-2"
      >
        <ElTreeSelect
          v-model="roleIds"
          :data="roleOptions"
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
    <p class="mt-1 text-xs text-ink-muted">{{ $t('employees-onboarding.field.roles-hint') }}</p>
  </section>
</template>
