<script setup lang="ts">
/**
 * 登入頁。公開路由，不套 layout——使用者到這一頁的時候還沒有身分，
 * 側欄選單與頁首的登入者資訊都還不存在。
 */
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElForm, ElFormItem, ElInput } from 'element-plus'
import { BusinessRuleError } from '../../../shared/api/api-error.ts'
import { login } from '../../../shared/api/sessions.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { useAuthStore } from '../../../stores/auth.ts'
import { canSubmitLogin } from './sessions-login.actions.ts'
import { toLoginPayload } from './sessions-login.payload.ts'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
// 標註型別把 key 收窄回 `MessageKey`，並同時遮蔽掉套件的全域 `$t`（理由見語系檔的 `TranslateMessage`）。
const { t } = useI18n()
const $t: TranslateMessage = t

const form = reactive({ companyCode: '', username: '', password: '' })
const isSubmitting = ref(false)
/** 顯示在表單上方的失敗訊息；`null` = 這次還沒失敗過。 */
const failureMessage = ref<string | null>(null)

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

/**
 * 失敗時要顯示的那句話。
 *
 * **業務錯誤一律顯示後端回來的 `errors[0].msg`，前端不自己準備文案**（見語系檔檔頭）：
 * 登入失敗的含糊化是**後端的規格**（後端規範 §3.2：公司代號不存在／帳號不存在／密碼錯誤／
 * 帳號不屬於這家公司，四種一律同一句），四種原因在後端就已經收斂成同一筆 `auth.invalid-credentials`。
 * 前端另外留一份文案的話，那份副本不受那條規格約束——下一個人把它改精確一點時沒有任何檢查會擋，
 * 而登入頁就變成一支帳號列舉工具。
 *
 * 非業務錯誤（連不上、回應不是 envelope）走前端自己的系統錯誤文案：那與帳號是否存在無關，
 * 不構成列舉管道，而使用者能做的也只有再試一次。
 */
const toFailureMessage = (error: unknown): string => {
  if (!(error instanceof BusinessRuleError)) return $t('error.system')
  // `errors` 理論上一定有一筆（後端規範 §1.3：`300` 才帶 errors，且不會是空的）；
  // 真的空了就退到 envelope 頂層的 `msg`，那一句同樣是後端翻好的。
  return error.errors[0]?.msg ?? error.message
}

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  failureMessage.value = null

  login(payload.value)
    .then((identity) => {
      // access token 已經由統一 client 收進記憶體；store 只放「登入身分與所屬公司」（§2.1）。
      auth.signIn(identity)
      return router.replace(resolveDestination())
    })
    .catch((error: unknown) => {
      failureMessage.value = toFailureMessage(error)
    })
    .finally(() => {
      isSubmitting.value = false
    })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-canvas p-6">
    <div class="w-full max-w-sm rounded-panel bg-surface p-8 shadow-panel">
      <h1 class="text-xl font-semibold text-ink">{{ $t('login.heading') }}</h1>
      <p class="mt-1 mb-6 text-sm text-ink-muted">{{ $t('login.subheading') }}</p>

      <ElAlert
        v-if="failureMessage !== null"
        class="mb-4"
        type="error"
        show-icon
        :closable="false"
        :title="failureMessage"
      />

      <ElForm label-position="top" @submit.prevent="onSubmit">
        <ElFormItem :label="$t('login.field.company-code')">
          <ElInput v-model="form.companyCode" name="companyCode" autocomplete="organization" />
        </ElFormItem>
        <ElFormItem :label="$t('login.field.username')">
          <ElInput v-model="form.username" name="username" autocomplete="username" />
        </ElFormItem>
        <ElFormItem :label="$t('login.field.password')">
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
          {{ $t('login.submit') }}
        </ElButton>
      </ElForm>
    </div>
  </div>
</template>
