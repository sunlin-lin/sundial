<script setup lang="ts">
/**
 * 全體出勤的列表表格（本頁私有子元件，§1.5）。
 *
 * **狀態欄用多個 `ElTag` 並排，不是單一文字**（UI 09「同一天可同時呈現多項狀態」）：
 * `row.statuses` 是 `.view.ts` 算好的陣列，這裡單純 `v-for` 逐一渲染，不做任何判斷或取捨
 * （§1.4：模板只允許屬性存取與單一迴圈，換算與取捨都已經在 `toDisplayRows` 做完）。
 *
 * 本表格不呼叫任何 API、沒有列操作——全體出勤是純查詢頁（UI 09 沒有定義任何列層級的動作）。
 */
import { ElTable, ElTableColumn, ElTag } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { AttendanceAllDisplayRow } from '../attendance-all.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ rows: readonly AttendanceAllDisplayRow[] }>()
</script>

<template>
  <ElTable :data="[...rows]" row-key="id" class="w-full" :border="true">
    <ElTableColumn prop="employeeCode" :label="$t('attendance-all.column.employee-code')" width="110" />
    <ElTableColumn prop="employeeName" :label="$t('attendance-all.column.employee-name')" width="110" />
    <ElTableColumn prop="departmentName" :label="$t('attendance-all.column.department')" min-width="120" />
    <ElTableColumn prop="workDateDisplay" :label="$t('attendance-all.column.work-date')" width="110" />
    <ElTableColumn prop="clockInDisplay" :label="$t('attendance-all.column.clock-in')" width="80" />
    <ElTableColumn prop="clockInLocationDisplay" :label="$t('attendance-all.column.clock-in-location')" width="90" />
    <ElTableColumn prop="clockOutDisplay" :label="$t('attendance-all.column.clock-out')" width="80" />
    <ElTableColumn prop="clockOutLocationDisplay" :label="$t('attendance-all.column.clock-out-location')" width="90" />
    <ElTableColumn prop="workedHoursDisplay" :label="$t('attendance-all.column.worked-hours')" width="100" />
    <ElTableColumn prop="lateDisplay" :label="$t('attendance-all.column.late')" width="100" />
    <ElTableColumn prop="earlyLeaveDisplay" :label="$t('attendance-all.column.early-leave')" width="100" />
    <ElTableColumn :label="$t('attendance-all.column.status')" min-width="140">
      <template #default="scope">
        <ElTag v-for="badge in scope.row['statuses']" :key="badge.text" class="mr-1" :type="badge.tone" size="small">
          {{ badge.text }}
        </ElTag>
      </template>
    </ElTableColumn>
    <ElTableColumn prop="sourceLabel" :label="$t('attendance-all.column.source')" width="100" />
  </ElTable>
</template>
