<script setup lang="ts">
/**
 * Dashboard。需要登入才進得來（見同層的 `.route.ts` 與 router 的守衛）。
 *
 * 目前內容只有「登入者是誰、屬於哪一家公司」——那正是登入回應唯一帶回來的東西。
 * 這一頁刻意不先擺上假的統計卡片：畫不出真實數字的區塊會被當成「還沒載入」，
 * 而它永遠不會載入完。
 */
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppShell from '../../../layouts/AppShell.vue'
import { useSignOut } from '../../../shared/api/use-sign-out.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'

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
  </AppShell>
</template>
