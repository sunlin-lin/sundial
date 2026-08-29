<script setup lang="ts">
/**
 * 「今日打卡」卡片（本頁私有子元件，§1.5；UI 定案 10）。
 *
 * 三件事都在這裡：狀態顯示、上班／下班打卡（含 GPS）、撤銷觸發（實際送出在
 * `AttendanceRevokeDialog.vue`）。這是本頁唯一會呼叫 `attendanceRecordsCreate` 的地方，
 * 直接呼叫、不透過頁面轉發——與 `ShiftListTable.vue` 的既有慣例相同：確認／打一支端點／
 * 通知重新整理，沒有表單欄位需要標紅時，繞一圈到 `.page.vue` 只是多一層轉發。
 *
 * **今日狀態現在在頁面載入時就查得到，不再只在本次瀏覽階段內可靠**：`initialPunches`／
 * `isLoadingPunches`／`punchesFailure` 由 `.page.vue` 呼叫 `attendanceRecordsListOwnByDate`
 * 載入（理由與 `settings` 三個 props 相同——那支查詢與出勤設定一樣是「這張卡片能不能正確運作」
 * 的前提資料，載入方式因此比照既有的 `settings` 三件套，不是本元件另開一組不相干的 loading／
 * error 狀態，見 `dashboard-main.view.ts` 檔頭）。`initialPunches` 只在載入完成時同步進本地的
 * `punches`；使用者在本次瀏覽中打卡或撤銷之後，`punches` 由 {@link punch}／{@link onRevoked}
 * 就地更新，不會被稍後才 resolve 的初始載入蓋回去（`watch` 只在 `initialPunches` 這個 prop
 * 本身改變時觸發，而它只在 `.page.vue` 的載入或重試完成時才會換一個新物件）。
 *
 * **GPS 權限被拒的處理**：{@link resolveCoordinates} 一律先嘗試 `navigator.geolocation`；
 * 拒絕或逾時時，`gps_required=false`（含公司從未設定過出勤設定的情況）仍照常送出打卡
 * （座標留空），只有 `gps_required=true` 才擋下並顯示引導使用者去瀏覽器設定的訊息——
 * 瀏覽器的定位權限一旦被拒絕就不會再跳出詢問視窗，訊息因此不能只說「無法取得定位」，
 * 必須明講要去哪裡改。另外用 `navigator.permissions.query` 盡量提前偵測「已被封鎖」的狀態，
 * 顯示成一則常駐提示，而不是等使用者按下打卡才第一次告訴他。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElEmpty, ElMessage, ElSkeleton, ElTooltip } from 'element-plus'
import { attendanceRecordsCreate, type AttendanceSettingsGetData } from '../../../../api/generated/api-client.ts'
import type { LoadFailure } from '../../../../shared/api/load-failure.ts'
import { nowInTaipei } from '../../../../shared/format/business-clock.ts'
import { useAuthStore } from '../../../../stores/auth.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import {
  canClockIn,
  canClockOut,
  canRevokeClockIn,
  canRevokeClockOut,
  shouldDisableClockInRevokeForClockOut,
} from '../dashboard-main.actions.ts'
import { toGeneralFailureMessage } from '../dashboard-main.errors.view.ts'
import {
  ATTENDANCE_TYPE_CLOCK_IN,
  ATTENDANCE_TYPE_CLOCK_OUT,
  clockTimeDisplay,
  deriveTodayStatus,
  emptyTodayPunches,
  todayStatusLabel,
  workedHoursDisplay,
  workedMinutes,
  type AttendanceRecordDetail,
  type TodayPunchRecord,
  type TodayPunches,
} from '../dashboard-main.view.ts'
import AttendanceRevokeDialog from './AttendanceRevokeDialog.vue'

const { t } = useI18n()
const $t: TranslateMessage = t
const auth = useAuthStore()

const props = defineProps<{
  settings: AttendanceSettingsGetData | null
  isLoadingSettings: boolean
  settingsFailure: LoadFailure | null
  /** `attendanceRecordsListOwnByDate` 載入完成時的今日打卡狀態；載入中或失敗時是 `emptyTodayPunches()`。 */
  initialPunches: TodayPunches
  isLoadingPunches: boolean
  punchesFailure: LoadFailure | null
}>()
const emit = defineEmits<{ retry: [] }>()

// --- 沒有設定列時的預設值 --------------------------------------------------------------
// `gpsRequired`／`requireClockInBeforeClockOut` 的預設值逐字比對後端 `attendance-records.
// create.service.ts`（「字典本次需求為 true」「本次定案為 false」）。`gpsEnabled`／
// `allowEmployeeCancellation` 兩者字典沒有寫預設值，這裡採寬鬆預設（都當作開啟）——
// 反正 `gpsRequired=false` 時就算嘗試定位失敗也不影響能否打卡，`allowEmployeeCancellation`
// 目前後端 `revoke` 服務本身也還沒有真的檢查這個開關（見本模組回報），寬鬆預設不會讓畫面
// 允許一個後端會拒絕的動作。
const gpsEnabled = computed(() => props.settings?.gpsEnabled ?? true)
const gpsRequired = computed(() => props.settings?.gpsRequired ?? false)
const allowEmployeeCancellation = computed(() => props.settings?.allowEmployeeCancellation ?? true)

// --- 今日打卡狀態：載入時由 `initialPunches` 帶入，之後本次瀏覽中的打卡／撤銷就地更新 ------
const punches = ref<TodayPunches>(emptyTodayPunches())
watch(
  () => props.initialPunches,
  (next) => {
    punches.value = next
  },
  { immediate: true },
)
const status = computed(() => deriveTodayStatus(punches.value))
const statusText = computed(() => todayStatusLabel(status.value, $t))
const clockInTimeText = computed(() => clockTimeDisplay(punches.value.clockIn))
const clockOutTimeText = computed(() => clockTimeDisplay(punches.value.clockOut))
const workedHoursText = computed(() => workedHoursDisplay(workedMinutes(punches.value), $t))

const isPunching = ref(false)

const clockInAvailable = computed(() =>
  canClockIn({ status: status.value, isSubmitting: isPunching.value, can: auth.can }),
)
const clockOutAvailable = computed(() =>
  canClockOut({ status: status.value, isSubmitting: isPunching.value, can: auth.can }),
)
const revokeClockOutAvailable = computed(() =>
  canRevokeClockOut({
    status: status.value,
    allowEmployeeCancellation: allowEmployeeCancellation.value,
    isSubmitting: isPunching.value,
    can: auth.can,
  }),
)
const revokeClockInAvailable = computed(() =>
  canRevokeClockIn({
    status: status.value,
    allowEmployeeCancellation: allowEmployeeCancellation.value,
    isSubmitting: isPunching.value,
    can: auth.can,
  }),
)
/** 有權限、有設定允許，但目前狀態是「已下班」——停用＋原因，不是隱藏（前端規範 §3.3）。 */
const revokeClockInDisabledByClockOut = computed(
  () =>
    auth.can('attendance.records.revoke') &&
    allowEmployeeCancellation.value &&
    shouldDisableClockInRevokeForClockOut(status.value),
)

const showCompletedEmpty = computed(() => status.value === 'clocked-out')

// --- 現在時刻（UI 定案 10：顯示目前日期與時間） -----------------------------------------
const now = ref(nowInTaipei())
let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = nowInTaipei()
  }, 1000)
})
onUnmounted(() => {
  if (clockTimer !== null) clearInterval(clockTimer)
})

// --- GPS：權限偵測與座標取得 -------------------------------------------------------------
type GeolocationOutcome =
  | {
      readonly kind: 'success'
      readonly latitude: number
      readonly longitude: number
      readonly accuracyMeters: number
    }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }

const GEOLOCATION_TIMEOUT_MS = 8000

/** 定位權限目前是否已被封鎖——盡量提前知道，而不是等使用者按下打卡才第一次發現。
 * `navigator.permissions` 並非所有瀏覽器都支援對 `'geolocation'` 查詢，查不到就安靜略過
 * （使用者按下打卡時仍會走 {@link requestGeolocation} 的失敗路徑，看到同一段引導文字）。 */
const geoPermissionBlocked = ref(false)

onMounted(() => {
  if (!('permissions' in navigator)) return
  navigator.permissions
    .query({ name: 'geolocation' })
    .then((status) => {
      geoPermissionBlocked.value = status.state === 'denied'
      status.onchange = () => {
        geoPermissionBlocked.value = status.state === 'denied'
      }
    })
    .catch(() => {
      // 部分瀏覽器不支援這個查詢，安靜略過（見上）。
    })
})

const requestGeolocation = (): Promise<GeolocationOutcome> =>
  new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ kind: 'unavailable' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          kind: 'success',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Math.round(position.coords.accuracy),
        })
      },
      (error) => {
        resolve(error.code === error.PERMISSION_DENIED ? { kind: 'denied' } : { kind: 'unavailable' })
      },
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 },
    )
  })

type PunchCoordinates = {
  readonly latitude: number | null
  readonly longitude: number | null
  readonly accuracyMeters: number | null
}

/** `'blocked'`：`gps_required=true` 但拿不到座標，呼叫端不應該送出打卡（已顯示錯誤訊息）。 */
const resolveCoordinates = async (): Promise<PunchCoordinates | 'blocked'> => {
  if (!gpsEnabled.value) return { latitude: null, longitude: null, accuracyMeters: null }

  const outcome = await requestGeolocation()
  if (outcome.kind === 'success') {
    return { latitude: outcome.latitude, longitude: outcome.longitude, accuracyMeters: outcome.accuracyMeters }
  }

  // gps_required=false：拒絕授權或拿不到定位都不得擋下打卡（任務規則），座標留空即可。
  if (!gpsRequired.value) return { latitude: null, longitude: null, accuracyMeters: null }

  ElMessage.error(
    $t(
      outcome.kind === 'denied'
        ? 'dashboard.attendance.gps.denied-required'
        : 'dashboard.attendance.gps.unavailable-required',
    ),
  )
  return 'blocked'
}

// --- 打卡 -----------------------------------------------------------------------------
const punch = async (
  attendanceTypeCode: typeof ATTENDANCE_TYPE_CLOCK_IN | typeof ATTENDANCE_TYPE_CLOCK_OUT,
): Promise<void> => {
  isPunching.value = true
  try {
    const coordinates = await resolveCoordinates()
    if (coordinates === 'blocked') return

    const detail = await attendanceRecordsCreate({
      attendanceTypeCode,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      accuracyMeters: coordinates.accuracyMeters,
    })

    if (attendanceTypeCode === ATTENDANCE_TYPE_CLOCK_IN) {
      punches.value = { ...punches.value, clockIn: detail }
      ElMessage.success($t('dashboard.attendance.toast.clocked-in'))
    } else {
      punches.value = { ...punches.value, clockOut: detail }
      ElMessage.success($t('dashboard.attendance.toast.clocked-out'))
    }
  } catch (error: unknown) {
    ElMessage.error(toGeneralFailureMessage(error, $t))
  } finally {
    isPunching.value = false
  }
}

const onClockIn = (): void => {
  if (!clockInAvailable.value) return
  void punch(ATTENDANCE_TYPE_CLOCK_IN)
}

const onClockOut = (): void => {
  if (!clockOutAvailable.value) return
  void punch(ATTENDANCE_TYPE_CLOCK_OUT)
}

// --- 撤銷：本卡片只決定「撤銷哪一筆」，送出流程在 AttendanceRevokeDialog.vue ---------------
const revokeTarget = ref<TodayPunchRecord | null>(null)
const revokeKind = ref<'clock-in' | 'clock-out'>('clock-in')

const onRequestRevokeClockIn = (): void => {
  if (punches.value.clockIn === null) return
  revokeKind.value = 'clock-in'
  revokeTarget.value = punches.value.clockIn
}

const onRequestRevokeClockOut = (): void => {
  if (punches.value.clockOut === null) return
  revokeKind.value = 'clock-out'
  revokeTarget.value = punches.value.clockOut
}

const onRevoked = (detail: AttendanceRecordDetail): void => {
  if (revokeKind.value === 'clock-in') {
    punches.value = { ...punches.value, clockIn: null }
  } else {
    punches.value = { ...punches.value, clockOut: null }
  }
  // `detail` 是後端回的撤銷後明細（含 `revokedAt` 等欄位），這裡不需要它——狀態機只在乎
  // 「這張卡不再有效」，撤銷細節不上這張卡片（UI 10 沒有要求撤銷後顯示撤銷紀錄本身）。
  void detail
}
</script>

<template>
  <section class="rounded-panel bg-surface p-6 shadow-panel">
    <div class="flex items-baseline justify-between">
      <h2 class="text-lg font-semibold text-ink">{{ $t('dashboard.attendance.heading') }}</h2>
      <span class="text-sm text-ink-muted">{{ now }}</span>
    </div>

    <ElAlert
      v-if="settingsFailure?.kind === 'permission-denied'"
      class="mt-4"
      type="error"
      show-icon
      :closable="false"
      :title="settingsFailure.message"
    />
    <div v-else-if="settingsFailure !== null" class="mt-4">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-3" @click="emit('retry')">{{ $t('dashboard.attendance.retry') }}</ElButton>
    </div>
    <!--
      今日打卡狀態的載入失敗／載入中比照上面 `settings` 的分支（見檔頭：兩者是同一張卡片
      能不能正確運作的前提資料，不是兩組互不相干的狀態）。`isLoadingSettings` 已經在上面擋掉，
      這裡只需要再判斷 `punches` 這一組。
    -->
    <ElAlert
      v-else-if="punchesFailure?.kind === 'permission-denied'"
      class="mt-4"
      type="error"
      show-icon
      :closable="false"
      :title="punchesFailure.message"
    />
    <div v-else-if="punchesFailure !== null" class="mt-4">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-3" @click="emit('retry')">{{ $t('dashboard.attendance.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoadingSettings || isLoadingPunches" class="mt-4" :rows="3" animated />
    <div v-else>
      <ElAlert
        v-if="gpsRequired && geoPermissionBlocked"
        class="mt-4"
        type="warning"
        show-icon
        :closable="false"
        :title="$t('dashboard.attendance.gps.denied-required')"
      />

      <p class="mt-4 text-2xl font-semibold text-ink">{{ statusText }}</p>

      <dl class="mt-3 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-ink-muted">{{ $t('dashboard.attendance.field.clock-in-at') }}</dt>
          <dd class="mt-1 flex items-center gap-2 text-ink">
            <span>{{ clockInTimeText }}</span>
            <ElButton v-if="revokeClockInAvailable" link type="danger" size="small" @click="onRequestRevokeClockIn">
              {{ $t('dashboard.attendance.action.revoke') }}
            </ElButton>
            <ElTooltip
              v-else-if="revokeClockInDisabledByClockOut"
              :content="$t('dashboard.attendance.revoke.hint.clock-out-first')"
            >
              <span>
                <ElButton link type="danger" size="small" disabled>{{
                  $t('dashboard.attendance.action.revoke')
                }}</ElButton>
              </span>
            </ElTooltip>
          </dd>
        </div>
        <div>
          <dt class="text-ink-muted">{{ $t('dashboard.attendance.field.clock-out-at') }}</dt>
          <dd class="mt-1 flex items-center gap-2 text-ink">
            <span>{{ clockOutTimeText }}</span>
            <ElButton v-if="revokeClockOutAvailable" link type="danger" size="small" @click="onRequestRevokeClockOut">
              {{ $t('dashboard.attendance.action.revoke') }}
            </ElButton>
          </dd>
        </div>
      </dl>

      <p v-if="status === 'clocked-out'" class="mt-3 text-sm text-ink-muted">
        {{ $t('dashboard.attendance.field.worked-hours') }}：{{ workedHoursText }}
      </p>

      <ElEmpty v-if="showCompletedEmpty" class="mt-2" :description="$t('dashboard.attendance.completed')" />

      <div v-else class="mt-4 flex gap-3">
        <ElButton
          v-if="status === 'not-started'"
          type="primary"
          :loading="isPunching"
          :disabled="!clockInAvailable"
          @click="onClockIn"
        >
          {{ $t('dashboard.attendance.action.clock-in') }}
        </ElButton>
        <ElButton
          v-if="status === 'clocked-in'"
          type="primary"
          :loading="isPunching"
          :disabled="!clockOutAvailable"
          @click="onClockOut"
        >
          {{ $t('dashboard.attendance.action.clock-out') }}
        </ElButton>
      </div>
    </div>

    <AttendanceRevokeDialog
      :record="revokeTarget"
      :kind="revokeKind"
      @close="revokeTarget = null"
      @revoked="onRevoked"
    />
  </section>
</template>
