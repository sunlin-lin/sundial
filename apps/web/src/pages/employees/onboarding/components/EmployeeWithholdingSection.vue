<script setup lang="ts">
/**
 * 新增員工表單：§2.3 扣繳（本頁私有子元件，§1.5）。
 *
 * **只收薪資扣繳方式一個欄位。** UI 定案 §2.3 另外提到眷屬與勞退自願提繳率，但計畫 05 Stage 6
 * 明文把這兩類留到 Stage 7——`EmployeesOnboardingCreateInput` 本身也沒有這兩類欄位
 * （後端這一輪還沒做，見 `.payload.ts` 檔頭），不是本頁自己少做。
 */
import { ElFormItem, ElRadio, ElRadioGroup } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { WithholdingMethodFormValue } from '../employees-onboarding.payload.ts'
import { WITHHOLDING_METHOD_CODES, withholdingMethodLabel } from '../employees-onboarding.view.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ disabled: boolean }>()

// 用 `0` 表示還沒選（值域是 1–2），理由見 `.payload.ts` 的 `WithholdingMethodFormValue`。
const withholdingMethodCode = defineModel<WithholdingMethodFormValue>('withholdingMethodCode', { required: true })
</script>

<template>
  <section class="mt-6">
    <h2 class="text-base font-semibold text-ink">{{ $t('employees-onboarding.section.withholding') }}</h2>
    <div class="mt-3">
      <ElFormItem :label="$t('employees-onboarding.field.withholding-method')">
        <ElRadioGroup v-model="withholdingMethodCode" :disabled="disabled">
          <ElRadio v-for="code in WITHHOLDING_METHOD_CODES" :key="code" :value="code" :border="true">
            {{ withholdingMethodLabel(code, $t) }}
          </ElRadio>
        </ElRadioGroup>
      </ElFormItem>
    </div>
  </section>
</template>
