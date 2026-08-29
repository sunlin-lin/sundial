<script setup lang="ts">
/**
 * §3.4 扣繳（本頁私有子元件，§1.5）。**不含眷屬**——UI 定案 §3.4 把眷屬與扣繳放同一節，
 * 但計畫 §9 明列眷屬是 Stage 7，本輪不做（見 `.route.ts`／交付報告）。勞退自願提繳率同樣
 * 不在這一輪：後端目前沒有對應欄位或端點。
 *
 * 形狀比照 `DepartmentHistorySection.vue`：清單 `withholding.main.list`（依 `employeeId`），
 * 新增 `withholding.main.create`——新增一筆是加一段新期間，不是覆蓋（UI 定案 §3.6 對薪資設定的
 * 「不直接覆蓋已生效舊資料」原則同樣適用於扣繳，見 `docs/ui/20-employee-list.md` §3.4／§3.6）。
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
  ElRadio,
  ElRadioGroup,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import { withholdingMainCreate, withholdingMainList } from '../../../../api/generated/api-client.ts'
import { isListEcho } from '../../../../shared/api/list-echo.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import { toLoadFailure, type LoadFailure } from '../../../../shared/api/load-failure.ts'
import { formatDate } from '../../../../shared/format/business-date.ts'
import { todayInTaipei } from '../../../../shared/format/business-clock.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canCreateWithholding, canSubmitWithholdingCreateForm } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import {
  emptyWithholdingCreateFormState,
  HISTORY_LIST_PER_PAGE,
  toWithholdingCreatePayload,
  toWithholdingListQuery,
} from '../employees-detail.payload.ts'
import { isCurrentlyEffective, WITHHOLDING_METHOD_CODES, withholdingMethodLabel } from '../employees-detail.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ employeeId: string; can: (code: PermissionCode) => boolean }>()

type Row = {
  readonly id: string
  readonly withholdingMethodCode: 1 | 2
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
  const query = toWithholdingListQuery(props.employeeId, currentPage.value)

  isLoading.value = true
  failure.value = null

  withholdingMainList(query)
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

const today = todayInTaipei()

type FieldKey = 'effectiveFrom'
const KNOWN_FIELD_KEYS: readonly FieldKey[] = ['effectiveFrom']
const ELEMENT_ID: Record<FieldKey, string> = { effectiveFrom: 'withholding-field-effective-from' }

const form = reactive(emptyWithholdingCreateFormState())
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<FieldKey>>(emptyFormErrors())

const canCreate = computed(() => canCreateWithholding(props.can))
const canSubmit = computed(() => canSubmitWithholdingCreateForm({ isSubmitting: isSubmitting.value, form }))

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  withholdingMainCreate(toWithholdingCreatePayload(props.employeeId, form))
    .then(() => {
      ElMessage.success($t('employees-detail.withholding.toast.created'))
      Object.assign(form, emptyWithholdingCreateFormState())
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
    <ElAlert
      v-if="failure?.kind === 'permission-denied'"
      type="error"
      show-icon
      :closable="false"
      :title="failure.message"
    />
    <div v-else-if="failure !== null">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-4" :loading="isLoading" @click="onRetry">{{ $t('employees-detail.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" :rows="4" animated />
    <ElEmpty v-else-if="rows.length === 0" :description="$t('employees-detail.withholding.empty')" />
    <div v-else>
      <ElTable :data="rows" row-key="id" :border="true">
        <ElTableColumn :label="$t('employees-detail.withholding.column.method')">
          <template #default="scope">{{ withholdingMethodLabel(scope.row['withholdingMethodCode'], $t) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.withholding.column.effective-from')" width="120">
          <template #default="scope">{{ formatDate(scope.row['effectiveFrom']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.withholding.column.effective-to')" width="120">
          <template #default="scope">{{ formatDate(scope.row['effectiveTo']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.withholding.column.current')" width="100">
          <template #default="scope">
            <ElTag
              v-if="isCurrentlyEffective(scope.row['effectiveFrom'], scope.row['effectiveTo'], today)"
              type="success"
            >
              {{ $t('employees-detail.withholding.column.current') }}
            </ElTag>
          </template>
        </ElTableColumn>
      </ElTable>
      <ElPagination
        v-if="totalCount > HISTORY_LIST_PER_PAGE"
        class="mt-4 justify-end"
        layout="total, prev, pager, next"
        :total="totalCount"
        :page-size="HISTORY_LIST_PER_PAGE"
        :current-page="currentPage"
        @current-change="onPageChanged"
      />
    </div>

    <ElForm v-if="canCreate" class="mt-4" :inline="true" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-2 w-full"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />
      <ElFormItem :label="$t('employees-onboarding.field.withholding-method')">
        <ElRadioGroup v-model="form.withholdingMethodCode" :disabled="isSubmitting">
          <ElRadio v-for="code in WITHHOLDING_METHOD_CODES" :key="code" :value="code" :border="true">
            {{ withholdingMethodLabel(code, $t) }}
          </ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'effectiveFrom')"
        :id="ELEMENT_ID.effectiveFrom"
        :label="$t('employees-detail.withholding.field.effective-from')"
      >
        <ElDatePicker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-detail.withholding.field.effective-to')">
        <ElDatePicker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem>
        <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
          {{ $t('employees-detail.withholding.action.add') }}
        </ElButton>
      </ElFormItem>
    </ElForm>
  </section>
</template>
