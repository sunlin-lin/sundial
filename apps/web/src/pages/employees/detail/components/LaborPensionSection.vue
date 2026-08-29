<script setup lang="ts">
/**
 * §3.4 勞退自願提繳率（本頁私有子元件，§1.5，計畫 05 Stage 7）。
 *
 * 形狀比照 `EmployeeWithholdingTab.vue` 既有的扣繳區塊：清單 `labor-pension.main.list`（依
 * `employeeId`），新增 `labor-pension.main.create`——新增一筆是加一段新期間，不是覆蓋（UI 定案
 * §3.4「設定變更均保留歷史及有效期間」）。
 *
 * **期間重疊由後端擋**：同一員工的有效提繳率期間不得重疊，後端在同一筆交易內鎖定員工列
 * 後才做重疊檢查（`labor-pension-main.create.service.ts` 檔頭），回應是 `errors[].data.field
 * === 'effectiveFrom'` 的 `300`——這裡跟其餘表單一樣用 `toFormErrors` 定位標紅，不特別處理，
 * 但訊息本身（`period-overlap`／`duplicate-effective-from`）已經比一句「儲存失敗」更明確，
 * 原樣顯示在 `effectiveFrom` 欄位旁（見交付報告）。
 *
 * **`voluntaryContributionRate` 全程是字串**：輸入是 `ElInput`（純文字），顯示走 `formatRate`
 * （`shared/format/decimal.ts`），中間沒有一次 `Number()`／`parseFloat`——decimal(5,4) 在數字型別
 * 邊界值上失真是本專案明文禁止的事（`check:number-cast`，見 skill 與 `decimal.ts` 檔頭）。
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
  ElInput,
  ElMessage,
  ElPagination,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import { laborPensionMainCreate, laborPensionMainList } from '../../../../api/generated/api-client.ts'
import { isListEcho } from '../../../../shared/api/list-echo.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import { toLoadFailure, type LoadFailure } from '../../../../shared/api/load-failure.ts'
import { formatDate } from '../../../../shared/format/business-date.ts'
import { formatRate } from '../../../../shared/format/decimal.ts'
import { todayInTaipei } from '../../../../shared/format/business-clock.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canCreateLaborPension, canSubmitLaborPensionCreateForm } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import {
  emptyLaborPensionCreateFormState,
  HISTORY_LIST_PER_PAGE,
  toLaborPensionCreatePayload,
  toLaborPensionListQuery,
} from '../employees-detail.payload.ts'
import { isCurrentlyEffective, type LaborPensionItem } from '../employees-detail.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ employeeId: string; can: (code: PermissionCode) => boolean }>()

const rows = ref<LaborPensionItem[]>([])
const currentPage = ref(1)
const totalCount = ref(0)
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toLaborPensionListQuery(props.employeeId, currentPage.value)

  isLoading.value = true
  failure.value = null

  laborPensionMainList(query)
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

type FieldKey = 'voluntaryContributionRate' | 'effectiveFrom'
const KNOWN_FIELD_KEYS: readonly FieldKey[] = ['voluntaryContributionRate', 'effectiveFrom']
const ELEMENT_ID: Record<FieldKey, string> = {
  voluntaryContributionRate: 'labor-pension-field-rate',
  effectiveFrom: 'labor-pension-field-effective-from',
}

const form = reactive(emptyLaborPensionCreateFormState())
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<FieldKey>>(emptyFormErrors())

const canCreate = computed(() => canCreateLaborPension(props.can))
const canSubmit = computed(() => canSubmitLaborPensionCreateForm({ isSubmitting: isSubmitting.value, form }))

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  laborPensionMainCreate(toLaborPensionCreatePayload(props.employeeId, form))
    .then(() => {
      ElMessage.success($t('employees-detail.labor-pension.toast.created'))
      Object.assign(form, emptyLaborPensionCreateFormState())
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
    <h3 class="text-sm font-semibold text-ink">{{ $t('employees-detail.labor-pension.section.title') }}</h3>

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
    <ElEmpty v-else-if="rows.length === 0" class="mt-2" :description="$t('employees-detail.labor-pension.empty')" />
    <div v-else class="mt-2">
      <ElTable :data="rows" row-key="id" :border="true" size="small">
        <ElTableColumn :label="$t('employees-detail.labor-pension.column.rate')">
          <template #default="scope">{{ formatRate(scope.row['voluntaryContributionRate']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.labor-pension.column.effective-from')" width="120">
          <template #default="scope">{{ formatDate(scope.row['effectiveFrom']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.labor-pension.column.effective-to')" width="120">
          <template #default="scope">{{ formatDate(scope.row['effectiveTo']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.labor-pension.column.current')" width="100">
          <template #default="scope">
            <ElTag
              v-if="isCurrentlyEffective(scope.row['effectiveFrom'], scope.row['effectiveTo'], today)"
              type="success"
            >
              {{ $t('employees-detail.labor-pension.column.current') }}
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
        v-bind="formItemErrorProp(formErrors, 'voluntaryContributionRate')"
        :id="ELEMENT_ID.voluntaryContributionRate"
        :label="$t('employees-detail.labor-pension.field.rate')"
      >
        <ElInput
          v-model="form.voluntaryContributionRate"
          :placeholder="$t('employees-detail.labor-pension.field.rate-placeholder')"
          :disabled="isSubmitting"
          class="w-32"
        />
      </ElFormItem>
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'effectiveFrom')"
        :id="ELEMENT_ID.effectiveFrom"
        :label="$t('employees-detail.labor-pension.field.effective-from')"
      >
        <ElDatePicker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem :label="$t('employees-detail.labor-pension.field.effective-to')">
        <ElDatePicker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem>
        <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
          {{ $t('employees-detail.labor-pension.action.add') }}
        </ElButton>
      </ElFormItem>
    </ElForm>
  </section>
</template>
