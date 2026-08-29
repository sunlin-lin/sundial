<script setup lang="ts">
/**
 * 打卡明細對話框（本頁私有子元件，§1.5；UI 23「明細」「座標顯示規則」）。
 *
 * **自己呼叫 `get` 載入明細**，比照 `ShiftFormDialog.vue` 的既有形狀（開啟時載入、載入中顯示
 * 骨架、失敗顯示錯誤，`.page.vue` 只決定「開不開、開哪一筆」）。
 *
 * **`employeeName`／`departmentName` 兩欄由呼叫端傳進來，不是 `get` 回應的欄位**：`get` 回應
 * 只多座標與撤銷資訊，員工姓名與部門在列表 JOIN 時已經查過一次，呼叫端（觸發明細的那一列）
 * 手上已經有這兩個字串，見 `attendance-daily-records.view.ts` 的 `toDetailDisplay` 檔頭。
 *
 * **座標三種狀態的畫面在這裡分支**（計畫 §4.2、UI 23）：`deriveCoordinateDisplayState` 已經把
 * 「有沒有權限看」與「這筆有沒有 GPS」兩層判斷算完，這裡只負責把三種狀態各自對應到不同文字。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElDescriptions, ElDescriptionsItem, ElDialog, ElSkeleton } from 'element-plus'
import { attendanceRecordsGet } from '../../../../api/generated/api-client.ts'
import { toLoadFailure, type LoadFailure } from '../../../../shared/api/load-failure.ts'
import { EMPTY_DISPLAY } from '../../../../shared/format/empty-display.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { toDetailDisplay, type AttendanceDailyRecordDetailDisplay } from '../attendance-daily-records.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

/** `target` 是「要看哪一筆」＋「那一列已經知道的員工姓名與部門」；`null` 代表沒有開啟
 * （比照 `AttendanceRevokeDialog.vue` 用資料本身兼職開關旗標的既有寫法，不另外維護布林）。 */
const props = defineProps<{
  target: { readonly id: string; readonly employeeName: string; readonly departmentName: string } | null
}>()
const emit = defineEmits<{ close: [] }>()

const isOpen = computed(() => props.target !== null)
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)
const notFound = ref(false)
const detail = ref<AttendanceDailyRecordDetailDisplay | null>(null)

watch(
  () => props.target,
  (target) => {
    if (target === null) return

    isLoading.value = true
    failure.value = null
    notFound.value = false
    detail.value = null

    attendanceRecordsGet({ recordId: target.id })
      .then((data) => {
        if (data === null) {
          notFound.value = true
          return
        }
        detail.value = toDetailDisplay(data, target, $t)
      })
      .catch((error: unknown) => {
        failure.value = toLoadFailure(error)
      })
      .finally(() => {
        isLoading.value = false
      })
  },
)

const onClose = (): void => {
  emit('close')
}
</script>

<template>
  <ElDialog
    :model-value="isOpen"
    :title="$t('attendance-daily-records.detail.title')"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="onClose"
  >
    <ElSkeleton v-if="isLoading" :rows="6" animated />
    <ElAlert
      v-else-if="failure?.kind === 'permission-denied'"
      type="error"
      show-icon
      :closable="false"
      :title="failure.message"
    />
    <ElAlert v-else-if="failure !== null" type="error" show-icon :closable="false" :title="$t('error.system')" />
    <ElAlert
      v-else-if="notFound"
      type="error"
      show-icon
      :closable="false"
      :title="$t('attendance-daily-records.detail.not-found')"
    />

    <ElDescriptions v-else-if="detail !== null" :column="2" border>
      <ElDescriptionsItem :label="$t('attendance-daily-records.column.employee-name')">
        {{ detail.employeeName }}
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('attendance-daily-records.column.department')">
        {{ detail.departmentName }}
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('attendance-daily-records.column.attendance-type')">
        {{ detail.attendanceTypeLabel }}
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('attendance-daily-records.column.source')">
        {{ detail.sourceLabel }}
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('attendance-daily-records.column.clocked-at')">
        {{ detail.clockedAtDisplay }}
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('attendance-daily-records.column.location')">
        {{ detail.locationDisplay }}
      </ElDescriptionsItem>

      <!--
        座標三種狀態，三種文字不得相同（UI 23）：有權限有 GPS 顯示數值；有權限沒 GPS 顯示
        「本筆未取得定位」；沒有權限顯示「無權限檢視座標」。
      -->
      <ElDescriptionsItem :label="$t('attendance-daily-records.detail.coordinates')" :span="2">
        <span v-if="detail.coordinates.kind === 'visible'">
          {{ detail.coordinates.latitude }}, {{ detail.coordinates.longitude }}
          <template v-if="detail.accuracyMetersDisplay !== EMPTY_DISPLAY">
            （{{ $t('attendance-daily-records.detail.accuracy-meters') }}：{{ detail.accuracyMetersDisplay }}
            {{ $t('attendance-daily-records.unit.meters') }}）
          </template>
        </span>
        <span v-else-if="detail.coordinates.kind === 'no-gps'">
          {{ $t('attendance-daily-records.detail.coordinates-no-gps') }}
        </span>
        <span v-else>{{ $t('attendance-daily-records.detail.coordinates-no-permission') }}</span>
      </ElDescriptionsItem>

      <template v-if="detail.isRevoked">
        <ElDescriptionsItem :label="$t('attendance-daily-records.detail.revoked-at')">
          {{ detail.revokedAtDisplay }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('attendance-daily-records.detail.revoked-by')">
          {{ detail.revokedByDisplay }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('attendance-daily-records.detail.revoke-reason')" :span="2">
          {{ detail.revokeReasonDisplay }}
        </ElDescriptionsItem>
      </template>
    </ElDescriptions>
  </ElDialog>
</template>
