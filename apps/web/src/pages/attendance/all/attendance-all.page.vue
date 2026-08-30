<script setup lang="ts">
/**
 * 全體出勤（計畫 06 §5 Stage 7；UI 定案 `docs/ui/09-ui-all-attendance.md`，已由使用者確認，
 * 照該文件實作，不重新設計畫面）。
 *
 * 看的是**判定結果**：`attendance_results`，公司範圍，一位員工一天一列，可依部門／人員篩選。
 * 與 `attendance/daily-records`（看原始打卡事實）分工不同，見同目錄 `.route.ts` 檔頭。
 *
 * 部門樹（篩選用）在 `onMounted` 載入一次，**失敗時不擋住整頁**——與
 * `attendance-daily-records.page.vue` 的既有慣例相同：部門樹只是篩選條件的選項來源，不是
 * 「沒有它整頁就不能用」（列表本身只靠年月就查得到）。
 *
 * 表格、篩選條件分別在 `components/` 底下——本檔只負責查詢狀態與資料載入。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElEmpty, ElPagination, ElSkeleton } from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import { attendanceResultsList, departmentsMainTree } from '../../../api/generated/api-client.ts'
import { isListEcho } from '../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import AttendanceAllFilters from './components/AttendanceAllFilters.vue'
import AttendanceAllTable from './components/AttendanceAllTable.vue'
import {
  defaultAttendanceAllFilters,
  hasActiveAttendanceAllFilters,
  ATTENDANCE_ALL_PER_PAGE,
  toAttendanceAllListQuery,
  type AttendanceAllFilters as AttendanceAllFiltersState,
} from './attendance-all.payload.ts'
import { toDisplayRows, type AttendanceAllDisplayRow, type DepartmentTreeNode } from './attendance-all.view.ts'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()
const $t: TranslateMessage = t

const { isSigningOut, requestSignOut } = useSignOut(() => {
  auth.reset()
  void router.replace({ name: 'sessions-login' })
})

// --- 部門樹（篩選用，見檔頭：失敗不擋住整頁） -------------------------------------------
const departmentTree = ref<DepartmentTreeNode[]>([])

onMounted(() => {
  departmentsMainTree({})
    .then((tree) => {
      departmentTree.value = [...tree]
    })
    .catch(() => {
      departmentTree.value = []
    })
})

// --- 查詢條件與列表狀態（§2.1：清單留在元件內，換頁重來一次，不進 store） -------------
const filters = ref<AttendanceAllFiltersState>(defaultAttendanceAllFilters())
const currentPage = ref(1)
const rows = ref<readonly AttendanceAllDisplayRow[]>([])
const totalCount = ref(0)
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)

/** 目前第幾次 `load()`：失敗的回應沒有回聲可比，用遞增序號代替（`shifts-main.page.vue` 同構）。 */
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toAttendanceAllListQuery(filters.value, currentPage.value)

  isLoading.value = true
  failure.value = null

  attendanceResultsList(query)
    .then((page) => {
      if (thisRequest !== requestSequence) return
      // §7.3：回聲不符就整包丟棄。
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
    <div>
      <h1 class="text-xl font-semibold text-ink">{{ $t('attendance-all.heading') }}</h1>
      <p class="mt-1 text-sm text-ink-muted">{{ $t('attendance-all.description') }}</p>
    </div>

    <AttendanceAllFilters
      v-model:year-month="filters.yearMonth"
      v-model:department-id="filters.departmentId"
      v-model:employee-id="filters.employeeId"
      class="mt-6"
      :department-tree="departmentTree"
      :disabled="isLoading"
      @changed="onFilterChanged"
    />

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
      <ElButton class="mt-4" :loading="isLoading" @click="retry">{{ $t('attendance-all.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" class="mt-4" :rows="6" animated />
    <ElEmpty
      v-else-if="rows.length === 0 && hasActiveAttendanceAllFilters(filters)"
      :description="$t('attendance-all.empty-filtered')"
    />
    <ElEmpty v-else-if="rows.length === 0" :description="$t('attendance-all.empty')" />
    <div v-else>
      <AttendanceAllTable class="mt-2" :rows="rows" />
      <ElPagination
        class="mt-4 justify-end"
        layout="total, prev, pager, next"
        :total="totalCount"
        :page-size="ATTENDANCE_ALL_PER_PAGE"
        :current-page="currentPage"
        @current-change="onPageChanged"
      />
    </div>
  </AppShell>
</template>
