<script setup lang="ts">
/**
 * 每日全員打卡明細的列表表格（本頁私有子元件，§1.5）。
 *
 * **本表格不呼叫任何 API**：與 `ShiftListTable.vue`（刪除／啟停用直接在表格內呼叫）不同——
 * 這裡的「查看明細」要先打一支 `get` 才有內容可顯示、「撤銷」需要一個填寫原因的表單，兩者都不是
 * 「確認→打一支端點」這種零表單的簡單動作，因此開對話框的決定往上 emit，交給 `.page.vue` 決定
 * 開哪一個對話框、帶哪一筆 id——與 `shifts-main.page.vue` 對 `ShiftFormDialog`／`ShiftCopyDialog`
 * 的既有分工相同。
 *
 * **已撤銷的列整列灰階**（`revokedRowClass`，UI 23）：用 `ElTable` 的 `row-class-name`。
 */
import { ElTable, ElTableColumn, ElButton } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canRevokeDailyRecord } from '../attendance-daily-records.actions.ts'
import { revokedRowClass, type AttendanceDailyRecordDisplayRow } from '../attendance-daily-records.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{
  rows: readonly AttendanceDailyRecordDisplayRow[]
  can: (code: PermissionCode) => boolean
}>()

const emit = defineEmits<{ 'detail-requested': [id: string]; 'revoke-requested': [id: string] }>()

/**
 * `ElTable` 的 `row-class-name` 收到的 `row` 與 `ElTableColumn` 預設插槽的 `scope.row` 是同一種
 * 未泛型化的 `DefaultRow`（§1.8 的同一個限制，只是換一個 prop 名字踩到）。用索引取值而不是把
 * 整個 `row` 交給要求精確型別的 {@link revokedRowClass}，避免 `vue-tsc` 在這裡報一個看起來像
 * Element Plus 內部型別壞掉、實際上是本專案 `exactOptionalPropertyTypes` 造成的錯誤。
 */
const rowClassName = (data: { row: Record<string, unknown> }): string =>
  revokedRowClass({ isRevoked: data.row['isRevoked'] === true })
</script>

<template>
  <ElTable :data="[...rows]" row-key="id" class="w-full" :border="true" :row-class-name="rowClassName">
    <ElTableColumn prop="employeeCode" :label="$t('attendance-daily-records.column.employee-code')" width="120" />
    <ElTableColumn prop="employeeName" :label="$t('attendance-daily-records.column.employee-name')" width="120" />
    <ElTableColumn prop="departmentName" :label="$t('attendance-daily-records.column.department')" min-width="140" />
    <ElTableColumn
      prop="attendanceTypeLabel"
      :label="$t('attendance-daily-records.column.attendance-type')"
      width="90"
    />
    <ElTableColumn prop="clockedAtDisplay" :label="$t('attendance-daily-records.column.clocked-at')" width="160" />
    <ElTableColumn prop="locationDisplay" :label="$t('attendance-daily-records.column.location')" width="90" />
    <ElTableColumn prop="sourceLabel" :label="$t('attendance-daily-records.column.source')" width="100" />
    <ElTableColumn prop="statusLabel" :label="$t('attendance-daily-records.column.status')" width="90" />

    <ElTableColumn :label="$t('attendance-daily-records.column.action')" width="160" align="center">
      <template #default="scope">
        <ElButton link type="primary" @click="emit('detail-requested', scope.row['id'])">
          {{ $t('attendance-daily-records.action.view-detail') }}
        </ElButton>
        <ElButton
          v-if="canRevokeDailyRecord({ isRevoked: scope.row['isRevoked'], can })"
          link
          type="danger"
          @click="emit('revoke-requested', scope.row['id'])"
        >
          {{ $t('attendance-daily-records.action.revoke') }}
        </ElButton>
      </template>
    </ElTableColumn>
  </ElTable>
</template>
