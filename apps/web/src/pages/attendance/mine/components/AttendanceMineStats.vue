<script setup lang="ts">
/**
 * 我的出勤：當月出勤統計卡片（本頁私有子元件，§1.5）。UI 12「當月出勤統計」：
 * 「出勤 22 天／總工時 170.1 小時／遲到 1 天／早退 1 天／缺勤 0 天」。
 *
 * 純呈現：每一格的文字都已經在 `attendance-mine.stats.view.ts` 算好，這裡只負責排版
 * （§1.4：模板只做屬性存取與單一迴圈）。
 */
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { AttendanceMineStatCard } from '../attendance-mine.stats.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ cards: readonly AttendanceMineStatCard[] }>()
</script>

<template>
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-5">
    <div v-for="card in cards" :key="card.labelKey" class="rounded-panel bg-surface p-4 shadow-panel">
      <p class="text-sm text-ink-muted">{{ $t(card.labelKey) }}</p>
      <p class="mt-1 text-lg font-semibold text-ink">{{ card.valueDisplay }}</p>
    </div>
  </div>
</template>
