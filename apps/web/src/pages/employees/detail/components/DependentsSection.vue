<script setup lang="ts">
/**
 * §3.4 眷屬（本頁私有子元件，§1.5，計畫 05 Stage 7）。
 *
 * **這一輪只做「員工明細頁補登」，不接進新增員工的單一交易**——UI 定案 §2.3 把眷屬畫在新增
 * 表單裡，但計畫 §3.3／§4.1／§8 Stage 7 把眷屬歸類為「可建立後補登」，新增員工的原子性交易
 * （員工／任職／帳號／角色四項）沒有把眷屬算進去，後端也確實沒有把 `dependents.main.create`
 * 掛進 `employees.onboarding.create` 那筆交易。UI 定案在這裡與後端實作的範圍不一致，
 * 本輪只做這一半（見交付報告），`employees/onboarding` 那一頁不動。
 *
 * 形狀比照 `DepartmentHistorySection.vue`：清單 `dependents.main.list`（依 `employeeId`），
 * 新增 `dependents.main.create`——新增一筆是加一位新眷屬，不是修改既有的（後端也沒有
 * update 端點，見計畫 §6／`dependents-main.create.service.ts` 檔頭）。**「終止」是狀態變更，
 * 不是刪除**（UI 定案 §3.4）：清單裡永遠看得到已終止的眷屬，只是狀態標籤不同，動作欄的「終止」
 * 按鈕只在 `status === 'ACTIVE'` 時顯示。
 *
 * **身分證字號是遮罩值**：`identityNumberMasked`／`birthdayMasked` 是後端加密儲存後回應的遮罩字串
 * （見 `dependent-secrets.ts`），這裡原樣顯示，不嘗試解遮罩或另外要求明文——前端從來拿不到明文。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElDatePicker,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElPagination,
  ElRadio,
  ElRadioGroup,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import { dependentsMainCreate, dependentsMainList } from '../../../../api/generated/api-client.ts'
import { isListEcho } from '../../../../shared/api/list-echo.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import { toLoadFailure, type LoadFailure } from '../../../../shared/api/load-failure.ts'
import { formatDate } from '../../../../shared/format/business-date.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canCreateDependent, canSubmitDependentCreateForm, canTerminateDependent } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import {
  emptyDependentCreateFormState,
  HISTORY_LIST_PER_PAGE,
  toDependentCreatePayload,
  toDependentListQuery,
} from '../employees-detail.payload.ts'
import {
  DEPENDENT_RELATIONSHIP_CODES,
  dependentRelationshipLabel,
  dependentStatusLabel,
  dependentStatusTagType,
  type DependentItem,
} from '../employees-detail.view.ts'
import DependentTerminateDialog from './DependentTerminateDialog.vue'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ employeeId: string; can: (code: PermissionCode) => boolean }>()

const rows = ref<DependentItem[]>([])
const currentPage = ref(1)
const totalCount = ref(0)
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toDependentListQuery(props.employeeId, currentPage.value)

  isLoading.value = true
  failure.value = null

  dependentsMainList(query)
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

// --- 新增表單 -------------------------------------------------------------------------

type FieldKey = 'name' | 'identityNumber' | 'birthday' | 'relationshipCode' | 'effectiveDate'
const KNOWN_FIELD_KEYS: readonly FieldKey[] = [
  'name',
  'identityNumber',
  'birthday',
  'relationshipCode',
  'effectiveDate',
]
const ELEMENT_ID: Record<FieldKey, string> = {
  name: 'dependent-field-name',
  identityNumber: 'dependent-field-identity-number',
  birthday: 'dependent-field-birthday',
  relationshipCode: 'dependent-field-relationship-code',
  effectiveDate: 'dependent-field-effective-date',
}

const form = reactive(emptyDependentCreateFormState())
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<FieldKey>>(emptyFormErrors())

const canCreate = computed(() => canCreateDependent(props.can))
const canSubmit = computed(() => canSubmitDependentCreateForm({ isSubmitting: isSubmitting.value, form }))

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  dependentsMainCreate(toDependentCreatePayload(props.employeeId, form))
    .then(() => {
      ElMessage.success($t('employees-detail.dependent.toast.created'))
      Object.assign(form, emptyDependentCreateFormState())
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

// --- 終止扶養 -------------------------------------------------------------------------

const terminatingDependent = ref<DependentItem | null>(null)

/**
 * 接收 `id`（字串）而不是整筆 `scope.row`：`ElTableColumn` 預設插槽的 `scope.row` 型別是
 * Element Plus 的 `DefaultRow`（沒有泛型化），直接傳整個物件給收窄型別的函式會被 `vue-tsc` 擋——
 * 症狀與 skill 記錄的其餘 Element Plus 地雷同構。改成傳 `id` 再回頭從 `rows` 裡找，
 * 理由與 `AccountRoleAssignmentSection.vue` 的 `onRevoke(scope.row['roleId'])` 同構。
 */
const onRequestTerminate = (id: string): void => {
  terminatingDependent.value = rows.value.find((row) => row.id === id) ?? null
}

const onDialogClosed = (): void => {
  terminatingDependent.value = null
}

const onDialogSaved = (): void => {
  load()
}

onMounted(() => {
  load()
})
</script>

<template>
  <section>
    <h3 class="text-sm font-semibold text-ink">{{ $t('employees-detail.dependent.section.title') }}</h3>

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
    <ElEmpty v-else-if="rows.length === 0" class="mt-2" :description="$t('employees-detail.dependent.empty')" />
    <div v-else class="mt-2">
      <ElTable :data="rows" row-key="id" :border="true" size="small">
        <ElTableColumn :label="$t('employees-detail.dependent.column.name')">
          <template #default="scope">{{ scope.row['name'] }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.dependent.column.identity-number')">
          <template #default="scope">{{ scope.row['identityNumberMasked'] }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.dependent.column.relationship')">
          <template #default="scope">{{ dependentRelationshipLabel(scope.row['relationshipCode'], $t) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.dependent.column.effective-date')" width="120">
          <template #default="scope">{{ formatDate(scope.row['effectiveDate']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.dependent.column.end-date')" width="120">
          <template #default="scope">{{ formatDate(scope.row['endDate']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.dependent.column.status')" width="90">
          <template #default="scope">
            <ElTag :type="dependentStatusTagType(scope.row['status'])">
              {{ dependentStatusLabel(scope.row['status'], $t) }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.employment.column.action')" width="100">
          <template #default="scope">
            <ElButton
              v-if="canTerminateDependent(can, scope.row['status'])"
              size="small"
              type="danger"
              @click="onRequestTerminate(scope.row['id'])"
            >
              {{ $t('employees-detail.dependent.action.terminate') }}
            </ElButton>
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

    <ElForm v-if="canCreate" class="mt-3" label-position="top" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-2 w-full"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />
      <div class="grid grid-cols-2 gap-x-4 md:grid-cols-3">
        <ElFormItem
          v-bind="formItemErrorProp(formErrors, 'name')"
          :id="ELEMENT_ID.name"
          :label="$t('employees-detail.dependent.field.name')"
        >
          <ElInput v-model="form.name" :disabled="isSubmitting" />
        </ElFormItem>
        <ElFormItem
          v-bind="formItemErrorProp(formErrors, 'identityNumber')"
          :id="ELEMENT_ID.identityNumber"
          :label="$t('employees-detail.dependent.field.identity-number')"
        >
          <ElInput v-model="form.identityNumber" :disabled="isSubmitting" />
        </ElFormItem>
        <ElFormItem
          v-bind="formItemErrorProp(formErrors, 'birthday')"
          :id="ELEMENT_ID.birthday"
          :label="$t('employees-detail.dependent.field.birthday')"
        >
          <ElDatePicker
            v-model="form.birthday"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled="isSubmitting"
            class="w-full"
          />
        </ElFormItem>
        <ElFormItem
          v-bind="formItemErrorProp(formErrors, 'effectiveDate')"
          :id="ELEMENT_ID.effectiveDate"
          :label="$t('employees-detail.dependent.field.effective-date')"
        >
          <ElDatePicker
            v-model="form.effectiveDate"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled="isSubmitting"
            class="w-full"
          />
        </ElFormItem>
      </div>
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'relationshipCode')"
        :id="ELEMENT_ID.relationshipCode"
        :label="$t('employees-detail.dependent.field.relationship-code')"
      >
        <ElRadioGroup v-model="form.relationshipCode" :disabled="isSubmitting">
          <ElRadio v-for="code in DEPENDENT_RELATIONSHIP_CODES" :key="code" :value="code" :border="true">
            {{ dependentRelationshipLabel(code, $t) }}
          </ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <div class="flex flex-wrap gap-4">
        <ElCheckbox v-model="form.isStudent" :disabled="isSubmitting">
          {{ $t('employees-detail.dependent.field.is-student') }}
        </ElCheckbox>
        <ElCheckbox v-model="form.isDisabled" :disabled="isSubmitting">
          {{ $t('employees-detail.dependent.field.is-disabled') }}
        </ElCheckbox>
        <ElCheckbox v-model="form.isUnableToWork" :disabled="isSubmitting">
          {{ $t('employees-detail.dependent.field.is-unable-to-work') }}
        </ElCheckbox>
        <ElCheckbox v-model="form.isCohabiting" :disabled="isSubmitting">
          {{ $t('employees-detail.dependent.field.is-cohabiting') }}
        </ElCheckbox>
      </div>
      <ElFormItem class="mt-2">
        <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
          {{ $t('employees-detail.dependent.action.add') }}
        </ElButton>
      </ElFormItem>
    </ElForm>

    <DependentTerminateDialog :dependent="terminatingDependent" @close="onDialogClosed" @saved="onDialogSaved" />
  </section>
</template>
