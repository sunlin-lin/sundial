<script setup lang="ts">
/**
 * 修改員工（UI 定案 `docs/ui/20-employee-list.md` §3，計畫 05 Stage 6 第二段）。
 *
 * **分頁呈現、每個分頁獨立儲存**（§3 開頭已定案）：本檔只做「載入這位員工＋任職清單」與
 * 分頁框架，五個分頁各自的表單、送出與錯誤處理都在各自的子元件內完成（子元件自己打 API，
 * 理由與 `shifts/main/components/ShiftFormDialog.vue` 同構：每個分頁是一個自己擁有完整
 * 讀寫流程的區塊，不是一份要一次送出的表單）。
 *
 * 任職清單（`employments.main.list`）在這裡載入一次、往下傳給「任職資料」與「組織資料」兩個分頁：
 * 「目前在職中的任職」（`status === 'ACTIVE'`）同時是「辦理離職」的目標，也是「組織資料」分頁
 * 用來掛部門／職稱／職務異動的 `employmentId`——兩個分頁本來就在談同一件事，狀態因此只存一份，
 * 由這裡往下傳，不是各自各打一次 `list`。
 *
 * **§3.5 帳號與角色本輪沒有實際功能**：後端沒有任何端點能由 `employeeId` 查出對應的
 * `companyUserId`（見 `EmployeeAccountRolesTab.vue` 檔頭），因此那個分頁只顯示說明訊息，
 * 已在交付報告回報這個缺口。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElEmpty, ElSkeleton, ElTabPane, ElTabs } from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import { employeesMainGet, employmentsMainList } from '../../../api/generated/api-client.ts'
import { isListEcho } from '../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import { genderLabel } from '../../../shared/employees/gender.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import EmployeeAccountRolesTab from './components/EmployeeAccountRolesTab.vue'
import EmployeeBasicInfoTab from './components/EmployeeBasicInfoTab.vue'
import EmployeeEmploymentTab from './components/EmployeeEmploymentTab.vue'
import EmployeeOrganizationTab from './components/EmployeeOrganizationTab.vue'
import EmployeeWithholdingTab from './components/EmployeeWithholdingTab.vue'
import { EMPLOYMENT_LIST_PER_PAGE, toEmploymentListQuery } from './employees-detail.payload.ts'
import type { EmployeeSummary, EmploymentItem } from './employees-detail.view.ts'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const $t: TranslateMessage = t

const { isSigningOut, requestSignOut } = useSignOut(() => {
  auth.reset()
  void router.replace({ name: 'sessions-login' })
})

/**
 * 路由參數在型別上是 `string | string[]`（vue-router 的 `RouteParamsGeneric`）；本頁的 `:id`
 * 不是重複參數段，執行期恆為字串。三種形狀（陣列、字串、意外缺漏）都收斂成字串，
 * 缺漏時用空字串——`employeesMainGet({ id: '' })` 會被後端當成查無此人，畫面走「找不到」那條路，
 * 不會用一個 `undefined` 悄悄流進 API 呼叫。
 */
const rawId = route.params['id']
const employeeId = Array.isArray(rawId) ? (rawId[0] ?? '') : (rawId ?? '')

// --- 員工明細 -------------------------------------------------------------------------

const employee = ref<EmployeeSummary | null>(null)
const isLoadingEmployee = ref(false)
const employeeFailure = ref<LoadFailure | null>(null)
/** `employees.main.get` 查無資料時回 `data: null`（不是錯誤，見該端點的 OpenAPI 說明）。 */
const employeeNotFound = ref(false)

const loadEmployee = (): void => {
  isLoadingEmployee.value = true
  employeeFailure.value = null
  employeeNotFound.value = false

  employeesMainGet({ id: employeeId })
    .then((result) => {
      if (result === null) {
        employeeNotFound.value = true
        return
      }
      employee.value = result
    })
    .catch((error: unknown) => {
      employeeFailure.value = toLoadFailure(error)
    })
    .finally(() => {
      isLoadingEmployee.value = false
    })
}

const onBasicInfoUpdated = (updated: EmployeeSummary): void => {
  employee.value = updated
}

// --- 任職清單（給「任職資料」與「組織資料」兩個分頁共用） -------------------------------

const employments = ref<EmploymentItem[]>([])
const employmentCurrentPage = ref(1)
const employmentTotalCount = ref(0)
const isLoadingEmployments = ref(false)
const employmentsFailure = ref<LoadFailure | null>(null)
let employmentRequestSequence = 0

const loadEmployments = (): void => {
  employmentRequestSequence += 1
  const thisRequest = employmentRequestSequence
  const query = toEmploymentListQuery(employeeId, employmentCurrentPage.value)

  isLoadingEmployments.value = true
  employmentsFailure.value = null

  employmentsMainList(query)
    .then((page) => {
      if (thisRequest !== employmentRequestSequence) return
      if (!isListEcho(page, query)) return
      employments.value = [...page.data]
      employmentTotalCount.value = page.pagination.totalCount
      isLoadingEmployments.value = false
    })
    .catch((error: unknown) => {
      if (thisRequest !== employmentRequestSequence) return
      employments.value = []
      employmentTotalCount.value = 0
      employmentsFailure.value = toLoadFailure(error)
      isLoadingEmployments.value = false
    })
}

const onEmploymentPageChanged = (page: number): void => {
  employmentCurrentPage.value = page
  loadEmployments()
}

/**
 * 目前在職中的任職。**只在目前這一頁已載入的資料裡找**：清單依到職日新到舊排序，
 * 在職中的任職必然是「還沒有離職日」的那一筆，正常情況下就是到職日最新的一筆、落在第一頁——
 * 除非同一員工有超過一頁（20 筆）的任職紀錄，那種量級的資料在正常的人資情境下不會出現。
 */
const activeEmployment = computed<EmploymentItem | null>(
  () => employments.value.find((item) => item.status === 'ACTIVE') ?? null,
)

const genderText = computed(() => (employee.value === null ? '' : genderLabel(employee.value.gender, $t)))

const retryLoadEmployee = (): void => {
  loadEmployee()
}

const retryLoadEmployments = (): void => {
  loadEmployments()
}

const goBack = (): void => {
  void router.push({ name: 'employees-main' })
}

onMounted(() => {
  loadEmployee()
  loadEmployments()
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
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-xl font-semibold text-ink">{{ $t('employees-detail.heading') }}</h1>
        <p v-if="employee !== null" class="mt-1 text-sm text-ink-muted">
          {{ employee.employeeCode }}　{{ employee.name }}　{{ genderText }}
        </p>
      </div>
      <ElButton @click="goBack">{{ $t('employees-detail.back') }}</ElButton>
    </div>

    <ElAlert
      v-if="employeeFailure?.kind === 'permission-denied'"
      class="mt-6"
      type="error"
      show-icon
      :closable="false"
      :title="employeeFailure.message"
    />
    <div v-else-if="employeeFailure !== null" class="mt-6">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-4" :loading="isLoadingEmployee" @click="retryLoadEmployee">
        {{ $t('employees-detail.retry') }}
      </ElButton>
    </div>
    <ElEmpty v-else-if="employeeNotFound" class="mt-6" :description="$t('employees-detail.not-found')" />
    <ElSkeleton v-else-if="isLoadingEmployee || employee === null" class="mt-6" :rows="8" animated />

    <ElTabs v-else class="mt-6">
      <ElTabPane :label="$t('employees-detail.tab.basic')">
        <EmployeeBasicInfoTab :employee="employee" :can="auth.can" @updated="onBasicInfoUpdated" />
      </ElTabPane>

      <ElTabPane :label="$t('employees-detail.tab.employment')">
        <EmployeeEmploymentTab
          :employee-id="employeeId"
          :employments="employments"
          :active-employment="activeEmployment"
          :total-count="employmentTotalCount"
          :current-page="employmentCurrentPage"
          :per-page="EMPLOYMENT_LIST_PER_PAGE"
          :is-loading="isLoadingEmployments"
          :failure="employmentsFailure"
          :can="auth.can"
          @page-changed="onEmploymentPageChanged"
          @retry="retryLoadEmployments"
          @changed="loadEmployments"
        />
      </ElTabPane>

      <ElTabPane :label="$t('employees-detail.tab.organization')">
        <EmployeeOrganizationTab :active-employment="activeEmployment" :can="auth.can" />
      </ElTabPane>

      <ElTabPane :label="$t('employees-detail.tab.withholding')">
        <EmployeeWithholdingTab :employee-id="employeeId" :can="auth.can" />
      </ElTabPane>

      <ElTabPane :label="$t('employees-detail.tab.account')">
        <EmployeeAccountRolesTab />
      </ElTabPane>
    </ElTabs>
  </AppShell>
</template>
