<script setup lang="ts">
/**
 * 登入頁。公開路由，不套 layout——使用者到這一頁的時候還沒有身分，
 * 側欄選單與頁首的登入者資訊都還不存在。
 */
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElForm, ElFormItem, ElInput } from 'element-plus'
import { login } from '../../../shared/api/sessions.ts'
import { t } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import { canSubmitLogin } from './sessions-login.actions.ts'
import { toLoginPayload } from './sessions-login.payload.ts'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const form = reactive({ companyCode: '', username: '', password: '' })
const isSubmitting = ref(false)
const hasFailed = ref(false)

const payload = computed(() => toLoginPayload(form.companyCode, form.username, form.password))
const canSubmit = computed(() => canSubmitLogin(payload.value, isSubmitting.value))

/**
 * 登入成功後要去哪裡。
 *
 * 回跳網址只接受**站內的絕對路徑**：直接把 query 裡的字串丟給 router，
 * 等於讓任何人用一條 `?redirect=https://…` 的連結把剛登入的使用者送到外部網站，
 * 而網址列在那之前一直是我們自己的網域（open redirect，常見的釣魚起手式）。
 * `//` 開頭同樣要擋——那是「協定相對」網址，瀏覽器會當成外部主機。
 */
const resolveDestination = (): { path: string } | { name: string } => {
  const requested = route.query['redirect']
  if (typeof requested !== 'string') return { name: 'dashboard-main' }
  if (!requested.startsWith('/') || requested.startsWith('//')) return { name: 'dashboard-main' }
  return { path: requested }
}

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  hasFailed.value = false

  login(payload.value)
    .then((identity) => {
      // access token 已經由統一 client 收進記憶體；store 只放「登入身分與所屬公司」（§2.1）。
      auth.signIn(identity)
      return router.replace(resolveDestination())
    })
    .catch(() => {
      // **一律顯示同一句訊息，不因錯誤內容而不同。**
      // 分辨「帳號不存在」與「密碼錯誤」等於把登入頁變成一支帳號列舉工具；
      // 而系統錯誤與業務錯誤在這一頁對使用者的意義也是一樣的——他能做的只有再試一次。
      hasFailed.value = true
    })
    .finally(() => {
      isSubmitting.value = false
    })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-canvas p-6">
    <div class="w-full max-w-sm rounded-panel bg-surface p-8 shadow-panel">
      <h1 class="text-xl font-semibold text-ink">{{ t('login.heading') }}</h1>
      <p class="mt-1 mb-6 text-sm text-ink-muted">{{ t('login.subheading') }}</p>

      <ElAlert
        v-if="hasFailed"
        class="mb-4"
        type="error"
        show-icon
        :closable="false"
        :title="t('login.failed')"
      />

      <ElForm label-position="top" @submit.prevent="onSubmit">
        <ElFormItem :label="t('login.field.company-code')">
          <ElInput v-model="form.companyCode" name="companyCode" autocomplete="organization" />
        </ElFormItem>
        <ElFormItem :label="t('login.field.username')">
          <ElInput v-model="form.username" name="username" autocomplete="username" />
        </ElFormItem>
        <ElFormItem :label="t('login.field.password')">
          <ElInput
            v-model="form.password"
            name="password"
            type="password"
            autocomplete="current-password"
            show-password
          />
        </ElFormItem>

        <ElButton
          class="mt-2 w-full"
          type="primary"
          native-type="submit"
          :loading="isSubmitting"
          :disabled="!canSubmit"
        >
          {{ t('login.submit') }}
        </ElButton>
      </ElForm>
    </div>
  </div>
</template>
