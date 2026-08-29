<script setup lang="ts">
/**
 * 班別清單表格（本頁私有子元件，§1.5；抽出來的理由同 `DatasetOverviewTable.vue`：把列的呈現與
 * 版面跟頁面的載入／篩選邏輯分開，改一個不會捲動到另一個）。
 *
 * **刪除與啟用／停用直接在這裡呼叫 API**，不透過頁面：這兩個動作只是「確認 → 打一支端點 →
 * 通知父層重新整理清單」，沒有表單、沒有欄位可以標紅，硬要繞一圈到 `.page.vue` 只是多一層轉發。
 * 編輯與複製則往上 emit——那兩個要開對話框（分別是 `ShiftFormDialog`／`ShiftCopyDialog`），
 * 對話框的開關狀態屬於整個頁面的版面配置，不是這張表格自己的事。
 *
 * 啟用／停用走 `update`（計畫 §6），而 `update` 是**全量替換**：因此本元件先呼叫 `get` 拿到完整
 * 明細（含 `description`——清單列本身沒有這一欄），再把 `isActive` 反過來送出去，其餘欄位原封不動。
 */
import { computed, ref } from 'vue'
import { ElButton, ElMessage, ElMessageBox, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { shiftsMainDelete, shiftsMainGet, shiftsMainUpdate } from '../../../../api/generated/api-client.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canCopyShift, canDeleteShift, canEditShift, canToggleShiftActive } from '../shifts-main.actions.ts'
import { toGeneralFailureMessage } from '../shifts-main.errors.view.ts'
import { toFormStateFromDetail, toShiftUpdatePayload } from '../shifts-main.payload.ts'
import type { ShiftDisplayRow } from '../shifts-main.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{
  rows: readonly ShiftDisplayRow[]
  can: (code: PermissionCode) => boolean
}>()

const emit = defineEmits<{
  'edit-requested': [id: string]
  'copy-requested': [source: { id: string; code: string; name: string }]
  changed: []
}>()

// `data` 收可變陣列，props 是唯讀的；複製陣列本身即可，元素仍是同一批唯讀物件（同 §1.4 的理由）。
const tableRows = computed(() => [...props.rows])

/** 目前正在處理刪除／切換啟用狀態的那一列 id；用來只停用**那一顆**按鈕（§6.2），不是整張表。 */
const deletingId = ref<string | null>(null)
const togglingId = ref<string | null>(null)

/**
 * 兩個處置函式刻意只收「用得到的那幾格」（`id`，`onToggleActive` 多收 `isActive`），不是整個
 * `ShiftDisplayRow`：Element Plus 表格 slot 的 `scope.row` 在型別上是 `DefaultRow`
 *（套件本身的 fallback，不是 `ShiftDisplayRow`），把它整包傳進一支要求精確型別的函式會編譯不過；
 * 只挑必要欄位、在模板端用 `scope.row['id']` 這種索引取值（本來就沒有型別保護，同
 * `DatasetOverviewTable.vue` 的既有寫法），呼叫端拿到的參數型別才是乾淨的。
 */
const onDelete = (id: string): void => {
  ElMessageBox.confirm($t('shifts-main.confirm.delete'), $t('shifts-main.confirm.title'), {
    confirmButtonText: $t('shifts-main.confirm.ok'),
    cancelButtonText: $t('shifts-main.confirm.cancel'),
    type: 'warning',
  })
    .then(() => {
      deletingId.value = id
      return shiftsMainDelete({ id })
    })
    .then(() => {
      ElMessage.success($t('shifts-main.toast.deleted'))
      emit('changed')
    })
    .catch((error: unknown) => {
      // `ElMessageBox.confirm` 取消時也會落到這個 `catch`（它用 reject 表達取消），
      // 用 `deletingId` 是否已經被設成這一列來分辨「使用者取消」與「API 真的失敗」。
      if (deletingId.value !== id) return
      ElMessage.error(toGeneralFailureMessage(error, $t))
    })
    .finally(() => {
      if (deletingId.value === id) deletingId.value = null
    })
}

const onToggleActive = (row: { id: string; isActive: boolean }): void => {
  const confirmKey = row.isActive ? 'shifts-main.confirm.deactivate' : 'shifts-main.confirm.activate'
  ElMessageBox.confirm($t(confirmKey), $t('shifts-main.confirm.title'), {
    confirmButtonText: $t('shifts-main.confirm.ok'),
    cancelButtonText: $t('shifts-main.confirm.cancel'),
    type: 'warning',
  })
    .then(() => {
      togglingId.value = row.id
      return shiftsMainGet({ id: row.id })
    })
    .then((detail) => {
      if (detail === null) throw new Error('shift not found')
      const form = toFormStateFromDetail(detail)
      form.isActive = !row.isActive
      return shiftsMainUpdate(toShiftUpdatePayload(row.id, form))
    })
    .then(() => {
      ElMessage.success($t(row.isActive ? 'shifts-main.toast.deactivated' : 'shifts-main.toast.activated'))
      emit('changed')
    })
    .catch((error: unknown) => {
      if (togglingId.value !== row.id) return
      ElMessage.error(toGeneralFailureMessage(error, $t))
    })
    .finally(() => {
      if (togglingId.value === row.id) togglingId.value = null
    })
}
</script>

<template>
  <ElTable :data="tableRows" row-key="id" class="w-full" :border="true">
    <ElTableColumn prop="code" :label="$t('shifts-main.column.code')" width="140" />
    <ElTableColumn prop="name" :label="$t('shifts-main.column.name')" min-width="140" />
    <ElTableColumn prop="workType" :label="$t('shifts-main.column.work-type')" width="90" />

    <!-- 多段時段各自一行；`white-space:pre-line` 保留 `.view.ts` 組好的換行（同 `regulatory-sync` 的失敗原因欄）。 -->
    <ElTableColumn :label="$t('shifts-main.column.work-periods')" min-width="160">
      <template #default="scope">
        <span class="block whitespace-pre-line">{{ scope.row['workPeriods'] }}</span>
      </template>
    </ElTableColumn>
    <ElTableColumn :label="$t('shifts-main.column.breaks')" min-width="180">
      <template #default="scope">
        <span class="block whitespace-pre-line">{{ scope.row['breaks'] }}</span>
      </template>
    </ElTableColumn>

    <ElTableColumn prop="requiredHours" :label="$t('shifts-main.column.required-hours')" width="110" align="right" />
    <ElTableColumn prop="overnight" :label="$t('shifts-main.column.overnight')" width="70" align="center" />
    <ElTableColumn prop="flexible" :label="$t('shifts-main.column.flexible')" width="70" align="center" />

    <ElTableColumn :label="$t('shifts-main.column.status')" width="90">
      <template #default="scope">
        <ElTag :type="scope.row['statusTone']" :effect="scope.row['statusEffect']" disable-transitions>
          {{ scope.row['statusLabel'] }}
        </ElTag>
      </template>
    </ElTableColumn>

    <ElTableColumn :label="$t('shifts-main.column.actions')" width="220" align="center">
      <template #default="scope">
        <ElButton v-if="canEditShift(can)" link type="primary" @click="$emit('edit-requested', scope.row['id'])">
          {{ $t('shifts-main.action.edit') }}
        </ElButton>
        <ElButton
          v-if="canCopyShift(can)"
          link
          type="primary"
          @click="$emit('copy-requested', { id: scope.row['id'], code: scope.row['code'], name: scope.row['name'] })"
        >
          {{ $t('shifts-main.action.copy') }}
        </ElButton>
        <ElButton
          v-if="canToggleShiftActive(can)"
          link
          type="primary"
          :loading="togglingId === scope.row['id']"
          :disabled="togglingId !== null && togglingId !== scope.row['id']"
          @click="onToggleActive({ id: scope.row['id'], isActive: scope.row['isActive'] })"
        >
          {{ $t(scope.row['isActive'] ? 'shifts-main.action.deactivate' : 'shifts-main.action.activate') }}
        </ElButton>
        <ElButton
          v-if="canDeleteShift(can)"
          link
          type="danger"
          :loading="deletingId === scope.row['id']"
          :disabled="deletingId !== null && deletingId !== scope.row['id']"
          @click="onDelete(scope.row['id'])"
        >
          {{ $t('shifts-main.action.delete') }}
        </ElButton>
      </template>
    </ElTableColumn>
  </ElTable>
</template>
