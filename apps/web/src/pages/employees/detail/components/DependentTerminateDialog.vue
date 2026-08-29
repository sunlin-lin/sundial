<script setup lang="ts">
/**
 * 「終止扶養」對話框（本頁私有子元件，§1.5）。形狀比照 `EmploymentLeaveDialog.vue`：
 * `open` 不走 `defineModel`，而是「`dependent !== null` 就是開啟」——觸發來源
 * （`DependentsSection.vue`）本來就要決定「終止哪一筆眷屬」，讓那份資料本身兼職開關旗標。
 *
 * **終止是狀態變更，不是刪除**（UI 定案 §3.4）：呼叫 `dependents.main.terminate`，
 * 後端把 `status` 改成 `TERMINATED` 並寫入 `endDate`，這筆眷屬紀錄仍然保留。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElButton, ElDatePicker, ElDialog, ElForm, ElFormItem, ElMessage, ElAlert } from 'element-plus'
import { dependentsMainTerminate } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { canSubmitDependentTerminateForm } from '../employees-detail.actions.ts'
import { toGeneralFailureMessage } from '../employees-detail.errors.view.ts'
import { emptyDependentTerminateFormState, toDependentTerminatePayload } from '../employees-detail.payload.ts'
import type { DependentItem } from '../employees-detail.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ dependent: DependentItem | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const form = reactive(emptyDependentTerminateFormState())
const isSubmitting = ref(false)
/**
 * 終止失敗的訊息。**沒有可以就地標紅的表單欄位**：後端三種業務錯誤（`not-found`／
 * `already-terminated`／`state-changed`）的 `data.field` 都固定是 `id`——那是這筆眷屬本身的識別碼，
 * 不是使用者填的欄位，標紅一個看不見輸入框的欄位沒有意義，原樣顯示 `msg` 即可（§6.3 保底路徑，
 * 理由同 `AccountRoleAssignmentSection.vue` 的 `onRevoke`）。
 */
const errorMessages = ref<readonly string[]>([])

const isOpen = computed(() => props.dependent !== null)

watch(
  () => props.dependent,
  (next) => {
    if (next === null) return
    Object.assign(form, emptyDependentTerminateFormState())
    errorMessages.value = []
  },
)

const canSubmit = computed(() => canSubmitDependentTerminateForm({ isSubmitting: isSubmitting.value, form }))

const onCancel = (): void => {
  if (isSubmitting.value) return
  emit('close')
}

const onSubmit = (): void => {
  if (!canSubmit.value || props.dependent === null) return

  isSubmitting.value = true
  errorMessages.value = []

  dependentsMainTerminate(toDependentTerminatePayload(props.dependent.id, form))
    .then(() => {
      ElMessage.success($t('employees-detail.dependent.toast.terminated'))
      emit('saved')
      emit('close')
    })
    .catch((error: unknown) => {
      errorMessages.value =
        error instanceof BusinessRuleError ? error.errors.map((item) => item.msg) : [toGeneralFailureMessage(error, $t)]
    })
    .finally(() => {
      isSubmitting.value = false
    })
}
</script>

<template>
  <ElDialog
    :model-value="isOpen"
    :title="$t('employees-detail.dependent.dialog.terminate-title')"
    width="480px"
    :close-on-click-modal="false"
    @update:model-value="onCancel"
  >
    <ElForm label-position="top" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in errorMessages"
        :key="index"
        class="mb-3"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />
      <ElFormItem :label="$t('employees-detail.dependent.field.end-date')">
        <ElDatePicker
          v-model="form.endDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isSubmitting"
          class="w-full"
        />
      </ElFormItem>
    </ElForm>

    <template #footer>
      <ElButton :disabled="isSubmitting" @click="onCancel">{{
        $t('employees-detail.employment.form.cancel')
      }}</ElButton>
      <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
        {{ $t('employees-detail.employment.form.submit') }}
      </ElButton>
    </template>
  </ElDialog>
</template>
