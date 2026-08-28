<script setup lang="ts">
/**
 * 版本清單那一張表 ＋ 分頁（計畫 03 §4.1 的第二層）。本頁私有的子元件（§1.5）。
 *
 * 一列一個版本：這份法規歷史上有哪幾版、各自從哪一天起適用、有幾筆。
 * 版本清單**與基準日無關**——「有哪幾版」與「今天適用哪一版」是兩個問題，
 * 所以改基準日時這張表不重載，只有「本基準日適用」那個標記會跳到另一列。
 */
import { computed } from 'vue'
import { ElButton, ElPagination, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { VERSION_LIST_PER_PAGE } from '../regulatory-datasets.payload.ts'
import type { VersionDisplayRow } from '../regulatory-datasets.version.view.ts'

// 標註型別把 key 收窄回 `MessageKey`，並同時遮蔽掉套件的全域 `$t`（理由見語系檔的 `TranslateMessage`）。
const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{
  rows: readonly VersionDisplayRow[]
  totalCount: number
  currentPage: number
}>()

defineEmits<{
  'page-changed': [page: number]
  'content-requested': [versionCode: string]
}>()

// 理由同總覽那一張表：`data` 收可變陣列，而複製不寫在模板上（§1.4）。
const tableRows = computed(() => [...props.rows])

// 分頁元件的 `page-size`。從 `.payload.ts` 拿而不是在這裡寫一個 10：
// 兩個數字分開維護時，改了查詢卻沒改顯示，畫面上的頁數會與實際筆數對不起來（§7.1）。
const perPage = VERSION_LIST_PER_PAGE
</script>

<template>
  <div>
    <ElTable :data="tableRows" row-key="id" class="w-full" :border="true">
      <ElTableColumn
        prop="versionCode"
        :label="$t('regulatory-datasets.column.version-code')"
        width="130"
      />
      <ElTableColumn
        prop="effectiveFrom"
        :label="$t('regulatory-datasets.column.effective-from')"
        width="120"
      />
      <ElTableColumn
        prop="effectiveTo"
        :label="$t('regulatory-datasets.column.effective-to')"
        width="120"
      />
      <ElTableColumn
        prop="recordCount"
        :label="$t('regulatory-datasets.column.record-count')"
        width="90"
        align="right"
      />
      <ElTableColumn
        prop="syncedAt"
        :label="$t('regulatory-datasets.column.synced-at')"
        min-width="150"
      />

      <!--
        「本基準日適用」的標記。這一欄的存在理由是把基準日這個抽象概念釘在畫面上的一列上：
        使用者改了基準日之後，標記會跳到另一列——那一秒他就懂了「適用版本」是什麼意思，
        而一段說明文字做不到這件事。
      -->
      <ElTableColumn :label="$t('regulatory-datasets.column.effective-now')" width="130">
        <template #default="scope">
          <ElTag v-if="scope.row['isEffective']" type="success" effect="light" disable-transitions>
            {{ $t('regulatory-datasets.effective-at-as-of-date') }}
          </ElTag>
        </template>
      </ElTableColumn>

      <ElTableColumn :label="$t('regulatory-datasets.column.actions')" width="120" align="center">
        <template #default="scope">
          <ElButton
            link
            type="primary"
            @click="$emit('content-requested', scope.row['versionCode'])"
          >
            {{ $t('regulatory-datasets.action.content') }}
          </ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <!--
      總頁數由分頁元件自己從 total 與 page-size 算（§7.1：前端不另存一份頁數）。
      `layout` 含 `total`：那段文案的語系由 `App.vue` 的 `ElConfigProvider` 設成 zh-tw。
    -->
    <ElPagination
      class="mt-4 justify-end"
      layout="total, prev, pager, next"
      :total="totalCount"
      :page-size="perPage"
      :current-page="currentPage"
      @current-change="$emit('page-changed', $event)"
    />
  </div>
</template>
