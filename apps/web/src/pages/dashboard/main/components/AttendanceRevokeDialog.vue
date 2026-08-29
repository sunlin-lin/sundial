<script setup lang="ts">
/**
 * 撤銷打卡對話框（本頁私有子元件，§1.5）。
 *
 * UI 定案 10 的撤銷流程：「點擊撤銷 → 顯示該筆打卡時間與大約地址 → 填寫撤銷原因 → 再次確認 →
 * 標記為已撤銷 → 重新計算」。**地址反查已暫停**（計畫 §4.8），因此只顯示打卡時間，不放一個
 * 永遠是空的地址欄位。「再次確認」落實為填完原因、按下「撤銷」後跳出的 `ElMessageBox.confirm`
 * ——與只填一次表單相比，多一次需要使用者主動點下去的動作，對應「再次」這兩個字。
 *
 * `record` 沒有走 `defineModel`／`v-model`：由呼叫端決定「要撤銷哪一筆」本來就要先選出一筆記錄，
 * 讓那筆記錄本身兼職「有沒有開啟」的旗標，呼叫端不必再多維護一個獨立的布林
 * （同 `EmploymentLeaveDialog.vue` 的既有寫法）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox } from 'element-plus'
import { attendanceRecordsRevoke } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { canSubmitRevokeForm } from '../dashboard-main.actions.ts'
import {
  emptyRevokeFormErrors,
  revokeFormItemErrorProp,
  toGeneralFailureMessage,
  toRevokeFormErrors,
  type RevokeFormErrors,
} from '../dashboard-main.errors.view.ts'
import { emptyRevokeFormState, toRevokePayload } from '../dashboard-main.payload.ts'
import { clockTimeDisplay, type AttendanceRecordDetail, type TodayPunchRecord } from '../dashboard-main.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

/**
 * `kind` 只決定標題文案（「撤銷上班卡」／「撤銷下班卡」），業務上兩者呼叫同一支端點。
 *
 * `record` 是 {@link TodayPunchRecord}（只有 `id`／`clockedAt`），不是完整的
 * {@link AttendanceRecordDetail}：呼叫端（`AttendanceTodayCard.vue`）手上的「今天這張卡」現在
 * 可能來自 `list-own-by-date` 的列表項目（頁面載入時查出來），也可能來自 `create` 的完整回應
 * （本次瀏覽階段內打卡），這個對話框只用得到這兩欄，收窄成兩者都滿足的形狀。
 */
const props = defineProps<{ record: TodayPunchRecord | null; kind: 'clock-in' | 'clock-out' }>()
const emit = defineEmits<{ close: []; revoked: [detail: AttendanceRecordDetail] }>()

const form = reactive(emptyRevokeFormState())
const isSubmitting = ref(false)
const formErrors = ref<RevokeFormErrors>(emptyRevokeFormErrors())

const isOpen = computed(() => props.record !== null)
const titleKey = computed(() =>
  props.kind === 'clock-in'
    ? 'dashboard.attendance.revoke.title-clock-in'
    : 'dashboard.attendance.revoke.title-clock-out',
)
const punchTimeText = computed(() => clockTimeDisplay(props.record))
const canSubmit = computed(() => canSubmitRevokeForm({ isSubmitting: isSubmitting.value, reason: form.reason }))

watch(
  () => props.record,
  (next) => {
    if (next === null) return
    form.reason = ''
    formErrors.value = emptyRevokeFormErrors()
  },
)

const onCancel = (): void => {
  if (isSubmitting.value) return
  emit('close')
}

const onSubmit = (): void => {
  if (!canSubmit.value || props.record === null) return
  const record = props.record

  ElMessageBox.confirm($t('dashboard.attendance.revoke.confirm'), $t('dashboard.attendance.revoke.confirm-title'), {
    confirmButtonText: $t('dashboard.attendance.revoke.confirm-ok'),
    cancelButtonText: $t('dashboard.attendance.revoke.confirm-cancel'),
    type: 'warning',
  })
    .then(() => {
      isSubmitting.value = true
      formErrors.value = emptyRevokeFormErrors()
      return attendanceRecordsRevoke(toRevokePayload(record.id, form))
    })
    .then((detail) => {
      ElMessage.success($t('dashboard.attendance.toast.revoked'))
      emit('revoked', detail)
      emit('close')
    })
    .catch((error: unknown) => {
      // `ElMessageBox.confirm` 取消時也會落到這個 `catch`（用 reject 表達取消）；那個情境下
      // `isSubmitting` 還沒被設為 `true`（見上面的 `.then`），用它分辨「使用者取消」與「API 真的失敗」
      // ——同 `ShiftListTable.vue` 的 `onDelete` 既有寫法。
      if (!isSubmitting.value) return
      if (error instanceof BusinessRuleError) {
        formErrors.value = toRevokeFormErrors(error.errors)
        return
      }
      formErrors.value = { reasonMessage: null, generalMessages: [toGeneralFailureMessage(error, $t)] }
    })
    .finally(() => {
      isSubmitting.value = false
    })
}
</script>

<template>
  <ElDialog
    :model-value="isOpen"
    :title="$t(titleKey)"
    width="480px"
    :close-on-click-modal="false"
    @update:model-value="onCancel"
  >
    <p class="text-sm text-ink-muted">{{ $t('dashboard.attendance.revoke.punch-time-label') }}：{{ punchTimeText }}</p>

    <ElForm class="mt-4" label-position="top" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-3"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />
      <ElFormItem v-bind="revokeFormItemErrorProp(formErrors)" :label="$t('dashboard.attendance.revoke.field.reason')">
        <ElInput
          v-model="form.reason"
          type="textarea"
          :rows="3"
          :maxlength="500"
          show-word-limit
          :disabled="isSubmitting"
        />
      </ElFormItem>
    </ElForm>

    <template #footer>
      <ElButton :disabled="isSubmitting" @click="onCancel">{{ $t('dashboard.attendance.revoke.cancel') }}</ElButton>
      <ElButton type="danger" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
        {{ $t('dashboard.attendance.revoke.submit') }}
      </ElButton>
    </template>
  </ElDialog>
</template>
