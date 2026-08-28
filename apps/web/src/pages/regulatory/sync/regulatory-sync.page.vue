<script setup lang="ts">
/**
 * 法規資料同步歷程（計畫 03 §4.3）。
 *
 * 回答的問題是「同步有沒有在跑、失敗過幾次、為什麼失敗」。這看起來像維運資訊，但它是
 * **人資會問的問題**：「這個月的健保級距對嗎」的答案是「最後一次同步是哪天、成功還是失敗」。
 *
 * **唯讀，而且是刻意的（計畫 §2）**：沒有任何會改變後端狀態的按鈕，也不提供觸發同步。
 * 觸發由排程負責；人工觸發端點依決策 D3 不開放——觸發全平台同步不該由某一家公司的管理者做，
 * 而平台管理員這個角色還不存在。後端 handler 裡同樣看不到 `runSync`，兩邊是同一個決定。
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
 * **但仍然要登入、仍然走權限碼**（`regulatory.sync.list`）：資料不敏感不等於入口要敞開。
 * 這件事現在由前後端各擋一次：路由守衛依 `meta.permission` 擋（見 `.route.ts`），
 * 後端無權限回 `901`（本頁顯示無權限而不導登入頁）。
 *
 * ## 資料集清單與同步歷程是同一次查詢
 *
 * `sync/list` 的 `datasetCode` 是必填的，下拉需要九個資料集的**名稱**，而使用者要選之前就要
 * 看到。曾經想過兩種取法都不理想：打 `regulatory.datasets.overview` 換名稱會讓這一頁多依賴
 * 一個與本頁業務無關的權限碼；對九個代碼各探測一次 `sync/list` 又是九支請求換九個常數字串
 * ——在開發機看不出成本，上線後會被注意到。**後端把兩件事合成一次**：`sync/list` 的回應除了
 * 當次查詢那個資料集的 `datasetName`，另外固定帶九筆 `datasets`（見 `.view.ts` 的 `DatasetOption`）。
 * 因此下拉的選項與同步歷程表格**來自同一包回應**，一支請求、一個權限碼，不必另外打任何請求。
 *
 * 連帶結果：選項要等**第一次查詢**回來才有，不是進頁面就先擺出來。這不是退步——預設資料集
 * （`DEFAULT_DATASET_CODE`）本來就會在 `onMounted` 立刻查一次，因此選項與第一批列表資料
 * 同時就緒；載入中只顯示一個骨架屏（`ElSkeleton`），不會出現「選項先出現、內容還在轉」
 * 或「選項空白一瞬間、不知道要選什麼」的中間態。
 *
 * 呈現決策一律不在這裡：狀態的文字與色彩、失敗原因的空值處置、筆數與總數的換算、回聲比對，
 * 全部在 `.view.ts` 與共用區（§1.3）；查詢的組裝在 `.payload.ts`。
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
  ElPagination,
  ElRadio,
  ElRadioGroup,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import AppShell from '../../../layouts/AppShell.vue'
import { regulatorySyncList } from '../../../api/generated/api-client.ts'
import { isListEcho } from '../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../shared/api/load-failure.ts'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import {
  DEFAULT_DATASET_CODE,
  SYNC_LIST_PER_PAGE,
  toSyncListQuery,
  type SyncDatasetCode,
} from './regulatory-sync.payload.ts'
import { toDisplayRows, type DatasetOption, type SyncLogDisplayRow } from './regulatory-sync.view.ts'

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

// --- 查詢條件與列表狀態（§2.1：清單留在元件內，換頁重來一次，不進 store） -------------

const datasetOptions = ref<readonly DatasetOption[]>([])
const datasetCode = ref<SyncDatasetCode>(DEFAULT_DATASET_CODE)
const currentPage = ref(1)
// 存的是**已經組好的顯示列**（`.view.ts` 的 `toDisplayRows`），不是 API 的原始列：
// 模板那一側拿不到型別保護（Element Plus 的表格 slot 是 `Record<PropertyKey, any>`），
// 換算留到模板才做等於把它整段推進沒有檢查的區域。
const rows = ref<SyncLogDisplayRow[]>([])
const totalCount = ref(0)

// §7.2 的四種畫面：載入中／有資料／空結果／載入失敗（失敗的兩種分法見 `toLoadFailure`）。
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)

const load = (): void => {
  const query = toSyncListQuery(datasetCode.value, currentPage.value)

  isLoading.value = true
  failure.value = null

  regulatorySyncList(query)
    .then((page) => {
      // §7.3：回聲不符就**整包丟棄**——不寫 rows、不更新分頁、**也不關 loading**
      //（仍有較新的請求在途中，關掉會讓畫面先閃一次舊資料）。
      if (!isListEcho(page, query)) return

      // `page.datasets` 是固定九筆，每次查詢都會帶——重新指派雖然每次內容相同，
      // 但比「只在第一次寫入」多一個 if 分支換來的東西少：不分支就不會有「這個分支到底
      // 該在什麼條件下跑」的第二個判斷需要維護，而重新指派九筆固定資料的成本可以忽略。
      datasetOptions.value = page.datasets
      // `page.datasetName` 是這一包回應自己帶的名稱，不是從 `datasetOptions` 查表——
      // 一整包回應裡的所有列必然屬於同一個資料集（§4.3），直接用回應自己的名稱
      // 保證表格上的名稱與正在顯示的這批列絕對對得上，理由見 `.view.ts` 的 `toDisplayRows` 檔頭。
      rows.value = toDisplayRows(page.data, $t, page.datasetName)
      // `totalCount` 現在是乾淨的 `integer`（後端已改），產生型別就是 `number`，直接用。
      // 這裡以前有一支逐位累加的 `toTotalCount`，因為當時的產生型別是 `string | number`
      //（Elysia 的可強制轉型數值型別在 OpenAPI 上留下的 `anyOf[string, integer]` 影子）。
      totalCount.value = page.pagination.totalCount
      isLoading.value = false
    })
    .catch((error: unknown) => {
      // 失敗的回應沒有回聲可比（錯誤路徑不帶 `search`／`sort`），只能拿條件本身擋：
      // 少了這一行，一個舊條件的失敗會把新條件的畫面蓋成錯誤頁。
      if (datasetCode.value !== query.datasetCode) return

      // `datasetOptions` 刻意不清空：若這不是第一次查詢（切換到另一個資料集才失敗），
      // 選項清單仍然是有效資訊，讓使用者能改選別的資料集重試，而不是連帶把選擇器一起收掉。
      // 第一次查詢失敗時它本來就還是初始值 `[]`，下面的失敗畫面會取代選擇器，沒有分支需要處理。
      rows.value = []
      totalCount.value = 0
      failure.value = toLoadFailure(error)
      isLoading.value = false
    })
}

/** 重試：與初次載入是同一支函式——選項與列表現在同一次查詢就位，沒有「哪一段還沒載到」要分辨。 */
const retry = (): void => {
  load()
}

/** 篩選條件變更一律回到第 1 頁（§7.1）：停在第 5 頁而新條件只有 2 頁，畫面會空白。 */
const onDatasetChanged = (): void => {
  currentPage.value = 1
  load()
}

const onCurrentPageChanged = (page: number): void => {
  currentPage.value = page
  load()
}

// 回呼不是 async，也沒有未處理的 promise：`load()` 內部自己收掉成功與失敗（§3.4）。
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
    <h1 class="text-xl font-semibold text-ink">{{ $t('regulatory-sync.heading') }}</h1>
    <p class="mt-1 text-sm text-ink-muted">{{ $t('regulatory-sync.description') }}</p>

    <!--
      資料集是**必要**的查詢條件（後端一次只查一個資料集），所以它不是「篩選器」而是
      「看哪一份」。攤成一整排而不是收進下拉，是因為這一頁的第一個問題往往是
      「有哪幾份法規資料」——收起來的話，使用者得先點開才知道自己在看的是九分之一。
      九項在 1280px（§5.4 的最小支援寬度）會折成兩三行，`ElRadio` 的 border 版本折行後
      仍然是一個個獨立的方塊，不像 `ElRadioButton` 那樣把邊框接錯。
      名稱是 `sync/list` 回應自己帶的 `datasets`，不是前端自己維護的一份副本（見 `.view.ts` 檔頭）。
    -->
    <ElForm v-if="datasetOptions.length > 0" class="mt-6" @submit.prevent>
      <ElFormItem :label="$t('regulatory-sync.filter.dataset')">
        <ElRadioGroup v-model="datasetCode" :disabled="isLoading" @change="onDatasetChanged">
          <ElRadio
            v-for="option in datasetOptions"
            :key="option.code"
            :value="option.code"
            :border="true"
          >
            {{ option.name }}
          </ElRadio>
        </ElRadioGroup>
      </ElFormItem>
    </ElForm>

    <!-- 無權限：顯示後端回來的那句話，且**沒有重試鈕**——重試幾次都一樣。 -->
    <ElAlert
      v-if="failure?.kind === 'permission-denied'"
      type="error"
      show-icon
      :closable="false"
      :title="failure.message"
    />

    <div v-else-if="failure !== null">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-4" :loading="isLoading" @click="retry">
        {{ $t('regulatory-sync.retry') }}
      </ElButton>
    </div>

    <ElSkeleton v-else-if="isLoading" class="mt-2" :rows="5" animated />

    <ElEmpty v-else-if="rows.length === 0" :description="$t('regulatory-sync.empty')" />

    <div v-else>
      <!--
        每一格都是 `toDisplayRows` 已經算好的字串，所以純文字欄位一律走 `prop`、不開 slot：
        Element Plus 的 slot 型別是 `Record<PropertyKey, any>`，開一個 slot 就多一段沒有型別
        保護的程式碼，而那正是「欄位名打錯 → 畫面空白、沒有任何報錯」的地方。
      -->
      <!--
        前五欄用固定寬度、失敗原因用 `min-width`：多出來的寬度因此**全部給失敗原因**。
        反過來（前面幾欄也用 min-width）的話，寬度會平均分掉，而在最小支援寬度 1280px
        （§5.4）下失敗原因會被擠到需要左右捲動才讀得完一行——那正是計畫 §4.3 要避免的事：
        內容雖然沒有被截斷，但要讀完得來回捲動十幾次，實際效果與截斷相去不遠。
      -->
      <ElTable :data="rows" row-key="id" class="w-full" :border="true">
        <ElTableColumn prop="dataset" :label="$t('regulatory-sync.column.dataset')" width="150" />
        <ElTableColumn
          prop="startedAt"
          :label="$t('regulatory-sync.column.started-at')"
          width="145"
        />
        <ElTableColumn
          prop="finishedAt"
          :label="$t('regulatory-sync.column.finished-at')"
          width="145"
        />

        <!-- 狀態同時有文字與顏色：§9.1 禁止只用顏色表達狀態。 -->
        <ElTableColumn :label="$t('regulatory-sync.column.status')" width="96">
          <template #default="scope">
            <ElTag
              :type="scope.row['statusTone']"
              :effect="scope.row['statusEffect']"
              disable-transitions
            >
              {{ scope.row['statusLabel'] }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn
          prop="recordsReceived"
          :label="$t('regulatory-sync.column.records-received')"
          width="92"
          align="right"
        />

        <!--
          失敗原因：**完整顯示、不截斷**（計畫 §4.3）。
          刻意不設 `show-overflow-tooltip`（那會把長文截成一行、只留 hover 才看得到，
          而後端寫進 `error_message` 的正是「缺哪一種身分別、兩邊的 checksum、生效日推導不出來的
          原因」這些要逐字讀的內容），也不做展開／收合——多一個狀態就多一種「使用者沒展開就以為
          沒有原因」的失敗。整段換行攤在格子裡，滑鼠不動就看得到、也選得起來複製。
          這一欄是全表唯一為了版面而開的 slot：`whitespace-pre-wrap` 要保留後端自己排的換行，
          而那件事只有一個真的元素做得到。窄螢幕由表格水平捲動處理（§5.4）。
        -->
        <ElTableColumn :label="$t('regulatory-sync.column.error-message')" min-width="340">
          <template #default="scope">
            <span class="block whitespace-pre-wrap break-words">
              {{ scope.row['failureReason'] }}
            </span>
          </template>
        </ElTableColumn>
      </ElTable>

      <!--
        總頁數由分頁元件自己從 total 與 page-size 算（§7.1：前端不另存一份頁數）。
        `layout` 含 `total`：Element Plus 自己那段文案（「共 N 條」）的語系已經由
        `App.vue` 的 `ElConfigProvider` 設成 zh-tw，不會再在一個 zh-TW 的畫面上出現英文字。
      -->
      <ElPagination
        class="mt-4 justify-end"
        layout="total, prev, pager, next"
        :total="totalCount"
        :page-size="SYNC_LIST_PER_PAGE"
        :current-page="currentPage"
        @current-change="onCurrentPageChanged"
      />
    </div>
  </AppShell>
</template>
