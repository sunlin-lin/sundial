<script setup lang="ts">
/**
 * 版本內容那一張表（計畫 03 §4.1 的第三層、§5.3 的資料驅動欄位）。本頁私有的子元件（§1.5）。
 *
 * **欄位由 `columns` 決定，不是九個 `v-if`**（計畫 §5.3）：模板裡只有一個 `v-for`，
 * 九個資料集共用它。第十個資料集加進來時這個檔案一行都不用改——要改的是
 * `.columns.view.ts` 裡的欄位定義，而那是資料。
 *
 * 每一格都是 `.record.view.ts` 已經算好的字串（金額走 `formatAmount`、費率走 `formatRate`，
 * 全程不經過 `number`），所以這裡一律走 `prop`、不開 slot。
 */
import { computed } from 'vue'
import { ElTable, ElTableColumn } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { RecordColumn, RecordDisplayRow } from '../regulatory-datasets.record.view.ts'

// 標註型別把 key 收窄回 `MessageKey`，並同時遮蔽掉套件的全域 `$t`（理由見語系檔的 `TranslateMessage`）。
const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{
  columns: readonly RecordColumn[]
  rows: readonly RecordDisplayRow[]
}>()

// 理由同其他兩張表：`data` 收可變陣列，而複製不寫在模板上（§1.4）。
const tableRows = computed(() => [...props.rows])

/**
 * 內容區的高度上限（px）。
 *
 * 需要一個上限的理由是資料量：扣繳稅額表一個版本有 840 筆，攤開來的頁面要捲動好幾十個螢幕，
 * 而捲下去之後表頭就不見了——使用者會分不出自己在看第幾個扶養人數的欄位。
 * 給 `ElTable` 一個 `max-height` 之後表頭會固定，捲動限制在表格內。
 *
 * 寫成具名常數而不是模板裡的字面值：§5.2 禁止魔術數字尺寸，而一個沒有名字的 `520`
 * 在下一個人眼中沒有任何資訊。
 */
const CONTENT_MAX_HEIGHT = 520
</script>

<template>
  <ElTable
    :data="tableRows"
    row-key="rowKey"
    class="w-full"
    :border="true"
    :max-height="CONTENT_MAX_HEIGHT"
  >
    <ElTableColumn
      v-for="column in columns"
      :key="column.key"
      :prop="column.key"
      :label="$t(column.labelKey)"
      :align="column.align"
      :min-width="column.minWidth"
    />
  </ElTable>
</template>
