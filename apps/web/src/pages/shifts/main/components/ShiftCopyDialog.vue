<script setup lang="ts">
/**
 * 複製班別的對話框（本頁私有子元件，§1.5）。
 *
 * **`copy` 端點只收 `sourceId`／`code`／`name`／`description`／`isActive`**（計畫 04 §7）：
 * 工作類型、彈性、時段、休息一律取自來源班別，這個對話框因此沒有那些欄位可以填——
 * 不是省略，是後端根本不收。
 *
 * **`code`／`name`／`description` 一律留白**（`emptyCopyFormState`），尤其是說明：
 * 那句話是後端刻意的設計——這張表的規則是「停用舊班別、複製建立新班別」（計畫 §7），
 * 半年後同一家公司會累積出一批只差幾分鐘的相近班別，分辨它們靠的就是說明；
 * 連說明一起複製會得到兩個一模一樣的說明，那份依據就沒了。
 *
 * 這裡的業務錯誤（代碼重複、來源不存在）只有 `code`／`sourceId` 兩種可能的 `field`，欄位數少、
 * 表單是靜態的三個輸入框，因此**不引入 `.errors.view.ts` 的列級對應**，全部走全域提示
 *（§6.3 的保底路徑：找不到對應欄位時走全域提示；這裡刻意選擇一律走保底，換取表單不必再多一層
 * 欄位對應邏輯——三個欄位的表單不值得為此多一份索引）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElSwitch } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { shiftsMainCopy } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { canSubmitCopyForm } from '../shifts-main.actions.ts'
import { toGeneralFailureMessage } from '../shifts-main.errors.view.ts'
import { emptyCopyFormState, toShiftCopyPayload } from '../shifts-main.payload.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

type CopySource = { id: string; code: string; name: string }

const props = defineProps<{ open: boolean; source: CopySource | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [] }>()

const form = reactive(emptyCopyFormState())
const isSubmitting = ref(false)
const errorMessages = ref<readonly string[]>([])

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    Object.assign(form, emptyCopyFormState())
    errorMessages.value = []
  },
)

const canSubmit = computed(() =>
  canSubmitCopyForm({
    isSubmitting: isSubmitting.value,
    code: form.code,
    name: form.name,
    description: form.description,
  }),
)

const onCancel = (): void => {
  emit('update:open', false)
}

const onSubmit = (): void => {
  if (!canSubmit.value || props.source === null) return

  isSubmitting.value = true
  errorMessages.value = []

  shiftsMainCopy(toShiftCopyPayload(props.source.id, form))
    .then(() => {
      ElMessage.success($t('shifts-main.toast.copied'))
      emit('saved')
      emit('update:open', false)
    })
    .catch((error: unknown) => {
      errorMessages.value =
        error instanceof BusinessRuleError
          ? error.errors.map((entry) => entry.msg)
          : [toGeneralFailureMessage(error, $t)]
    })
    .finally(() => {
      isSubmitting.value = false
    })
}
</script>

<template>
  <ElDialog
    :model-value="open"
    :title="$t('shifts-main.copy.title')"
    width="480px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:open', $event)"
  >
    <p class="mb-3 text-sm text-ink-muted">{{ $t('shifts-main.copy.description') }}</p>
    <p v-if="source !== null" class="mb-3 text-sm text-ink">{{ source.code }}　{{ source.name }}</p>

    <ElAlert
      v-for="(message, index) in errorMessages"
      :key="index"
      class="mb-3"
      type="error"
      show-icon
      :closable="false"
      :title="message"
    />

    <ElForm label-position="top" @submit.prevent="onSubmit">
      <ElFormItem :label="$t('shifts-main.copy.field.code')">
        <ElInput v-model="form.code" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem :label="$t('shifts-main.copy.field.name')">
        <ElInput v-model="form.name" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem :label="$t('shifts-main.copy.field.description')">
        <ElInput v-model="form.description" type="textarea" :rows="2" :disabled="isSubmitting" />
      </ElFormItem>
      <ElFormItem :label="$t('shifts-main.copy.field.is-active')">
        <ElSwitch v-model="form.isActive" :disabled="isSubmitting" />
      </ElFormItem>
    </ElForm>

    <template #footer>
      <ElButton :disabled="isSubmitting" @click="onCancel">{{ $t('shifts-main.copy.cancel') }}</ElButton>
      <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
        {{ $t('shifts-main.copy.submit') }}
      </ElButton>
    </template>
  </ElDialog>
</template>
