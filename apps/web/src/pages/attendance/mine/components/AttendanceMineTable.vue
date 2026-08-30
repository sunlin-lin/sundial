<script setup lang="ts">
/**
 * 我的出勤的列表表格（本頁私有子元件，§1.5）。
 *
 * **狀態欄用多個 `ElTag` 並排，不是單一文字**（UI 12「同一天可以同時顯示多個出勤狀態」），
 * 與 `attendance-all` 的 `AttendanceAllTable.vue` 是同一種寫法——但這裡刻意不共用那個元件：
 * 全體出勤多了員工／部門欄，我的出勤沒有，兩張表格的欄位形狀不同，硬抽共用元件只會多一組
 * 「要不要顯示員工欄」的 prop（§1.5 共用區長參數的既有理由）。
 *
 * 本表格不呼叫任何 API、沒有列操作——我的出勤是純查詢頁（UI 12 的明細查看本輪未實作，
 * 見任務回報：後端目前沒有對應的明細端點）。
 */
import { ElTable, ElTableColumn, ElTag } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { AttendanceMineDisplayRow } from '../attendance-mine.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ rows: readonly AttendanceMineDisplayRow[] }>()
</script>

<template>
  <ElTable :data="[...rows]" row-key="id" class="w-full" :border="true">
    <ElTableColumn prop="workDateDisplay" :label="$t('attendance-mine.column.work-date')" width="120" />
    <ElTableColumn prop="clockInDisplay" :label="$t('attendance-mine.column.clock-in')" width="90" />
    <ElTableColumn prop="clockInLocationDisplay" :label="$t('attendance-mine.column.clock-in-location')" width="100" />
    <ElTableColumn prop="clockOutDisplay" :label="$t('attendance-mine.column.clock-out')" width="90" />
    <ElTableColumn
      prop="clockOutLocationDisplay"
      :label="$t('attendance-mine.column.clock-out-location')"
      width="100"
    />
    <ElTableColumn prop="workedHoursDisplay" :label="$t('attendance-mine.column.worked-hours')" width="110" />
    <ElTableColumn prop="lateDisplay" :label="$t('attendance-mine.column.late')" width="110" />
    <ElTableColumn prop="earlyLeaveDisplay" :label="$t('attendance-mine.column.early-leave')" width="110" />
    <ElTableColumn :label="$t('attendance-mine.column.status')" min-width="160">
      <template #default="scope">
        <ElTag v-for="badge in scope.row['statuses']" :key="badge.text" class="mr-1" :type="badge.tone" size="small">
          {{ badge.text }}
        </ElTag>
      </template>
    </ElTableColumn>
    <ElTableColumn prop="sourceLabel" :label="$t('attendance-mine.column.source')" width="110" />
  </ElTable>
</template>
