<script setup lang="ts">
/**
 * 我的出勤（計畫 06 §5 Stage 7；UI 定案 `docs/ui/12-ui-my-attendance.md`，已由使用者確認，
 * 照該文件實作，不重新設計畫面）。
 *
 * 範圍固定為呼叫者本人（`attendance/results/list-own`，body 不含 `employeeId`）——後端依登入身分
 * 解出員工，前端不提供、也不能提供任何指定他人的方式（UI 12「權限與安全」）。
 *
 * **年月查詢／當月出勤統計／出勤紀錄列表三段共用同一批資料**：UI 12「頁面順序」把統計排在列表
 * 之前，但兩者是同一次 `list-own` 查詢的兩種呈現（統計是列表的彙總），因此本頁只打一次 API，
 * 統計與列表都從同一份 `rows` 算出來，不是各自查詢一次。
 *
 * **本輪未實作「明細查看」**（UI 12 §「明細查看」）：那一段需要「今日班別」「當日全部原始打卡」
 * 「已撤銷打卡與撤銷原因」等欄位，但本輪可用的端點只有 `attendance/results/list-own`（判定結果的
 * 列表），沒有對應的單日明細端點可以查到這些欄位——已在任務回報中列為後端端點缺口。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElDatePicker, ElEmpty, ElForm, ElFormItem, ElSkeleton } from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import { attendanceResultsListOwn } from '../../../api/generated/api-client.ts'
import { isListEcho } from '../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import AttendanceMineStats from './components/AttendanceMineStats.vue'
import AttendanceMineTable from './components/AttendanceMineTable.vue'
import {
  defaultAttendanceMineFilters,
  toAttendanceMineListQuery,
  type AttendanceMineFilters,
} from './attendance-mine.payload.ts'
import { summarizeAttendanceMineMonth, toAttendanceMineStatsDisplay } from './attendance-mine.stats.view.ts'
import { toDisplayRows, type AttendanceMineDisplayRow, type AttendanceMineListItem } from './attendance-mine.view.ts'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()
const $t: TranslateMessage = t

const { isSigningOut, requestSignOut } = useSignOut(() => {
  auth.reset()
  void router.replace({ name: 'sessions-login' })
})

// --- 查詢條件與資料狀態（§2.1：清單留在元件內，換月重來一次，不進 store） -------------------
const filters = ref<AttendanceMineFilters>(defaultAttendanceMineFilters())
const items = ref<readonly AttendanceMineListItem[]>([])
const rows = ref<readonly AttendanceMineDisplayRow[]>([])
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)

/** 統計卡片由同一批 `items` 彙總而來（見檔頭），不是另一次查詢。 */
const statCards = computed(() => toAttendanceMineStatsDisplay(summarizeAttendanceMineMonth(items.value), $t))

/** 目前第幾次 `load()`：失敗的回應沒有回聲可比，用遞增序號代替（`shifts-main.page.vue` 同構）。 */
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toAttendanceMineListQuery(filters.value)

  isLoading.value = true
  failure.value = null

  attendanceResultsListOwn(query)
    .then((page) => {
      if (thisRequest !== requestSequence) return
      // §7.3：回聲不符就整包丟棄。
      if (!isListEcho(page, query)) return
      items.value = page.data
      rows.value = toDisplayRows(page.data, $t)
      isLoading.value = false
    })
    .catch((error: unknown) => {
      if (thisRequest !== requestSequence) return
      items.value = []
      rows.value = []
      failure.value = toLoadFailure(error)
      isLoading.value = false
    })
}

const retry = (): void => {
  load()
}

/** 切換年月：UI 12「切換年月後重新載入該月統計與明細」。 */
const onYearMonthChanged = (): void => {
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
      <h1 class="text-xl font-semibold text-ink">{{ $t('attendance-mine.heading') }}</h1>
      <p class="mt-1 text-sm text-ink-muted">{{ $t('attendance-mine.description') }}</p>
    </div>

    <ElForm :inline="true" class="mt-6" @submit.prevent>
      <ElFormItem :label="$t('attendance-mine.filter.year-month')">
        <ElDatePicker
          v-model="filters.yearMonth"
          type="month"
          value-format="YYYY-MM"
          :clearable="false"
          :disabled="isLoading"
          @change="onYearMonthChanged"
        />
      </ElFormItem>
    </ElForm>

    <!-- §7.2 的四態：載入失敗／載入中／空結果／有資料 -->
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
      <ElButton class="mt-4" :loading="isLoading" @click="retry">{{ $t('attendance-mine.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" class="mt-4" :rows="6" animated />
    <ElEmpty v-else-if="rows.length === 0" class="mt-4" :description="$t('attendance-mine.empty')" />
    <div v-else>
      <AttendanceMineStats class="mt-6" :cards="statCards" />
      <AttendanceMineTable class="mt-6" :rows="rows" />
    </div>
  </AppShell>
</template>
