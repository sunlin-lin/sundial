<script setup lang="ts">
/**
 * 法規資料集總覽（計畫 03 §4.1、§4.2、§5.3）。
 *
 * 三層，由上而下鑽進去：**總覽（九個資料集在基準日各是哪一版）→ 版本清單（這份法規有哪幾版）
 * → 版本內容（那一版實際的級距／費率／門檻）**。
 *
 * **唯讀，而且是刻意的（計畫 §2）**：沒有任何會改變後端狀態的按鈕，也不提供觸發同步。
 * 觸發由排程負責；人工觸發端點依決策 D3 不開放——觸發全平台同步不該由某一家公司的管理者做，
 * 而平台管理員這個角色還不存在。補充保險費率（`dataset_code=10`）是唯一人工維護的資料集，
 * 它的調整介面同樣屬於平台管理，本頁只讓人看出「這一項是人工維護的」。
 *
 * ## 不分公司，日後也不得加（計畫 §2.1）
 *
 * **畫面上沒有公司篩選，也不會因為登入者屬於哪一家公司而看到不同的內容。** 這與後端一致，
 * 不是前端自己的簡化：`regulatory_dataset_versions`／`regulatory_records`／`regulatory_sync_logs`
 * 三張表都沒有 `company_id`，都不在 `CompanyScopedTable` 裡。政府法規是全國一份。
 *
 * **日後不得加。** 看到列表就想加一個公司下拉是很自然的反射，而加下去之後那個條件會一路傳到
 * 後端，逼出一個「法規資料要不要分公司」的假問題。公司自己的選擇（用哪一個職災行業別）在
 * `company_regulatory_settings`，那是另一張表、另一個畫面。
 *
 * ## 基準日是必填的查詢條件，不是隱含的今天（計畫 §4.2）
 *
 * 這一頁最重要的一條。畫面上**必須有一個看得見的日期選擇器**，預設今天但不得是隱含的：
 * 薪資結算要補算去年 12 月時，人會來這一頁核對「當時的費率是多少」。少了這個概念，
 * 他看到的永遠是今天適用的那一版，而那一版跟他要核對的期間**看起來完全一樣合理**。
 *
 * 改基準日時：總覽重載（適用版本會變），**已展開的內容區收合**——那一區顯示的是舊基準日
 * 解析出來的版本，留著它會讓畫面上同時有兩個基準日的資料互相對不上。
 * 版本清單不收合也不重載：它與基準日無關（「有哪幾版」不隨日期改變），只有「本基準日適用」
 * 那個標記會跳到另一列，而那正是使用者需要看到的變化。
 *
 * ## 「看某一版的內容」為什麼會改動基準日
 *
 * 後端**沒有**「依版本 id 取內容」的端點：`get` 只回 metadata，records 只能從 `resolve` 拿，
 * 而 `resolve` 是依基準日挑版本。因此點「查看內容」＝把基準日設成那一版的生效日再解析一次。
 * 這不是繞路，它正好是 §4.2 想教會使用者的事：**內容永遠是「某一天適用的那一版」。**
 *
 * 呈現決策一律不在這裡（§1.3）：一列怎麼組在 `.view.ts` 與 `.version.view.ts`，
 * 內容的欄位定義在 `.columns.view.ts` 與 `.record.view.ts`，查詢組裝在 `.payload.ts`。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElDatePicker, ElEmpty, ElForm, ElFormItem, ElSkeleton } from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import {
  regulatoryDatasetsList,
  regulatoryDatasetsOverview,
  regulatoryDatasetsResolve,
} from '../../../api/generated/api-client.ts'
import { isListEcho } from '../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import { todayInTaipei } from '../../../shared/format/business-clock.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import DatasetOverviewTable from './components/DatasetOverviewTable.vue'
import DatasetRecordTable from './components/DatasetRecordTable.vue'
import DatasetVersionTable from './components/DatasetVersionTable.vue'
import LoadFailureAlert from './components/LoadFailureAlert.vue'
import { columnsFor } from './regulatory-datasets.columns.view.ts'
import { toOverviewQuery, toResolveQuery, toVersionListQuery, type DatasetCode } from './regulatory-datasets.payload.ts'
import type { ResolvedVersion } from './regulatory-datasets.record.view.ts'
import { toRecordDisplayRows } from './regulatory-datasets.record.view.ts'
import {
  datasetNameOf,
  effectiveVersionCodeOf,
  toOverviewDisplayRows,
  type OverviewRow,
} from './regulatory-datasets.view.ts'
import { toVersionDisplayRows, type VersionRow } from './regulatory-datasets.version.view.ts'

const auth = useAuthStore()
const router = useRouter()
// 標註型別把 key 收窄回 `MessageKey`，並同時遮蔽掉套件的全域 `$t`（理由見語系檔的 `TranslateMessage`）。
const { t } = useI18n()
const $t: TranslateMessage = t

/** 登出：呼叫端點與 loading 在共用區（§1.5），清 store 與導頁留在頁面（§0.11 進不去共用區）。 */
const { isSigningOut, requestSignOut } = useSignOut(() => {
  auth.reset()
  void router.replace({ name: 'sessions-login' })
})

// --- 狀態（§2.1：清單留在元件內，離開頁面即消失，不進 store） ------------------------

/** 基準日。預設今天，但**畫面上看得見、改得動**（計畫 §4.2）。 */
const asOfDate = ref(todayInTaipei())

// 存的是 API 的原始列而不是組好的顯示列：顯示列要靠「目前基準日適用哪一版」才算得出來，
// 而那件事在改基準日時會變。留著原始列，重算只是重跑一次純函式。
const overviewRows = ref<readonly OverviewRow[]>([])
const isOverviewLoading = ref(false)
const overviewFailure = ref<LoadFailure | null>(null)

const selectedDatasetCode = ref<DatasetCode | null>(null)
const versionRows = ref<readonly VersionRow[]>([])
const versionTotalCount = ref(0)
const versionCurrentPage = ref(1)
const isVersionLoading = ref(false)
const versionFailure = ref<LoadFailure | null>(null)

const resolved = ref<ResolvedVersion | null>(null)
/** 內容區是否展開。與 `resolved === null` 不同：那個基準日沒有適用版本時也要顯示「沒有」。 */
const isContentOpen = ref(false)
const isContentLoading = ref(false)
const contentFailure = ref<LoadFailure | null>(null)

// --- 衍生（全部是純函式，§1.3） -----------------------------------------------------

const overviewDisplayRows = computed(() => toOverviewDisplayRows(overviewRows.value, $t))

const selectedDatasetName = computed(() =>
  selectedDatasetCode.value === null ? '' : datasetNameOf(overviewRows.value, selectedDatasetCode.value),
)

const versionDisplayRows = computed(() =>
  toVersionDisplayRows(
    versionRows.value,
    selectedDatasetCode.value === null ? null : effectiveVersionCodeOf(overviewRows.value, selectedDatasetCode.value),
  ),
)

const recordColumns = computed(() => (resolved.value === null ? [] : columnsFor(resolved.value.datasetCode, $t)))

const recordDisplayRows = computed(() =>
  resolved.value === null ? [] : toRecordDisplayRows(recordColumns.value, resolved.value.records),
)

// --- 載入 ---------------------------------------------------------------------------

const loadOverview = (): void => {
  const query = toOverviewQuery(asOfDate.value)

  isOverviewLoading.value = true
  overviewFailure.value = null

  regulatoryDatasetsOverview(query)
    .then((rows) => {
      // 總覽沒有回聲欄位可比（它不是 §7.1 的分頁列表），只能拿條件本身擋舊回應：
      // 少了這一行，連點兩次日期選擇器時，先送出的那一包可能後到並蓋掉新的（§7.3 的同一個問題）。
      if (asOfDate.value !== query.asOfDate) return

      // **九列固定回傳**，即使某一列在該基準日沒有適用版本——這裡不做任何「查無資料」的判斷。
      overviewRows.value = rows
      isOverviewLoading.value = false
    })
    .catch((error: unknown) => {
      if (asOfDate.value !== query.asOfDate) return
      overviewRows.value = []
      overviewFailure.value = toLoadFailure(error)
      isOverviewLoading.value = false
    })
}

const loadVersions = (): void => {
  const datasetCode = selectedDatasetCode.value
  if (datasetCode === null) return
  const query = toVersionListQuery(datasetCode, versionCurrentPage.value)

  isVersionLoading.value = true
  versionFailure.value = null

  regulatoryDatasetsList(query)
    .then((page) => {
      // §7.3：回聲不符就**整包丟棄**——不寫 rows、不更新分頁、**也不關 loading**
      //（仍有較新的請求在途中，關掉會讓畫面先閃一次舊資料）。
      if (!isListEcho(page, query)) return

      versionRows.value = page.data
      versionTotalCount.value = page.pagination.totalCount
      isVersionLoading.value = false
    })
    .catch((error: unknown) => {
      // 失敗的回應沒有回聲可比（錯誤路徑不帶 `search`／`sort`），只能拿條件本身擋。
      if (selectedDatasetCode.value !== query.datasetCode) return

      versionRows.value = []
      versionTotalCount.value = 0
      versionFailure.value = toLoadFailure(error)
      isVersionLoading.value = false
    })
}

const loadContent = (): void => {
  const datasetCode = selectedDatasetCode.value
  if (datasetCode === null) return
  const query = toResolveQuery(datasetCode, asOfDate.value)

  isContentOpen.value = true
  isContentLoading.value = true
  contentFailure.value = null

  regulatoryDatasetsResolve(query)
    .then((detail) => {
      if (selectedDatasetCode.value !== query.datasetCode || asOfDate.value !== query.asOfDate) return

      // `null` = 那個基準日沒有適用版本。這是 `200` ＋ `data: null`，不是錯誤（§3.6）——
      // 走空狀態畫面，不走失敗畫面。
      resolved.value = detail
      isContentLoading.value = false
    })
    .catch((error: unknown) => {
      if (selectedDatasetCode.value !== query.datasetCode || asOfDate.value !== query.asOfDate) return

      resolved.value = null
      contentFailure.value = toLoadFailure(error)
      isContentLoading.value = false
    })
}

/** 收合內容區。改基準日與換資料集時都要做，理由見檔頭。 */
const closeContent = (): void => {
  isContentOpen.value = false
  resolved.value = null
  contentFailure.value = null
  isContentLoading.value = false
}

// --- 使用者動作 ---------------------------------------------------------------------

const onAsOfDateChanged = (): void => {
  closeContent()
  loadOverview()
}

const onVersionsRequested = (datasetCode: DatasetCode): void => {
  closeContent()

  // 再點一次同一列就收起來：這一頁一次只展開一個資料集，而「怎麼把它關掉」必須有答案。
  if (selectedDatasetCode.value === datasetCode) {
    selectedDatasetCode.value = null
    versionRows.value = []
    versionTotalCount.value = 0
    versionFailure.value = null
    return
  }

  selectedDatasetCode.value = datasetCode
  // 換資料集一律回到第 1 頁（§7.1）：停在第 5 頁而新資料集只有 2 頁，畫面會空白。
  versionCurrentPage.value = 1
  loadVersions()
}

const onVersionPageChanged = (page: number): void => {
  versionCurrentPage.value = page
  loadVersions()
}

/**
 * 「查看內容」：把基準日移到那一版的生效日，再解析一次。
 *
 * 生效日當天一定解析得到那一版（版本區間是左閉的），所以這個動作永遠打得開使用者點的那一版。
 * 總覽跟著重載，因為基準日變了——不重載的話，總覽上的「適用版本」會停在舊基準日，
 * 而下面的內容區顯示的是新基準日的結果，兩者對不上。
 */
const onVersionContentRequested = (versionCode: string): void => {
  const version = versionRows.value.find((row) => row.versionCode === versionCode)
  if (version === undefined) return

  asOfDate.value = version.effectiveFrom
  loadOverview()
  loadContent()
}

// 回呼不是 async，也沒有未處理的 promise：`loadOverview()` 內部自己收掉成功與失敗（§3.4）。
onMounted(() => {
  loadOverview()
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
    <h1 class="text-xl font-semibold text-ink">{{ $t('regulatory-datasets.heading') }}</h1>
    <p class="mt-1 text-sm text-ink-muted">{{ $t('regulatory-datasets.description') }}</p>

    <!--
      基準日：**必填、看得見、改得動**（計畫 §4.2）。
      `value-format` 釘死 `YYYY-MM-DD`，與後端的 `date` 欄位逐字相同（後端規範 §6.1）——
      少了它，元件會回一個 `Date` 物件，而那個物件一經序列化就會帶上時區偏移。
      `clearable=false`：這個條件沒有「不填」這個選項，清空之後整頁都算不出東西。
    -->
    <ElForm class="mt-6" @submit.prevent>
      <ElFormItem :label="$t('regulatory-datasets.filter.as-of-date')">
        <ElDatePicker
          v-model="asOfDate"
          type="date"
          value-format="YYYY-MM-DD"
          :clearable="false"
          :disabled="isOverviewLoading"
          @change="onAsOfDateChanged"
        />
        <span class="ml-3 text-sm text-ink-muted">
          {{ $t('regulatory-datasets.filter.as-of-date-hint') }}
        </span>
      </ElFormItem>
    </ElForm>

    <!-- 總覽（§7.2 的四態：載入失敗／載入中／空結果／有資料） -->
    <LoadFailureAlert
      v-if="overviewFailure !== null"
      :failure="overviewFailure"
      :is-retrying="isOverviewLoading"
      @retry="loadOverview"
    />
    <ElSkeleton v-else-if="isOverviewLoading" class="mt-2" :rows="6" animated />
    <ElEmpty v-else-if="overviewDisplayRows.length === 0" :description="$t('regulatory-datasets.empty')" />
    <DatasetOverviewTable
      v-else
      :rows="overviewDisplayRows"
      :selected-dataset-code="selectedDatasetCode"
      @versions-requested="onVersionsRequested"
    />

    <!-- 版本清單（展開一個資料集之後才出現） -->
    <section v-if="selectedDatasetCode !== null" class="mt-8">
      <h2 class="text-lg font-semibold text-ink">
        {{ $t('regulatory-datasets.versions-heading') }}｜{{ selectedDatasetName }}
      </h2>

      <LoadFailureAlert
        v-if="versionFailure !== null"
        class="mt-4"
        :failure="versionFailure"
        :is-retrying="isVersionLoading"
        @retry="loadVersions"
      />
      <ElSkeleton v-else-if="isVersionLoading" class="mt-2" :rows="4" animated />
      <ElEmpty v-else-if="versionDisplayRows.length === 0" :description="$t('regulatory-datasets.versions-empty')" />
      <DatasetVersionTable
        v-else
        class="mt-4"
        :rows="versionDisplayRows"
        :total-count="versionTotalCount"
        :current-page="versionCurrentPage"
        @page-changed="onVersionPageChanged"
        @content-requested="onVersionContentRequested"
      />
    </section>

    <!-- 版本內容（點了某一版的「查看內容」之後才出現） -->
    <section v-if="isContentOpen" class="mt-8">
      <h2 class="text-lg font-semibold text-ink">
        {{ $t('regulatory-datasets.content-heading') }}｜{{ selectedDatasetName }}
      </h2>
      <p class="mt-1 text-sm text-ink-muted">{{ $t('regulatory-datasets.content-as-of') }}{{ asOfDate }}</p>

      <LoadFailureAlert
        v-if="contentFailure !== null"
        class="mt-4"
        :failure="contentFailure"
        :is-retrying="isContentLoading"
        @retry="loadContent"
      />
      <ElSkeleton v-else-if="isContentLoading" class="mt-2" :rows="6" animated />
      <!--
        `resolved === null` 是後端的 `200` ＋ `data: null`：那個基準日**沒有任何一版適用**。
        它不是錯誤（§3.6），所以走空狀態而不是失敗畫面；而那句話必須說清楚是「這一天沒有」，
        不能只寫「沒有資料」——使用者要能想到「那我把日期往後調」。
      -->
      <ElEmpty v-else-if="resolved === null" :description="$t('regulatory-datasets.content-no-version')" />
      <div v-else class="mt-4">
        <p class="mb-2 text-sm text-ink-muted">
          {{ $t('regulatory-datasets.content-version') }}{{ resolved.version.versionCode }}
        </p>
        <DatasetRecordTable :columns="recordColumns" :rows="recordDisplayRows" />
      </div>
    </section>
  </AppShell>
</template>
