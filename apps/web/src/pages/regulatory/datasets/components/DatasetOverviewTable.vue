<script setup lang="ts">
/**
 * 總覽那一張表（計畫 03 §4.1 的欄位表）。
 *
 * 本頁私有的子元件（§1.5）。抽出來的理由是 §1.2：這一頁同時負責「查詢條件（基準日）／
 * 總覽／版本清單／版本內容」四件事，模板全部寫在 `.page.vue` 裡會超過行數上限，
 * 而更實際的問題是——改「版本清單的欄寬」會捲動到「總覽的狀態標籤」那一段。
 *
 * **每一格都是 `.view.ts` 已經算好的字串**，所以純文字欄位一律走 `prop`、不開 slot：
 * Element Plus 的 slot 型別是 `Record<PropertyKey, any>`，開一個 slot 就多一段沒有型別保護的
 * 程式碼，而那正是「欄位名打錯 → 畫面空白、沒有任何報錯」的地方。
 */
import { computed } from 'vue'
import { ElButton, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { DatasetCode } from '../regulatory-datasets.payload.ts'
import type { OverviewDisplayRow } from '../regulatory-datasets.view.ts'

// 標註型別把 key 收窄回 `MessageKey`，並同時遮蔽掉套件的全域 `$t`（理由見語系檔的 `TranslateMessage`）。
const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{
  rows: readonly OverviewDisplayRow[]
  /** 目前展開版本清單的那一個資料集；`null` = 還沒選。用來把那一列標起來。 */
  selectedDatasetCode: DatasetCode | null
}>()

defineEmits<{ 'versions-requested': [datasetCode: DatasetCode] }>()

// `data` 收的是可變陣列，而 props 是唯讀的。複製的是陣列本身不是元素（元素仍然是同一批唯讀物件）。
// 在這裡複製而不是寫在模板上：`[...rows]` 是一段運算式，而 §1.4 只允許模板出現屬性存取、
// 單一函式呼叫與單一比較。
const tableRows = computed(() => [...props.rows])

/**
 * 展開／已展開的按鈕文字。
 *
 * 寫成函式而不是模板裡的三元：§1.4 禁止模板出現條件運算式，而它的實質理由是模板運算式
 * 沒有型別窄化也沒有測試——這裡的 `scope.row` 更是 `any`。
 */
const actionLabel = (datasetCode: DatasetCode): string =>
  datasetCode === props.selectedDatasetCode
    ? $t('regulatory-datasets.action.versions-shown')
    : $t('regulatory-datasets.action.versions')
</script>

<template>
  <ElTable :data="tableRows" row-key="datasetCode" class="w-full" :border="true">
    <ElTableColumn prop="name" :label="$t('regulatory-datasets.column.dataset')" min-width="240" />
    <ElTableColumn prop="maintenance" :label="$t('regulatory-datasets.column.maintenance')" width="110" />
    <ElTableColumn prop="versionCode" :label="$t('regulatory-datasets.column.effective-version')" width="130" />
    <ElTableColumn prop="effectiveFrom" :label="$t('regulatory-datasets.column.effective-from')" width="120" />
    <ElTableColumn prop="recordCount" :label="$t('regulatory-datasets.column.record-count')" width="90" align="right" />

    <!--
      最後同步：時間（或「不適用」／「從未同步」）＋ 狀態標籤。
      標籤只在真的同步過的那幾列出現——「不適用」與「從未同步」沒有狀態可標，
      硬給一個灰標籤會讓它們看起來像第五、第六種同步結果。
      狀態同時有文字與顏色：§9.1 禁止只用顏色表達狀態。
    -->
    <ElTableColumn :label="$t('regulatory-datasets.column.last-sync')" min-width="210">
      <template #default="scope">
        <span>{{ scope.row['lastSync'] }}</span>
        <ElTag
          v-if="scope.row['lastSyncStatusLabel'] !== ''"
          class="ml-2"
          :type="scope.row['lastSyncTone']"
          :effect="scope.row['lastSyncEffect']"
          disable-transitions
        >
          {{ scope.row['lastSyncStatusLabel'] }}
        </ElTag>
      </template>
    </ElTableColumn>

    <!--
      唯讀頁面上唯一的按鈕，而且它**不會改變任何後端狀態**（計畫 §2）：它只是展開下面那一段。
      文字隨展開狀態改變，而不是換一顆按鈕：使用者要看得出「我現在展開的是哪一列」。
    -->
    <ElTableColumn :label="$t('regulatory-datasets.column.actions')" width="120" align="center">
      <template #default="scope">
        <ElButton link type="primary" @click="$emit('versions-requested', scope.row['datasetCode'])">
          {{ actionLabel(scope.row['datasetCode']) }}
        </ElButton>
      </template>
    </ElTableColumn>
  </ElTable>
</template>
