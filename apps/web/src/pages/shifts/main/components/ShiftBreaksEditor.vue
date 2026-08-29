<script setup lang="ts">
/**
 * 休息時段編輯器（本頁私有子元件，§1.5）。可以沒有任何一段（一般班不一定要有休息）。
 *
 * 比 `ShiftWorkPeriodsEditor` 多一個 `startDayOffset`——計畫 04 §4.2 對資料字典的唯一增補：
 * 22:00–06:00 的夜班休息 02:00–03:00，沒有日偏移分不出這個 02:00 是班次開始前二十小時還是
 * 開始後四小時。`:key="index"` 的理由與時段編輯器相同（見該檔檔頭）。
 *
 * 日偏移同樣用 `ElRadioGroup`／`ElRadio` 而不是 `ElSelect`／`ElOption`——理由見
 * `ShiftWorkPeriodsEditor.vue` 檔頭（`ElOption` 與本專案的 `exactOptionalPropertyTypes` 不相容）。
 */
import { ElButton, ElRadio, ElRadioGroup, ElSwitch, ElTimePicker } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { newBreak, type LocalBreak } from '../shifts-main.breaks.view.ts'
import type { RowFieldErrors } from '../shifts-main.errors.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{
  modelValue: LocalBreak[]
  errors: RowFieldErrors
  disabled: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: LocalBreak[]] }>()

const onAdd = (): void => {
  emit('update:modelValue', [...props.modelValue, newBreak()])
}

const onRemove = (index: number): void => {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, itemIndex) => itemIndex !== index),
  )
}

/** §1.4 禁止模板出現複雜運算式，因此把「這一列的錯誤文字」收成單一函式呼叫。 */
const rowErrorMessage = (index: number): string => props.errors.get(index)?.join('；') ?? ''
</script>

<template>
  <div>
    <h3 class="text-sm font-medium text-ink">{{ $t('shifts-main.breaks.heading') }}</h3>
    <p v-if="modelValue.length === 0" class="mt-1 text-sm text-ink-muted">
      {{ $t('shifts-main.breaks.empty') }}
    </p>

    <div v-for="(entry, index) in modelValue" :key="index" class="mt-2 flex items-start gap-3">
      <ElRadioGroup v-model="entry.startDayOffset" :disabled="disabled">
        <ElRadio :value="0" :border="true">{{ $t('shifts-main.periods.same-day') }}</ElRadio>
        <ElRadio :value="1" :border="true">{{ $t('shifts-main.periods.next-day') }}</ElRadio>
      </ElRadioGroup>
      <ElTimePicker
        v-model="entry.startTime"
        value-format="HH:mm"
        format="HH:mm"
        :placeholder="$t('shifts-main.breaks.start-time')"
        :disabled="disabled"
      />
      <ElRadioGroup v-model="entry.endDayOffset" :disabled="disabled">
        <ElRadio :value="0" :border="true">{{ $t('shifts-main.periods.same-day') }}</ElRadio>
        <ElRadio :value="1" :border="true">{{ $t('shifts-main.periods.next-day') }}</ElRadio>
      </ElRadioGroup>
      <ElTimePicker
        v-model="entry.endTime"
        value-format="HH:mm"
        format="HH:mm"
        :placeholder="$t('shifts-main.breaks.end-time')"
        :disabled="disabled"
      />
      <ElSwitch v-model="entry.isPaid" :disabled="disabled" :aria-label="$t('shifts-main.breaks.is-paid')" />
      <span class="text-sm text-ink-muted">{{ $t('shifts-main.breaks.is-paid') }}</span>
      <ElButton link type="danger" :disabled="disabled" @click="onRemove(index)">
        {{ $t('shifts-main.breaks.remove') }}
      </ElButton>

      <p v-if="rowErrorMessage(index) !== ''" class="basis-full text-sm text-danger">
        {{ rowErrorMessage(index) }}
      </p>
    </div>

    <ElButton class="mt-2" :disabled="disabled" @click="onAdd">
      {{ $t('shifts-main.breaks.add') }}
    </ElButton>
  </div>
</template>
