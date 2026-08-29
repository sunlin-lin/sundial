<script setup lang="ts">
/**
 * 員工清單（UI 定案 `docs/ui/20-employee-list.md` §1，計畫 05 Stage 6 第一段）。
 *
 * **重要缺口：本頁的欄位與查詢條件比 UI 定案窄，這是後端目前的回應形狀決定的，不是本頁少做。**
 *
 * UI §1 列的查詢條件是「員工編號或姓名、部門、任職狀態、帳號狀態」，列表欄位是「員工編號、姓名、
 * 部門、職稱、僱用類型、到職日、任職狀態、帳號狀態、操作」。`POST /employees/main/list`
 * （`apps/api/src/modules/employees/main/employees-main.routes.ts`）的請求 schema 只收
 * `keyword`，回應的 `EmployeeSummarySchema` 只有 `id`／`employeeCode`／`name`／`gender`／
 * `identityNumberMasked`／`jobTitleName`——沒有部門、僱用類型、到職日、任職狀態、帳號狀態，
 * 也沒有任何一支查詢端點能在不新增端點的情況下批次補齊這五欄（逐列各打幾支端點會是
 * per-row 查詢，違反本專案的 N+1 政策，且部門／任職／帳號分屬三個不同模組，沒有一個能一次
 * 依「這一頁的這 20 個 id」批次回傳）。
 *
 * 因此本頁**只做得出**：關鍵字查員工編號或姓名、顯示員工編號／姓名／目前有效職稱。
 * 這個落差已經在交付報告裡回報，不是本頁自己決定要少做。
 *
 * **「操作／查看並修改」本輪補上**：修改員工頁（`employees/detail`，UI §3）已經在計畫 05
 * Stage 6 第二段落地，本頁的「操作」欄現在連得到它了。
 *
 * 呈現決策在 `.view.ts`，查詢組裝在 `.payload.ts`，動作可用性在 `.actions.ts`。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElPagination,
  ElSkeleton,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import { employeesMainList } from '../../../api/generated/api-client.ts'
import { isListEcho } from '../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import { canCreateEmployee, canViewEmployeeDetail } from './employees-main.actions.ts'
import {
  defaultEmployeeListFilters,
  EMPLOYEE_LIST_PER_PAGE,
  toEmployeeListQuery,
  type EmployeeListFilters,
} from './employees-main.payload.ts'
import { toDisplayRows, type EmployeeDisplayRow } from './employees-main.view.ts'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()
const $t: TranslateMessage = t

const { isSigningOut, requestSignOut } = useSignOut(() => {
  auth.reset()
  void router.replace({ name: 'sessions-login' })
})

// --- 查詢條件與列表狀態（§2.1：清單留在元件內，換頁重來一次，不進 store） -------------

const filters = ref<EmployeeListFilters>(defaultEmployeeListFilters())
const currentPage = ref(1)
const rows = ref<EmployeeDisplayRow[]>([])
const totalCount = ref(0)
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)

/** 目前第幾次 `load()`：失敗回應沒有回聲可比，用遞增序號代替（理由與 `shifts-main.page.vue` 同構）。 */
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toEmployeeListQuery(filters.value, currentPage.value)

  isLoading.value = true
  failure.value = null

  employeesMainList(query)
    .then((page) => {
      if (thisRequest !== requestSequence) return
      // §7.3：回聲不符就整包丟棄——不寫 rows、不更新分頁、也不關 loading。
      if (!isListEcho(page, query)) return
      rows.value = toDisplayRows(page.data, $t)
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

const retry = (): void => {
  load()
}

/** 篩選條件變更一律回到第 1 頁（§7.1）。 */
const onFilterChanged = (): void => {
  currentPage.value = 1
  load()
}

const onPageChanged = (page: number): void => {
  currentPage.value = page
  load()
}

const goToCreate = (): void => {
  void router.push({ name: 'employees-onboarding' })
}

const goToDetail = (id: string): void => {
  void router.push({ name: 'employees-detail', params: { id } })
}

onMounted(() => {
  load()
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
        <h1 class="text-xl font-semibold text-ink">{{ $t('employees-main.heading') }}</h1>
        <p class="mt-1 text-sm text-ink-muted">{{ $t('employees-main.description') }}</p>
      </div>
      <ElButton v-if="canCreateEmployee(auth.can)" type="primary" @click="goToCreate">
        {{ $t('employees-main.action.create') }}
      </ElButton>
    </div>

    <!--
      UI 定案原本要求部門／任職狀態／帳號狀態三個額外篩選，後端目前的 request schema
      （`employees-main.routes.ts`）只收 `keyword`，因此只有這一個查詢條件（見檔頭說明）。
    -->
    <ElForm class="mt-6" :inline="true" @submit.prevent>
      <ElFormItem :label="$t('employees-main.filter.keyword')">
        <ElInput
          v-model="filters.keyword"
          :placeholder="$t('employees-main.filter.keyword-placeholder')"
          clearable
          @change="onFilterChanged"
        />
      </ElFormItem>
    </ElForm>

    <!-- §7.2 的四態：載入失敗／載入中／空結果／有資料 -->
    <ElAlert
      v-if="failure?.kind === 'permission-denied'"
      type="error"
      show-icon
      :closable="false"
      :title="failure.message"
    />
    <div v-else-if="failure !== null">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-4" :loading="isLoading" @click="retry">{{ $t('employees-main.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" class="mt-4" :rows="6" animated />
    <ElEmpty v-else-if="rows.length === 0 && filters.keyword.trim() === ''" :description="$t('employees-main.empty')" />
    <ElEmpty v-else-if="rows.length === 0" :description="$t('employees-main.empty-filtered')" />
    <div v-else>
      <ElTable :data="rows" row-key="id" class="w-full" :border="true">
        <ElTableColumn prop="employeeCode" :label="$t('employees-main.column.employee-code')" width="160" />
        <ElTableColumn prop="name" :label="$t('employees-main.column.name')" width="160" />
        <ElTableColumn prop="genderLabel" :label="$t('employees-main.column.gender')" width="96" />
        <ElTableColumn prop="jobTitleName" :label="$t('employees-main.column.job-title')" min-width="160" />
        <ElTableColumn :label="$t('employees-main.column.action')" width="120">
          <template #default="scope">
            <ElButton v-if="canViewEmployeeDetail(auth.can)" link type="primary" @click="goToDetail(scope.row['id'])">
              {{ $t('employees-main.action.view') }}
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <ElPagination
        class="mt-4 justify-end"
        layout="total, prev, pager, next"
        :total="totalCount"
        :page-size="EMPLOYEE_LIST_PER_PAGE"
        :current-page="currentPage"
        @current-change="onPageChanged"
      />
    </div>
  </AppShell>
</template>
