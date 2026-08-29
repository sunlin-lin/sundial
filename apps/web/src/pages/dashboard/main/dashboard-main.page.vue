<script setup lang="ts">
/**
 * Dashboard。需要登入才進得來（見同層的 `.route.ts` 與 router 的守衛）。
 *
 * 「登入者是誰、屬於哪一家公司」與「今日打卡」（計畫 06 Stage 5，UI 定案 10）並列在這一頁——
 * 前者是登入回應本身帶回來的，後者是這一頁真正的主要功能。**這裡刻意仍然沒有假的統計卡片**：
 * 畫不出真實數字的區塊會被當成「還沒載入」，而它永遠不會載入完；今日打卡是唯一已經有真實資料
 * 來源可以畫的區塊。
 *
 * 本頁負責載入 `AttendanceTodayCard` 需要的兩組前提資料（出勤設定＋今日打卡狀態）＋登入者資訊
 * ＋登出；打卡、撤銷、GPS 全部在 `components/AttendanceTodayCard.vue` 裡（§1.2：一個元件不該
 * 同時扛互不相干的 loading／error 狀態，因此兩組載入都在頁面層做，卡片只接收結果——見該檔檔頭）。
 *
 * **今日打卡狀態改用 `attendanceRecordsListOwnByDate` 查出來，不再只在本次瀏覽階段內可靠**
 * （計畫 06 Stage 5 缺口二）：重新整理頁面過去會讓狀態歸零、回到「尚未上班」，即使今天稍早已經
 * 打過卡；這支端點補上「查詢本人今天打卡記錄」的缺口後，頁面載入時就先查一次，狀態不再依賴
 * 本次瀏覽階段的累積。回應**含已撤銷的紀錄**，推導狀態時已在 `deriveTodayPunchesFromOwnList`
 * 濾掉 `revokedAt` 非 `null` 的那些（見 `dashboard-main.view.ts`）。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppShell from '../../../layouts/AppShell.vue'
import {
  attendanceRecordsListOwnByDate,
  attendanceSettingsGet,
  type AttendanceSettingsGetData,
} from '../../../api/generated/api-client.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import { todayInTaipei } from '../../../shared/format/business-clock.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import AttendanceTodayCard from './components/AttendanceTodayCard.vue'
import { deriveTodayPunchesFromOwnList, emptyTodayPunches, type TodayPunches } from './dashboard-main.view.ts'

const auth = useAuthStore()
const router = useRouter()

// 標註型別把 key 收窄回 `MessageKey`，並同時遮蔽掉套件的全域 `$t`（理由見語系檔的 `TranslateMessage`）。
const { t } = useI18n()
const $t: TranslateMessage = t

/**
 * 登出。
 *
 * 呼叫端點與 loading 狀態在 `shared/api/use-sign-out.ts`（三頁共用，§1.5）；
 * 留在這裡的只有「清 store、回登入頁」——那兩步碰得到 store 與 router，共用區進不去（§0.11），
 * 而「登出成功後去哪裡」本來就是頁面的決定。
 *
 * 不論後端怎麼回都會走到這個回呼：使用者按了登出就是要離開，
 * 把他因為一個錯誤留在已登入狀態，是他最不預期的結果。
 */
const { isSigningOut, requestSignOut } = useSignOut(() => {
  auth.reset()
  void router.replace({ name: 'sessions-login' })
})

// --- 出勤設定：`AttendanceTodayCard` 決定打卡／撤銷怎麼運作要用的三個開關 -------------------
const attendanceSettings = ref<AttendanceSettingsGetData | null>(null)
const isLoadingAttendanceSettings = ref(false)
const attendanceSettingsFailure = ref<LoadFailure | null>(null)

const loadAttendanceSettings = (): void => {
  isLoadingAttendanceSettings.value = true
  attendanceSettingsFailure.value = null

  attendanceSettingsGet({})
    .then((settings) => {
      attendanceSettings.value = settings
      isLoadingAttendanceSettings.value = false
    })
    .catch((error: unknown) => {
      attendanceSettings.value = null
      attendanceSettingsFailure.value = toLoadFailure(error)
      isLoadingAttendanceSettings.value = false
    })
}

/**
 * 今日打卡狀態（計畫 06 Stage 5 缺口二）。單頁最多 50 筆——這是查「一個人一天」的紀錄，
 * 即使多次進出、含已撤銷的，也遠遠到不了預設分頁上限（100），50 已經有充分餘裕，
 * 不需要再處理分頁（這一頁的情境本來就沒有「翻頁看今天」這種操作）。
 */
const TODAY_PUNCHES_PER_PAGE = 50

const todayPunches = ref<TodayPunches>(emptyTodayPunches())
const isLoadingTodayPunches = ref(false)
const todayPunchesFailure = ref<LoadFailure | null>(null)

const loadTodayPunches = (): void => {
  // 這一碼配給每一位一般員工的角色（見 `shared/permission/permission-code.ts` 的說明），
  // 這裡的判斷只是防禦性的：角色設定萬一漏配時，安靜地維持「尚未上班」，而不是讓呼叫必然
  // 吃一個 901、把「無權限」錯誤顯示成這張卡片一進來就整組失敗。
  if (!auth.can('attendance.records.list-own-by-date')) {
    todayPunches.value = emptyTodayPunches()
    isLoadingTodayPunches.value = false
    todayPunchesFailure.value = null
    return
  }

  isLoadingTodayPunches.value = true
  todayPunchesFailure.value = null

  attendanceRecordsListOwnByDate({ date: todayInTaipei(), currentPage: 1, perPage: TODAY_PUNCHES_PER_PAGE })
    .then((page) => {
      todayPunches.value = deriveTodayPunchesFromOwnList(page.data)
      isLoadingTodayPunches.value = false
    })
    .catch((error: unknown) => {
      todayPunches.value = emptyTodayPunches()
      todayPunchesFailure.value = toLoadFailure(error)
      isLoadingTodayPunches.value = false
    })
}

/** `AttendanceTodayCard` 的兩組前提資料共用同一顆重試鈕（見該檔檔頭）：兩者都失敗時各按一次
 * 太瑣碎，都重新載入一次的代價只是多打一支已經成功過的查詢，不是錯誤的行為。 */
const retryAttendanceCard = (): void => {
  loadAttendanceSettings()
  loadTodayPunches()
}

onMounted(() => {
  loadAttendanceSettings()
  loadTodayPunches()
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
    <h1 class="text-xl font-semibold text-ink">{{ $t('dashboard.heading') }}</h1>

    <dl class="mt-6 grid max-w-xl grid-cols-2 gap-4">
      <div class="rounded-panel bg-surface p-6 shadow-panel">
        <dt class="text-xs font-medium tracking-wide text-ink-muted">
          {{ $t('dashboard.signed-in-as') }}
        </dt>
        <dd class="mt-2 text-lg font-semibold text-ink">{{ auth.displayName }}</dd>
      </div>
      <div class="rounded-panel bg-surface p-6 shadow-panel">
        <dt class="text-xs font-medium tracking-wide text-ink-muted">
          {{ $t('dashboard.company') }}
        </dt>
        <dd class="mt-2 text-lg font-semibold text-ink">{{ auth.companyName }}</dd>
      </div>
    </dl>

    <AttendanceTodayCard
      class="mt-6 max-w-xl"
      :settings="attendanceSettings"
      :is-loading-settings="isLoadingAttendanceSettings"
      :settings-failure="attendanceSettingsFailure"
      :initial-punches="todayPunches"
      :is-loading-punches="isLoadingTodayPunches"
      :punches-failure="todayPunchesFailure"
      @retry="retryAttendanceCard"
    />
  </AppShell>
</template>
