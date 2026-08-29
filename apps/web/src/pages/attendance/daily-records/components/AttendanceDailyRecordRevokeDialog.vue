<script setup lang="ts">
/**
 * 他人撤銷對話框（本頁私有子元件，§1.5；UI 23「撤銷操作」）。
 *
 * 呼叫 `attendance/records/revoke-other`——這是操作者對「別人」的打卡做出的處置，不是 Dashboard
 * 上員工撤銷自己打卡的 `revoke`（計畫 §4.3：兩條路徑，不是一條路徑加一個條件）。流程與
 * `dashboard-main` 的 `AttendanceRevokeDialog.vue` 同構（填原因 → 再次確認 → 呼叫端點 →
 * 成功後通知父層），差別只在呼叫的端點與顯示的目標資訊（UI 23：「顯示這筆打卡的員工、打卡類型、
 * 打卡時間與地點，不需要重新叫出整份明細」——這裡直接用觸發撤銷的那一列既有資料，不必再打一次
 * `get`）。
 *
 * **薪資結算鎖定的訊息不在這裡另外寫**：後端 `period-locked` 的中文訊息已經是 UI 23 要求的
 * 那一句，`toGeneralFailureMessage` 直接顯示後端回來的 `msg`（見 `.errors.view.ts` 檔頭）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox } from 'element-plus'
import { attendanceRecordsRevokeOther } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { canSubmitRevokeOtherForm } from '../attendance-daily-records.actions.ts'
import {
  emptyRevokeOtherFormErrors,
  revokeOtherFormItemErrorProp,
  toGeneralFailureMessage,
  toRevokeOtherFormErrors,
  type RevokeOtherFormErrors,
} from '../attendance-daily-records.errors.view.ts'
import { emptyRevokeOtherFormState, toRevokeOtherPayload } from '../attendance-daily-records.payload.ts'
import type { AttendanceDailyRecordDisplayRow } from '../attendance-daily-records.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

/** `target` 是要撤銷的那一列（已經是表格算好的顯示列，見檔頭），`null` 代表沒有開啟
 * （同 Dashboard 的 `AttendanceRevokeDialog.vue`，資料本身兼職開關旗標）。 */
const props = defineProps<{ target: AttendanceDailyRecordDisplayRow | null }>()
const emit = defineEmits<{ close: []; revoked: [] }>()

const form = reactive(emptyRevokeOtherFormState())
const isSubmitting = ref(false)
const formErrors = ref<RevokeOtherFormErrors>(emptyRevokeOtherFormErrors())

const isOpen = computed(() => props.target !== null)
const canSubmit = computed(() => canSubmitRevokeOtherForm({ isSubmitting: isSubmitting.value, reason: form.reason }))

watch(
  () => props.target,
  (next) => {
    if (next === null) return
    form.reason = ''
    formErrors.value = emptyRevokeOtherFormErrors()
  },
)

const onCancel = (): void => {
  if (isSubmitting.value) return
  emit('close')
}

const onSubmit = (): void => {
  if (!canSubmit.value || props.target === null) return
  const target = props.target

  ElMessageBox.confirm(
    $t('attendance-daily-records.revoke.confirm'),
    $t('attendance-daily-records.revoke.confirm-title'),
    {
      confirmButtonText: $t('attendance-daily-records.revoke.confirm-ok'),
      cancelButtonText: $t('attendance-daily-records.revoke.confirm-cancel'),
      type: 'warning',
    },
  )
    .then(() => {
      isSubmitting.value = true
      formErrors.value = emptyRevokeOtherFormErrors()
      return attendanceRecordsRevokeOther(toRevokeOtherPayload(target.id, form))
    })
    .then(() => {
      ElMessage.success($t('attendance-daily-records.toast.revoked'))
      emit('revoked')
      emit('close')
    })
    .catch((error: unknown) => {
      // `ElMessageBox.confirm` 取消時也會落到這個 `catch`（用 reject 表達取消）；那個情境下
      // `isSubmitting` 還沒被設為 `true`，用它分辨「使用者取消」與「API 真的失敗」
      // （同 Dashboard 的 `AttendanceRevokeDialog.vue` 既有寫法）。
      if (!isSubmitting.value) return
      if (error instanceof BusinessRuleError) {
        formErrors.value = toRevokeOtherFormErrors(error.errors)
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
    :title="$t('attendance-daily-records.revoke.title')"
    width="480px"
    :close-on-click-modal="false"
    @update:model-value="onCancel"
  >
    <template v-if="target !== null">
      <p class="text-sm text-ink-muted">
        {{ $t('attendance-daily-records.revoke.target-employee') }}：{{ target.employeeName }}（{{
          target.employeeCode
        }}）
      </p>
      <p class="mt-1 text-sm text-ink-muted">
        {{ $t('attendance-daily-records.revoke.target-type') }}：{{ target.attendanceTypeLabel }}
      </p>
      <p class="mt-1 text-sm text-ink-muted">
        {{ $t('attendance-daily-records.revoke.target-clocked-at') }}：{{ target.clockedAtDisplay }}
      </p>
      <p class="mt-1 text-sm text-ink-muted">
        {{ $t('attendance-daily-records.revoke.target-location') }}：{{ target.locationDisplay }}
      </p>
    </template>

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
      <ElFormItem
        v-bind="revokeOtherFormItemErrorProp(formErrors)"
        :label="$t('attendance-daily-records.revoke.field.reason')"
      >
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
      <ElButton :disabled="isSubmitting" @click="onCancel">
        {{ $t('attendance-daily-records.revoke.cancel') }}
      </ElButton>
      <ElButton type="danger" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
        {{ $t('attendance-daily-records.revoke.submit') }}
      </ElButton>
    </template>
  </ElDialog>
</template>
