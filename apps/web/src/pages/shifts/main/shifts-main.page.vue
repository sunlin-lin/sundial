<script setup lang="ts">
/**
 * 班別設定（計畫 04、docs/ui/22-ui-shift-settings.md，已定案）。
 *
 * 班別定義「一天怎麼上班」——幾點到幾點、休息幾段、有薪還無薪、跨不跨日、應工作幾分鐘。
 * 與「誰上這個班」（排班）完全無關，計畫 §2 已經說明排班那一層做不起來的理由。
 *
 * **對話框自己擁有送出流程**（`ShiftFormDialog`／`ShiftCopyDialog`），本頁只決定「開不開、開哪一筆」
 * ＋ 列表的查詢／篩選／分頁；刪除與啟用停用則在 `ShiftListTable` 內（那兩個只是「確認 → 打一支
 * 端點」，沒有表單）。三者共用同一個 `@changed`／`@saved` 之後的動作：重新載入清單。
 *
 * 呈現決策一律不在這裡：列怎麼組在 `.view.ts`，時段／休息在各自的 `.periods.view.ts`／
 * `.breaks.view.ts`，查詢與表單 payload 在 `.payload.ts`，動作可用性在 `.actions.ts`。
 */
import { computed, onMounted, ref } from 'vue'
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
  ElRadio,
  ElRadioGroup,
  ElSkeleton,
} from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import { shiftsMainList } from '../../../api/generated/api-client.ts'
import { isListEcho } from '../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import ShiftCopyDialog from './components/ShiftCopyDialog.vue'
import ShiftFormDialog from './components/ShiftFormDialog.vue'
import ShiftListTable from './components/ShiftListTable.vue'
import { canCreateShift } from './shifts-main.actions.ts'
import {
  defaultShiftListFilters,
  SHIFT_LIST_PER_PAGE,
  toShiftListQuery,
  type ShiftListFilters,
} from './shifts-main.payload.ts'
import { WORK_TYPE_CODES, toDisplayRows, workTypeLabel, type ShiftRow } from './shifts-main.view.ts'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()
const $t: TranslateMessage = t

const { isSigningOut, requestSignOut } = useSignOut(() => {
  auth.reset()
  void router.replace({ name: 'sessions-login' })
})

// --- 查詢條件與列表狀態（§2.1：清單留在元件內，換頁重來一次，不進 store） -------------

const filters = ref<ShiftListFilters>(defaultShiftListFilters())
const currentPage = ref(1)
const rows = ref<readonly ShiftRow[]>([])
const totalCount = ref(0)
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)

const displayRows = computed(() => toDisplayRows(rows.value, $t))

/**
 * 目前第幾次 `load()`。失敗的回應沒有回聲可比（錯誤路徑不帶 `search`／`sort`，見 §7.3），
 * 用一個遞增序號代替——比較「這次失敗的請求是不是最新那一次」，比拿條件物件互比更準確
 * （條件是新建的物件，`!==` 永遠成立，用值比對又要逐欄位列一次，序號兩行就夠）。
 */
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toShiftListQuery(filters.value, currentPage.value)

  isLoading.value = true
  failure.value = null

  shiftsMainList(query)
    .then((page) => {
      if (thisRequest !== requestSequence) return
      // §7.3：回聲不符就整包丟棄——仍有較新的請求在途中，關掉 loading 會讓畫面先閃一次舊資料。
      if (!isListEcho(page, query)) return
      rows.value = page.data
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

// --- 對話框：本頁只決定開不開、開哪一筆，送出流程在對話框元件裡 --------------------------

const formDialogOpen = ref(false)
const formDialogShiftId = ref<string | null>(null)

const openCreateDialog = (): void => {
  formDialogShiftId.value = null
  formDialogOpen.value = true
}

const onEditRequested = (id: string): void => {
  formDialogShiftId.value = id
  formDialogOpen.value = true
}

const copyDialogOpen = ref(false)
const copySource = ref<{ id: string; code: string; name: string } | null>(null)

const onCopyRequested = (source: { id: string; code: string; name: string }): void => {
  copySource.value = source
  copyDialogOpen.value = true
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
        <h1 class="text-xl font-semibold text-ink">{{ $t('shifts-main.heading') }}</h1>
        <p class="mt-1 text-sm text-ink-muted">{{ $t('shifts-main.description') }}</p>
      </div>
      <ElButton v-if="canCreateShift(auth.can)" type="primary" @click="openCreateDialog">
        {{ $t('shifts-main.action.create') }}
      </ElButton>
    </div>

    <ElForm class="mt-6" :inline="true" @submit.prevent>
      <ElFormItem :label="$t('shifts-main.filter.keyword')">
        <ElInput
          v-model="filters.keyword"
          :placeholder="$t('shifts-main.filter.keyword-placeholder')"
          clearable
          @change="onFilterChanged"
        />
      </ElFormItem>
      <!--
        四組都用 ElRadioGroup／ElRadio，不是 ElSelect／ElOption：後者在本專案的
        exactOptionalPropertyTypes 底下與 vue-tsc／Element Plus 目前版本不相容
        （理由見 components/ShiftWorkPeriodsEditor.vue 檔頭），ElRadio 已由 regulatory-sync
        頁證明可用。選項數都不多（4／3／3），border 版本不比下拉選單佔用更多版面。
      -->
      <ElFormItem :label="$t('shifts-main.filter.work-type')">
        <ElRadioGroup v-model="filters.workTypeCode" @change="onFilterChanged">
          <ElRadio :value="0" :border="true">{{ $t('shifts-main.filter.all') }}</ElRadio>
          <ElRadio v-for="code in WORK_TYPE_CODES" :key="code" :value="code" :border="true">
            {{ workTypeLabel(code, $t) }}
          </ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem :label="$t('shifts-main.filter.overnight')">
        <ElRadioGroup v-model="filters.overnight" @change="onFilterChanged">
          <ElRadio value="all" :border="true">{{ $t('shifts-main.filter.all') }}</ElRadio>
          <ElRadio value="yes" :border="true">{{ $t('shifts-main.filter.yes') }}</ElRadio>
          <ElRadio value="no" :border="true">{{ $t('shifts-main.filter.no') }}</ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem :label="$t('shifts-main.filter.flexible')">
        <ElRadioGroup v-model="filters.flexible" @change="onFilterChanged">
          <ElRadio value="all" :border="true">{{ $t('shifts-main.filter.all') }}</ElRadio>
          <ElRadio value="yes" :border="true">{{ $t('shifts-main.filter.yes') }}</ElRadio>
          <ElRadio value="no" :border="true">{{ $t('shifts-main.filter.no') }}</ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem :label="$t('shifts-main.filter.status')">
        <ElRadioGroup v-model="filters.status" @change="onFilterChanged">
          <ElRadio value="active" :border="true">{{ $t('shifts-main.filter.status-active') }}</ElRadio>
          <ElRadio value="inactive" :border="true">{{ $t('shifts-main.filter.status-inactive') }}</ElRadio>
          <ElRadio value="all" :border="true">{{ $t('shifts-main.filter.all') }}</ElRadio>
        </ElRadioGroup>
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
      <ElButton class="mt-4" :loading="isLoading" @click="retry">{{ $t('shifts-main.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" class="mt-4" :rows="6" animated />
    <ElEmpty v-else-if="displayRows.length === 0" :description="$t('shifts-main.empty')" />
    <div v-else>
      <ShiftListTable
        class="mt-2"
        :rows="displayRows"
        :can="auth.can"
        @edit-requested="onEditRequested"
        @copy-requested="onCopyRequested"
        @changed="load"
      />
      <ElPagination
        class="mt-4 justify-end"
        layout="total, prev, pager, next"
        :total="totalCount"
        :page-size="SHIFT_LIST_PER_PAGE"
        :current-page="currentPage"
        @current-change="onPageChanged"
      />
    </div>

    <ShiftFormDialog v-model:open="formDialogOpen" :shift-id="formDialogShiftId" @saved="load" />
    <ShiftCopyDialog v-model:open="copyDialogOpen" :source="copySource" @saved="load" />
  </AppShell>
</template>
