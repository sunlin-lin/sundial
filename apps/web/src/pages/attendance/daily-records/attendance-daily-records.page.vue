<script setup lang="ts">
/**
 * 每日全員打卡明細（計畫 06 §4.7、Stage 6；UI 定案 `docs/ui/23-ui-daily-attendance-records.md`，
 * 已由使用者確認，照該文件實作，不重新設計畫面）。
 *
 * 看的是**原始事實**：某一天、全公司的 `attendance_records`，一位員工當天可能有多筆（多次進出、
 * 已撤銷的、來源各異）。與 09（全體出勤，尚未實作）分工不同——那一頁看的是判定結果，本頁不讀
 * `attendance_results`，也不顯示對應的判定狀態（UI 23「顯示規則」）。
 *
 * **本頁不做的（UI 23「本輪明確延後」）**：批次撤銷、地圖顯示座標、從本頁直接建立補打卡申請、
 * 匯出或列印、顯示 `attendance_results` 判定狀態。
 *
 * 部門樹（篩選用）在 `onMounted` 載入一次，**失敗時不擋住整頁**：與 `employees-onboarding` 的
 * 字典載入不同——這裡的部門樹只是篩選條件的選項來源，不是「沒有它整頁就不能用」（列表本身只靠
 * 日期就查得到，部門只是加選條件），載入失敗時篩選器就是一顆沒有選項的空下拉，不必連累整頁顯示
 * 錯誤畫面。
 *
 * 表格、明細對話框、撤銷對話框分別在 `components/` 底下——本檔只負責查詢／篩選／分頁的狀態，
 * 以及「開哪一個對話框、帶哪一筆資料」的決定（§1.2；與 `shifts-main.page.vue` 對
 * `ShiftFormDialog`／`ShiftCopyDialog` 的既有分工相同）。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElEmpty, ElPagination, ElSkeleton } from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import { attendanceRecordsListByDate, departmentsMainTree } from '../../../api/generated/api-client.ts'
import { isListEcho } from '../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import AttendanceDailyRecordDetailDialog from './components/AttendanceDailyRecordDetailDialog.vue'
import AttendanceDailyRecordRevokeDialog from './components/AttendanceDailyRecordRevokeDialog.vue'
import AttendanceDailyRecordsFilters from './components/AttendanceDailyRecordsFilters.vue'
import AttendanceDailyRecordsTable from './components/AttendanceDailyRecordsTable.vue'
import {
  defaultAttendanceDailyRecordFilters,
  ATTENDANCE_DAILY_RECORD_PER_PAGE,
  toAttendanceDailyRecordListQuery,
  type AttendanceDailyRecordFilters,
} from './attendance-daily-records.payload.ts'
import {
  toDisplayRows,
  type AttendanceDailyRecordDisplayRow,
  type DepartmentTreeNode,
} from './attendance-daily-records.view.ts'

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
const filters = ref<AttendanceDailyRecordFilters>(defaultAttendanceDailyRecordFilters())
const currentPage = ref(1)
const rows = ref<readonly AttendanceDailyRecordDisplayRow[]>([])
const totalCount = ref(0)
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)

/** 目前第幾次 `load()`：失敗的回應沒有回聲可比，用遞增序號代替（`shifts-main.page.vue` 同構）。 */
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toAttendanceDailyRecordListQuery(filters.value, currentPage.value)

  isLoading.value = true
  failure.value = null

  attendanceRecordsListByDate(query)
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

// --- 明細對話框：本頁只決定開哪一筆，載入與顯示在對話框元件裡 -----------------------------
const detailTarget = ref<{ id: string; employeeName: string; departmentName: string } | null>(null)

const onDetailRequested = (id: string): void => {
  const row = rows.value.find((candidate) => candidate.id === id)
  if (row === undefined) return
  detailTarget.value = { id: row.id, employeeName: row.employeeName, departmentName: row.departmentName }
}

// --- 撤銷對話框：本頁只決定撤銷哪一列，送出流程在對話框元件裡 -----------------------------
const revokeTarget = ref<AttendanceDailyRecordDisplayRow | null>(null)

const onRevokeRequested = (id: string): void => {
  const row = rows.value.find((candidate) => candidate.id === id)
  if (row === undefined) return
  revokeTarget.value = row
}

/** 撤銷成功後重新載入整頁（同 `shifts-main.page.vue` 對 `@changed`／`@saved` 的既有處置）：
 * 這一列立即變成已撤銷（UI 23），重新查一次比手動合併單一列的欄位更不容易漏掉狀態欄以外
 * 的欄位（例如 `revokedAt`／`revokedBy` 若之後要顯示在列表上）。 */
const onRevoked = (): void => {
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
      <h1 class="text-xl font-semibold text-ink">{{ $t('attendance-daily-records.heading') }}</h1>
      <p class="mt-1 text-sm text-ink-muted">{{ $t('attendance-daily-records.description') }}</p>
    </div>

    <AttendanceDailyRecordsFilters
      v-model:date="filters.date"
      v-model:department-id="filters.departmentId"
      v-model:employee-id="filters.employeeId"
      v-model:status="filters.status"
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
      <ElButton class="mt-4" :loading="isLoading" @click="retry">{{ $t('attendance-daily-records.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" class="mt-4" :rows="6" animated />
    <ElEmpty v-else-if="rows.length === 0" :description="$t('attendance-daily-records.empty')" />
    <div v-else>
      <AttendanceDailyRecordsTable
        class="mt-2"
        :rows="rows"
        :can="auth.can"
        @detail-requested="onDetailRequested"
        @revoke-requested="onRevokeRequested"
      />
      <ElPagination
        class="mt-4 justify-end"
        layout="total, prev, pager, next"
        :total="totalCount"
        :page-size="ATTENDANCE_DAILY_RECORD_PER_PAGE"
        :current-page="currentPage"
        @current-change="onPageChanged"
      />
    </div>

    <AttendanceDailyRecordDetailDialog :target="detailTarget" @close="detailTarget = null" />
    <AttendanceDailyRecordRevokeDialog :target="revokeTarget" @close="revokeTarget = null" @revoked="onRevoked" />
  </AppShell>
</template>
