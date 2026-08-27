<script setup lang="ts">
/**
 * 已登入頁面的外框：側欄選單 ＋ 頁首 ＋ 內容區。
 *
 * 版面與間距一律 Tailwind utility，互動控制項一律 Element Plus（§5.1）——
 * 反過來用 `el-row`／`el-col` 做整頁版面會讓兩套響應式斷點打架，
 * 用 Tailwind 重刻表單控制項則會失去鍵盤操作與無障礙屬性，而那是大量表單的 HR 系統每天在用的。
 *
 * 這個元件**不呼叫任何 API、不碰 store**：登出是頁面的事（它要決定登出成功後去哪裡），
 * 這裡只負責把按鈕畫出來並把事件丟回去。
 */
import { ElButton } from 'element-plus'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MAIN_MENU } from '../menu/main-menu.ts'
import type { TranslateMessage } from '../shared/i18n/messages.ts'

// 標註型別把 key 收窄回 `MessageKey`，並同時遮蔽掉套件的全域 `$t`（理由見語系檔的 `TranslateMessage`）。
const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{
  /** 頁首顯示的登入者名稱。 */
  userName: string
  /** 頁首顯示的所屬公司名稱。 */
  companyName: string
  /** 登出請求進行中；用來停用按鈕並顯示 loading（§6.2 防重複點擊）。 */
  isSigningOut: boolean
}>()

const emit = defineEmits<{ 'sign-out-requested': [] }>()

const onSignOutClicked = (): void => {
  emit('sign-out-requested')
}
</script>

<template>
  <div class="min-w-(--width-app-min) flex min-h-screen bg-canvas text-ink">
    <aside class="w-60 shrink-0 border-r border-line bg-surface">
      <div class="flex h-16 items-center border-b border-line px-gutter text-lg font-semibold">
        {{ $t('app.name') }}
      </div>
      <nav class="p-gutter">
        <div v-for="group in MAIN_MENU" :key="group.labelKey" class="mb-6">
          <p class="mb-2 text-xs font-medium tracking-wide text-ink-muted">
            {{ $t(group.labelKey) }}
          </p>
          <ul class="flex flex-col gap-1">
            <li v-for="item in group.items" :key="item.routeName">
              <RouterLink
                :to="{ name: item.routeName }"
                class="block rounded-lg px-3 py-2 text-sm hover:bg-brand-soft"
                active-class="bg-brand-soft font-medium text-brand-strong"
              >
                {{ $t(item.labelKey) }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex h-16 shrink-0 items-center justify-end gap-4 border-b border-line bg-surface px-gutter"
      >
        <div class="text-right leading-tight">
          <p class="text-sm font-medium">{{ userName }}</p>
          <p class="text-xs text-ink-muted">{{ companyName }}</p>
        </div>
        <ElButton :loading="isSigningOut" :disabled="isSigningOut" @click="onSignOutClicked">
          {{ $t('dashboard.sign-out') }}
        </ElButton>
      </header>

      <main class="min-w-0 flex-1 p-gutter">
        <slot />
      </main>
    </div>
  </div>
</template>
