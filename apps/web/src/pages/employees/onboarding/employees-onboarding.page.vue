<script setup lang="ts">
/**
 * 新增員工（UI 定案 `docs/ui/20-employee-list.md` §2，計畫 05 Stage 6 第一段）。
 *
 * **單頁輸入，不分步驟**：一次送出 `POST /employees/onboarding/create`，後端在單一交易內建立
 * 員工、任職、部門歸屬、職稱、職務、扣繳設定、登入帳號與角色，任一步失敗整筆取消（§2.4）。
 * 四個區塊（§2.1～§2.4）拆成四個私有子元件只是為了不讓這支檔案超過職責上限（§1.2），
 * 資料與送出流程全部留在這裡——子元件不呼叫任何 API。
 *
 * **§2.3 眷屬與勞退是 Stage 7，本頁不收這兩類欄位**（見 `EmployeeWithholdingSection.vue` 檔頭）。
 *
 * 部門／職稱／職務／角色四份字典在 `onMounted` 一次平行載入；任一份失敗就整頁顯示載入失敗
 * （沒有部門或沒有角色可選，表單本來就送不出去，不必假裝表單是可用的）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElForm, ElMessage, ElSkeleton } from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import {
  departmentsMainTree,
  employeesOnboardingCreate,
  jobPositionsMainList,
  jobTitlesMainList,
  rolesMainList,
} from '../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../shared/api/api-error.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import EmployeeAccountSection from './components/EmployeeAccountSection.vue'
import EmployeeBasicInfoSection from './components/EmployeeBasicInfoSection.vue'
import EmployeeEmploymentSection from './components/EmployeeEmploymentSection.vue'
import EmployeeWithholdingSection from './components/EmployeeWithholdingSection.vue'
import { canSubmitOnboardingForm } from './employees-onboarding.actions.ts'
import {
  emptyOnboardingFormErrors,
  firstErroredElementId,
  toGeneralFailureMessage,
  toOnboardingFormErrors,
  type OnboardingFormErrors,
} from './employees-onboarding.errors.view.ts'
import { emptyOnboardingFormState, toOnboardingCreatePayload } from './employees-onboarding.payload.ts'
import {
  activeOnly,
  type DepartmentTreeNode,
  type JobDictionaryItem,
  type RoleDictionaryItem,
} from './employees-onboarding.view.ts'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()
const $t: TranslateMessage = t

const { isSigningOut, requestSignOut } = useSignOut(() => {
  auth.reset()
  void router.replace({ name: 'sessions-login' })
})

// --- 字典：部門樹、職稱、職務、角色（下拉選項的資料來源） -----------------------------

const departmentTree = ref<DepartmentTreeNode[]>([])
const jobTitleOptions = ref<JobDictionaryItem[]>([])
const jobPositionOptions = ref<JobDictionaryItem[]>([])
const roleOptions = ref<RoleDictionaryItem[]>([])
const isLoadingDictionaries = ref(false)
const dictionariesFailure = ref<LoadFailure | null>(null)

/** 字典清單一次最多抓 100 筆（schema 的 `perPage` 上限）：目前沒有能一次抓完整批的端點，
 * 公司內職稱／職務／角色數量若超過 100 筆，這裡就抓不到超出的部分（已在交付報告回報）。 */
const DICTIONARY_PAGE_SIZE = 100

const loadDictionaries = (): void => {
  isLoadingDictionaries.value = true
  dictionariesFailure.value = null

  Promise.all([
    departmentsMainTree({}),
    jobTitlesMainList({ currentPage: 1, perPage: DICTIONARY_PAGE_SIZE }),
    jobPositionsMainList({ currentPage: 1, perPage: DICTIONARY_PAGE_SIZE }),
    rolesMainList({ currentPage: 1, perPage: DICTIONARY_PAGE_SIZE, status: 'ACTIVE' }),
  ])
    .then(([departments, jobTitles, jobPositions, roles]) => {
      departmentTree.value = [...departments]
      jobTitleOptions.value = [...activeOnly(jobTitles.data)]
      jobPositionOptions.value = [...activeOnly(jobPositions.data)]
      roleOptions.value = [...roles.data]
      isLoadingDictionaries.value = false
    })
    .catch((error: unknown) => {
      dictionariesFailure.value = toLoadFailure(error)
      isLoadingDictionaries.value = false
    })
}

const retryLoadDictionaries = (): void => {
  loadDictionaries()
}

// --- 表單狀態與送出 -----------------------------------------------------------------

const form = reactive(emptyOnboardingFormState())
const isSubmitting = ref(false)
const formErrors = ref<OnboardingFormErrors>(emptyOnboardingFormErrors())

const canSubmit = computed(() =>
  canSubmitOnboardingForm({
    isSubmitting: isSubmitting.value,
    isLoadingDictionaries: isLoadingDictionaries.value,
    form,
  }),
)

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyOnboardingFormErrors()

  employeesOnboardingCreate(toOnboardingCreatePayload(form))
    .then(() => {
      ElMessage.success($t('employees-onboarding.toast.created'))
      void router.push({ name: 'employees-main' })
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessRuleError) {
        const result = toOnboardingFormErrors(error.errors)
        formErrors.value = result
        const targetId = firstErroredElementId(result)
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

const onCancel = (): void => {
  void router.push({ name: 'employees-main' })
}

onMounted(() => {
  loadDictionaries()
})
</script>

<template>
  <AppShell
    :user-name="auth.displayName"
    :company-name="auth.companyName"
    :is-signing-out="isSigningOut"
    :can="auth.can"
    @sign-out-requested="requestSignOut"
  >
    <h1 class="text-xl font-semibold text-ink">{{ $t('employees-onboarding.heading') }}</h1>
    <p class="mt-1 text-sm text-ink-muted">{{ $t('employees-onboarding.description') }}</p>

    <ElAlert
      v-if="dictionariesFailure?.kind === 'permission-denied'"
      class="mt-6"
      type="error"
      show-icon
      :closable="false"
      :title="dictionariesFailure.message"
    />
    <div v-else-if="dictionariesFailure !== null" class="mt-6">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-4" :loading="isLoadingDictionaries" @click="retryLoadDictionaries">
        {{ $t('employees-onboarding.retry') }}
      </ElButton>
    </div>
    <ElSkeleton v-else-if="isLoadingDictionaries" class="mt-6" :rows="10" animated />

    <ElForm v-else class="mt-6" label-position="top" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-3"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />

      <EmployeeBasicInfoSection
        v-model:employee-code="form.employeeCode"
        v-model:name="form.name"
        v-model:gender="form.gender"
        v-model:identity-number="form.identityNumber"
        v-model:birthday="form.birthday"
        v-model:phone="form.phone"
        v-model:email="form.email"
        v-model:address="form.address"
        :errors="formErrors"
        :disabled="isSubmitting"
      />

      <EmployeeEmploymentSection
        v-model:employment-type-code="form.employmentTypeCode"
        v-model:employment-nature-code="form.employmentNatureCode"
        v-model:hire-date="form.hireDate"
        v-model:department-id="form.departmentId"
        v-model:job-title-id="form.jobTitleId"
        v-model:job-position-ids="form.jobPositionIds"
        :department-tree="departmentTree"
        :job-title-options="jobTitleOptions"
        :job-position-options="jobPositionOptions"
        :errors="formErrors"
        :disabled="isSubmitting"
      />

      <EmployeeWithholdingSection
        v-model:withholding-method-code="form.withholdingMethodCode"
        :disabled="isSubmitting"
      />

      <EmployeeAccountSection
        v-model:username="form.username"
        v-model:initial-password="form.initialPassword"
        v-model:role-ids="form.roleIds"
        :role-options="roleOptions"
        :errors="formErrors"
        :disabled="isSubmitting"
      />

      <div class="mt-6 flex justify-end gap-3">
        <ElButton :disabled="isSubmitting" @click="onCancel">{{ $t('employees-onboarding.action.cancel') }}</ElButton>
        <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
          {{ $t('employees-onboarding.action.submit') }}
        </ElButton>
      </div>
    </ElForm>
  </AppShell>
</template>
