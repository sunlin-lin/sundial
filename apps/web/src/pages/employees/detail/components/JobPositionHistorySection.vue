<script setup lang="ts">
/**
 * §3.3 組織資料：職務異動（本頁私有子元件，§1.5）。與部門／職稱兩個手足最大的差異：
 * 「同一時間可以有多個有效職務」（UI 定案 §3.3），因此欄位是 `jobPositionIds`（多選），
 * `create` 端點一次可能建立好幾筆（回應是 `items` 陣列，不是單筆）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElMessage,
  ElPagination,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTreeSelect,
} from 'element-plus'
import {
  employmentsJobPositionHistoriesCreate,
  employmentsJobPositionHistoriesList,
} from '../../../../api/generated/api-client.ts'
import { isListEcho } from '../../../../shared/api/list-echo.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import { toLoadFailure, type LoadFailure } from '../../../../shared/api/load-failure.ts'
import { formatDate } from '../../../../shared/format/business-date.ts'
import { todayInTaipei } from '../../../../shared/format/business-clock.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canCreateJobPositionHistory, canSubmitJobPositionHistoryForm } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import {
  emptyJobPositionHistoryFormState,
  HISTORY_LIST_PER_PAGE,
  toJobPositionHistoryListQuery,
  toJobPositionHistoryPayload,
} from '../employees-detail.payload.ts'
import { isCurrentlyEffective, type JobDictionaryItem } from '../employees-detail.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{
  employmentId: string
  jobPositionOptions: JobDictionaryItem[]
  can: (code: PermissionCode) => boolean
}>()

type Row = {
  readonly id: string
  readonly jobPositionId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

const rows = ref<Row[]>([])
const currentPage = ref(1)
const totalCount = ref(0)
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toJobPositionHistoryListQuery(props.employmentId, currentPage.value)

  isLoading.value = true
  failure.value = null

  employmentsJobPositionHistoriesList(query)
    .then((page) => {
      if (thisRequest !== requestSequence) return
      if (!isListEcho(page, query)) return
      rows.value = [...page.data]
      totalCount.value = page.pagination.totalCount
      isLoading.value = false
    })
    .catch((error: unknown) => {
      if (thisRequest !== requestSequence) return
      rows.value = []
      totalCount.value = 0
      failure.value = toLoadFailure(error)
      isLoading.value = false
    })
}

const onPageChanged = (page: number): void => {
  currentPage.value = page
  load()
}

const onRetry = (): void => {
  load()
}

const jobPositionNameOf = (jobPositionId: string): string => {
  const found = props.jobPositionOptions.find((item) => item.id === jobPositionId)
  return found?.name ?? jobPositionId
}

const today = todayInTaipei()

type FieldKey = 'jobPositionIds' | 'effectiveFrom'
const KNOWN_FIELD_KEYS: readonly FieldKey[] = ['jobPositionIds', 'effectiveFrom']
const ELEMENT_ID: Record<FieldKey, string> = {
  jobPositionIds: 'organization-job-position-field-job-position-ids',
  effectiveFrom: 'organization-job-position-field-effective-from',
}

const form = reactive(emptyJobPositionHistoryFormState())
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<FieldKey>>(emptyFormErrors())

const canCreate = computed(() => canCreateJobPositionHistory(props.can))
const canSubmit = computed(() => canSubmitJobPositionHistoryForm({ isSubmitting: isSubmitting.value, form }))

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  employmentsJobPositionHistoriesCreate(toJobPositionHistoryPayload(props.employmentId, form))
    .then(() => {
      ElMessage.success($t('employees-detail.organization.toast.job-position-created'))
      Object.assign(form, emptyJobPositionHistoryFormState())
      currentPage.value = 1
      load()
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessRuleError) {
        const result = toFormErrors(error.errors, KNOWN_FIELD_KEYS)
        formErrors.value = result
        const targetId = firstErroredElementId(result, KNOWN_FIELD_KEYS, ELEMENT_ID)
        if (targetId !== undefined) {
          document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        return
      }
      formErrors.value = { fieldErrors: new Map(), generalMessages: [toGeneralFailureMessage(error, $t)] }
    })
    .finally(() => {
      isSubmitting.value = false
    })
}

onMounted(() => {
  load()
})
</script>

<template>
  <section>
    <h3 class="text-sm font-semibold text-ink">{{ $t('employees-detail.organization.section.job-positions') }}</h3>

    <ElAlert
      v-if="failure?.kind === 'permission-denied'"
      class="mt-2"
      type="error"
      show-icon
      :closable="false"
      :title="failure.message"
    />
    <div v-else-if="failure !== null" class="mt-2">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-2" :loading="isLoading" @click="onRetry">{{ $t('employees-detail.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" class="mt-2" :rows="3" animated />
    <ElEmpty v-else-if="rows.length === 0" class="mt-2" :description="$t('employees-detail.organization.empty')" />
    <div v-else class="mt-2">
      <ElTable :data="rows" row-key="id" :border="true" size="small">
        <ElTableColumn :label="$t('employees-detail.organization.column.job-positions')">
          <template #default="scope">{{ jobPositionNameOf(scope.row['jobPositionId']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.organization.column.effective-from')" width="120">
          <template #default="scope">{{ formatDate(scope.row['effectiveFrom']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.organization.column.effective-to')" width="120">
          <template #default="scope">{{ formatDate(scope.row['effectiveTo']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.organization.column.current')" width="100">
          <template #default="scope">
            <ElTag
              v-if="isCurrentlyEffective(scope.row['effectiveFrom'], scope.row['effectiveTo'], today)"
              type="success"
            >
              {{ $t('employees-detail.organization.column.current') }}
            </ElTag>
          </template>
        </ElTableColumn>
      </ElTable>
      <ElPagination
        v-if="totalCount > HISTORY_LIST_PER_PAGE"
        class="mt-2 justify-end"
        layout="total, prev, pager, next"
        :total="totalCount"
        :page-size="HISTORY_LIST_PER_PAGE"
        :current-page="currentPage"
        @current-change="onPageChanged"
      />
    </div>

    <ElForm v-if="canCreate" class="mt-3" :inline="true" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-2 w-full"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'jobPositionIds')"
        :id="ELEMENT_ID.jobPositionIds"
        :label="$t('employees-onboarding.field.job-positions')"
      >
        <ElTreeSelect
          v-model="form.jobPositionIds"
          :data="jobPositionOptions"
          multiple
          show-checkbox
          node-key="id"
          :props="{ label: 'name' }"
          :disabled="isSubmitting"
          filterable
          class="w-56"
        />
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'effectiveFrom')"
        :id="ELEMENT_ID.effectiveFrom"
        :label="$t('employees-detail.organization.field.effective-from')"
      >
        <ElDatePicker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-detail.organization.field.effective-to')">
        <ElDatePicker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem>
        <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
          {{ $t('employees-detail.organization.action.add') }}
        </ElButton>
      </ElFormItem>
    </ElForm>
  </section>
</template>
