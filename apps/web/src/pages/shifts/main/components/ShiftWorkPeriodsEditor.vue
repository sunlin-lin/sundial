<script setup lang="ts">
/**
 * 工作時段編輯器（本頁私有子元件，§1.5）。一段或多段（中空班的空檔合法，見計畫 §5.2）。
 *
 * **沒有 `sequenceNo` 輸入框**：使用者不需要知道「順序編號」這個概念，`.payload.ts` 的
 * `toProfileFields` 依陣列順序自動編號。**也沒有「工作分鐘」輸入框**：那是推導值，前端不收
 * （必做事項 1）；本元件只負責收「起訖時刻 + 結束日偏移」，總計的預覽由上層的 `ShiftFormDialog`
 * 呼叫 `previewRequiredWorkMinutes` 一次算給整張表單看，不在每一列重複顯示。
 *
 * `v-for` 的 `:key="index"` 是刻意的：陣列列沒有天生的識別碼，且互動只有「新增」「刪除」兩種
 * （沒有拖曳重排），用索引足夠讓 Vue 正確 diff——真的需要穩定 key 時（例如支援拖曳排序）才要
 * 換成每列自帶一個本地產生的 uuid，那是目前用不到的複雜度。
 *
 * **日偏移用 `ElRadioGroup`／`ElRadio`，不是 `ElSelect`／`ElOption`**：後者在本專案的
 * `exactOptionalPropertyTypes: true`（通用規範 §2.1）底下會讓 `vue-tsc` 對 `ElOption` 的
 * `value`／`label` 直接報型別錯誤（本專案目前的 Element Plus 版本對這個 tsconfig 選項有已知的
 * 型別宣告不相容，`ElRadio` 不受影響——`regulatory-sync.page.vue` 的資料集選擇器已經證明它可用）。
 * 只有兩個選項時 `ElRadioGroup` 的呈現效果與下拉選單相去不遠，不算妥協。
 */
import { ElButton, ElRadio, ElRadioGroup, ElTimePicker } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { newWorkPeriod, type LocalWorkPeriod } from '../shifts-main.periods.view.ts'
import type { RowFieldErrors } from '../shifts-main.errors.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{
  modelValue: LocalWorkPeriod[]
  errors: RowFieldErrors
  disabled: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: LocalWorkPeriod[]] }>()

const onAdd = (): void => {
  emit('update:modelValue', [...props.modelValue, newWorkPeriod()])
}

const onRemove = (index: number): void => {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, itemIndex) => itemIndex !== index),
  )
}

/** §1.4 禁止模板出現複雜運算式（`?.`／`join(` 鏈），因此把「這一列的錯誤文字」收成單一函式呼叫。 */
const rowErrorMessage = (index: number): string => props.errors.get(index)?.join('；') ?? ''
</script>

<template>
  <div>
    <h3 class="text-sm font-medium text-ink">{{ $t('shifts-main.periods.heading') }}</h3>
    <p v-if="modelValue.length === 0" class="mt-1 text-sm text-danger">
      {{ $t('shifts-main.periods.empty') }}
    </p>

    <div v-for="(period, index) in modelValue" :key="index" class="mt-2 flex items-start gap-3">
      <ElTimePicker
        v-model="period.startTime"
        value-format="HH:mm"
        format="HH:mm"
        :placeholder="$t('shifts-main.periods.start-time')"
        :disabled="disabled"
      />
      <ElTimePicker
        v-model="period.endTime"
        value-format="HH:mm"
        format="HH:mm"
        :placeholder="$t('shifts-main.periods.end-time')"
        :disabled="disabled"
      />
      <ElRadioGroup v-model="period.endDayOffset" :disabled="disabled">
        <ElRadio :value="0" :border="true">{{ $t('shifts-main.periods.same-day') }}</ElRadio>
        <ElRadio :value="1" :border="true">{{ $t('shifts-main.periods.next-day') }}</ElRadio>
      </ElRadioGroup>
      <ElButton link type="danger" :disabled="disabled" @click="onRemove(index)">
        {{ $t('shifts-main.periods.remove') }}
      </ElButton>

      <p v-if="rowErrorMessage(index) !== ''" class="basis-full text-sm text-danger">
        {{ rowErrorMessage(index) }}
      </p>
    </div>

    <ElButton class="mt-2" :disabled="disabled" @click="onAdd">
      {{ $t('shifts-main.periods.add') }}
    </ElButton>
  </div>
</template>
