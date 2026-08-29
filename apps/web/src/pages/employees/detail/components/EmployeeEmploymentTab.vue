<script setup lang="ts">
/**
 * §3.2 任職資料（本頁私有子元件，§1.5）。
 *
 * 清單本身（`employments.main.list` 的載入、分頁、race condition 防護）留在 `.page.vue`——
 * 「任職資料」與「組織資料」兩個分頁共用同一份清單（理由見 `.page.vue` 檔頭），這裡只負責呈現
 * 清單、開對話框收集「新增任職」與「辦理離職」兩個動作各自的表單，動作本身各自委派給
 * 兩個對話框元件（它們自己打 API，理由同 `ShiftFormDialog.vue`）。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElEmpty, ElPagination, ElSkeleton, ElTable, ElTableColumn, ElTag } from 'element-plus'
import type { LoadFailure } from '../../../../shared/api/load-failure.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canCreateEmployment, canLeaveEmployment } from '../employees-detail.actions.ts'
import {
  employmentStatusLabel,
  employmentStatusTagType,
  employmentTypeLabel,
  formatOpenCode,
  type EmploymentItem,
} from '../employees-detail.view.ts'
import { formatDate } from '../../../../shared/format/business-date.ts'
import EmploymentCreateDialog from './EmploymentCreateDialog.vue'
import EmploymentLeaveDialog from './EmploymentLeaveDialog.vue'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{
  employeeId: string
  employments: EmploymentItem[]
  activeEmployment: EmploymentItem | null
  totalCount: number
  currentPage: number
  perPage: number
  isLoading: boolean
  failure: LoadFailure | null
  can: (code: PermissionCode) => boolean
}>()

const emit = defineEmits<{ 'page-changed': [page: number]; retry: []; changed: [] }>()

const isCreateDialogOpen = ref(false)
const leaveDialogTarget = ref<EmploymentItem | null>(null)

const canCreate = computed(() => canCreateEmployment(props.can, props.activeEmployment !== null))
const canLeave = computed(() => canLeaveEmployment(props.can, props.activeEmployment?.id ?? null))

const openCreateDialog = (): void => {
  isCreateDialogOpen.value = true
}

const openLeaveDialog = (): void => {
  leaveDialogTarget.value = props.activeEmployment
}

const closeLeaveDialog = (): void => {
  leaveDialogTarget.value = null
}

const onChanged = (): void => {
  emit('changed')
}

const onPageChanged = (page: number): void => {
  emit('page-changed', page)
}

const onRetry = (): void => {
  emit('retry')
}
</script>

<template>
  <section>
    <div class="flex items-center justify-between">
      <p class="text-xs text-ink-muted">{{ $t('employees-detail.employment.dialog.create-hint') }}</p>
      <div class="flex gap-2">
        <ElButton :disabled="!canLeave" @click="openLeaveDialog">{{
          $t('employees-detail.employment.action.leave')
        }}</ElButton>
        <ElButton type="primary" :disabled="!canCreate" @click="openCreateDialog">
          {{ $t('employees-detail.employment.action.create') }}
        </ElButton>
      </div>
    </div>

    <ElAlert
      v-if="failure?.kind === 'permission-denied'"
      class="mt-4"
      type="error"
      show-icon
      :closable="false"
      :title="failure.message"
    />
    <div v-else-if="failure !== null" class="mt-4">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-4" :loading="isLoading" @click="onRetry">{{ $t('employees-detail.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" class="mt-4" :rows="4" animated />
    <ElEmpty v-else-if="employments.length === 0" class="mt-4" :description="$t('employees-detail.employment.empty')" />
    <div v-else class="mt-4">
      <ElTable :data="employments" row-key="id" :border="true">
        <ElTableColumn :label="$t('employees-detail.employment.column.hire-date')" width="120">
          <template #default="scope">{{ formatDate(scope.row['hireDate']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.employment.column.type')" width="100">
          <template #default="scope">{{ employmentTypeLabel(scope.row['employmentTypeCode'], $t) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.employment.column.status')" width="100">
          <template #default="scope">
            <ElTag :type="employmentStatusTagType(scope.row['status'])">{{
              employmentStatusLabel(scope.row['status'], $t)
            }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.employment.column.leave-date')" width="120">
          <template #default="scope">{{ formatDate(scope.row['leaveDate']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.employment.column.last-working-date')" width="120">
          <template #default="scope">{{ formatDate(scope.row['lastWorkingDate']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.employment.column.leave-reason')" width="120">
          <template #default="scope">{{ formatOpenCode(scope.row['leaveReasonCode']) }}</template>
        </ElTableColumn>
      </ElTable>
      <ElPagination
        class="mt-4 justify-end"
        layout="total, prev, pager, next"
        :total="totalCount"
        :page-size="perPage"
        :current-page="currentPage"
        @current-change="onPageChanged"
      />
    </div>

    <EmploymentCreateDialog v-model:open="isCreateDialogOpen" :employee-id="employeeId" @saved="onChanged" />
    <EmploymentLeaveDialog :employment="leaveDialogTarget" @close="closeLeaveDialog" @saved="onChanged" />
  </section>
</template>
