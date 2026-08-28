<script setup lang="ts">
/**
 * 載入失敗的兩種畫面（§7.2 的「載入失敗」再分兩種，因為使用者的下一步不同）。
 *
 * 本頁有三段各自會失敗的載入（總覽、版本清單、版本內容），三段的處置完全相同——
 * 抽成本頁私有的子元件（§1.5：頁面私有的東西放頁面自己的目錄底下）。
 * 三處各寫一份的話，第一次改動（例如加一句說明）只會改到其中一處，而另外兩處不會有任何症狀。
 *
 * **無權限時沒有重試鈕**：重試幾次都一樣，該做的是去找有權限的人。
 * 顯示的是**後端回來的那句話**，前端不另備一份文案（§3.6、語系檔檔頭）——同一件事準備兩套說法，
 * 兩套就會漂移，而漂移不會有任何錯誤。
 */
import { ElAlert, ElButton } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { LoadFailure } from '../../../../shared/api/load-failure.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'

// 標註型別把 key 收窄回 `MessageKey`，並同時遮蔽掉套件的全域 `$t`（理由見語系檔的 `TranslateMessage`）。
const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{
  failure: LoadFailure
  /** 重試進行中；用來停用按鈕並顯示 loading（§6.2 防重複點擊）。 */
  isRetrying: boolean
}>()

defineEmits<{ retry: [] }>()
</script>

<template>
  <ElAlert
    v-if="failure.kind === 'permission-denied'"
    type="error"
    show-icon
    :closable="false"
    :title="failure.message"
  />

  <div v-else>
    <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
    <ElButton class="mt-4" :loading="isRetrying" :disabled="isRetrying" @click="$emit('retry')">
      {{ $t('regulatory-datasets.retry') }}
    </ElButton>
  </div>
</template>
