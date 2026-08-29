<script setup lang="ts">
/**
 * 新增／修改班別的對話框（本頁私有子元件，§1.5）。
 *
 * **自己擁有整個編輯／送出流程**：`shiftId === null` 是新增，否則先呼叫 `get` 拿完整明細
 * （清單列本身沒有 `description`）填進表單再讓使用者改。這個元件自己打 API、自己處理
 * loading／錯誤，`.page.vue` 只需要決定「開不開、開哪一筆」（見 `.page.vue` 檔頭）。
 *
 * **應工作時數是即時預覽，不是送出的一部分**（必做事項 1）：`previewRequiredWorkMinutes` 只在
 * 使用者編輯時段的當下於前端重算一次，`toShiftCreatePayload`／`toShiftUpdatePayload` 完全不含這個
 * 欄位——送出後畫面上顯示的清單改用後端回來的 `requiredWorkMinutes`，兩個數字理論上會一致，
 * 但**以後端為準**（`shifts-main.duration.view.ts` 檔頭已詳述理由）。
 */
import { computed, reactive, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElRadio,
  ElRadioGroup,
  ElSkeleton,
  ElSwitch,
} from 'element-plus'
import { useI18n } from 'vue-i18n'
import { shiftsMainCreate, shiftsMainGet, shiftsMainUpdate } from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { canSubmitShiftForm } from '../shifts-main.actions.ts'
import { minutesToHoursDisplay, previewRequiredWorkMinutes } from '../shifts-main.duration.view.ts'
import { toGeneralFailureMessage, toShiftFormErrors, type ShiftFormErrors } from '../shifts-main.errors.view.ts'
import {
  emptyShiftFormState,
  toFormStateFromDetail,
  toShiftCreatePayload,
  toShiftUpdatePayload,
} from '../shifts-main.payload.ts'
import { WORK_TYPE_CODES, workTypeLabel } from '../shifts-main.view.ts'
import ShiftBreaksEditor from './ShiftBreaksEditor.vue'
import ShiftWorkPeriodsEditor from './ShiftWorkPeriodsEditor.vue'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ open: boolean; shiftId: string | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [] }>()

const form = reactive(emptyShiftFormState())
const isLoadingDetail = ref(false)
const loadFailed = ref(false)
const isSubmitting = ref(false)
const emptyErrors: ShiftFormErrors = { workPeriodErrors: new Map(), breakErrors: new Map(), generalMessages: [] }
const formErrors = ref<ShiftFormErrors>(emptyErrors)

const dialogTitleKey = computed(() =>
  props.shiftId === null ? 'shifts-main.dialog.create-title' : 'shifts-main.dialog.edit-title',
)

const requiredHoursPreview = computed(() =>
  minutesToHoursDisplay(previewRequiredWorkMinutes(form.workPeriods, form.breaks), $t),
)

const canSubmit = computed(() =>
  canSubmitShiftForm({
    isSubmitting: isSubmitting.value,
    isLoadingDetail: isLoadingDetail.value,
    code: form.code,
    name: form.name,
    description: form.description,
    workPeriodCount: form.workPeriods.length,
  }),
)

/** 對話框每次開啟都重新載入：關閉不留殘留狀態，避免上一次沒送出的內容混進下一次。 */
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    formErrors.value = emptyErrors
    loadFailed.value = false

    if (props.shiftId === null) {
      Object.assign(form, emptyShiftFormState())
      return
    }

    isLoadingDetail.value = true
    shiftsMainGet({ id: props.shiftId })
      .then((detail) => {
        if (detail === null) {
          loadFailed.value = true
          return
        }
        Object.assign(form, toFormStateFromDetail(detail))
      })
      .catch(() => {
        loadFailed.value = true
      })
      .finally(() => {
        isLoadingDetail.value = false
      })
  },
)

const onCancel = (): void => {
  emit('update:open', false)
}

const onSubmit = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyErrors

  const call =
    props.shiftId === null
      ? shiftsMainCreate(toShiftCreatePayload(form))
      : shiftsMainUpdate(toShiftUpdatePayload(props.shiftId, form))

  call
    .then(() => {
      ElMessage.success($t(props.shiftId === null ? 'shifts-main.toast.created' : 'shifts-main.toast.updated'))
      emit('saved')
      emit('update:open', false)
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessRuleError) {
        formErrors.value = toShiftFormErrors(error.errors)
        return
      }
      formErrors.value = { ...emptyErrors, generalMessages: [toGeneralFailureMessage(error, $t)] }
    })
    .finally(() => {
      isSubmitting.value = false
    })
}
</script>

<template>
  <ElDialog
    :model-value="open"
    :title="$t(dialogTitleKey)"
    width="720px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:open', $event)"
  >
    <ElSkeleton v-if="isLoadingDetail" :rows="6" animated />
    <ElAlert
      v-else-if="loadFailed"
      type="error"
      show-icon
      :closable="false"
      :title="$t('shifts-main.dialog.load-failed')"
    />

    <ElForm v-else label-position="top" @submit.prevent="onSubmit">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-3"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />

      <div class="grid grid-cols-2 gap-4">
        <ElFormItem :label="$t('shifts-main.field.code')">
          <ElInput v-model="form.code" :disabled="isSubmitting" />
        </ElFormItem>
        <ElFormItem :label="$t('shifts-main.field.name')">
          <ElInput v-model="form.name" :disabled="isSubmitting" />
        </ElFormItem>
        <ElFormItem :label="$t('shifts-main.field.work-type')">
          <!-- 用 ElRadioGroup／ElRadio，不是 ElSelect／ElOption：後者與本專案的
               exactOptionalPropertyTypes 不相容，理由見 ShiftWorkPeriodsEditor.vue 檔頭。 -->
          <ElRadioGroup v-model="form.workTypeCode" :disabled="isSubmitting">
            <ElRadio v-for="code in WORK_TYPE_CODES" :key="code" :value="code" :border="true">
              {{ workTypeLabel(code, $t) }}
            </ElRadio>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem :label="$t('shifts-main.field.flexible')">
          <ElSwitch v-model="form.isFlexible" :disabled="isSubmitting" />
        </ElFormItem>
      </div>

      <ElFormItem :label="$t('shifts-main.field.description')">
        <ElInput v-model="form.description" type="textarea" :rows="2" :disabled="isSubmitting" />
        <p class="mt-1 text-xs text-ink-muted">{{ $t('shifts-main.field.description-hint') }}</p>
      </ElFormItem>

      <ElFormItem :label="$t('shifts-main.field.is-active')">
        <ElSwitch v-model="form.isActive" :disabled="isSubmitting" />
      </ElFormItem>

      <ShiftWorkPeriodsEditor
        v-model="form.workPeriods"
        :errors="formErrors.workPeriodErrors"
        :disabled="isSubmitting"
      />
      <ShiftBreaksEditor v-model="form.breaks" class="mt-4" :errors="formErrors.breakErrors" :disabled="isSubmitting" />

      <ElFormItem class="mt-4" :label="$t('shifts-main.field.required-hours-preview')">
        <span class="font-medium">{{ requiredHoursPreview }}</span>
        <p class="mt-1 text-xs text-ink-muted">{{ $t('shifts-main.field.required-hours-preview-hint') }}</p>
      </ElFormItem>
    </ElForm>

    <template #footer>
      <ElButton :disabled="isSubmitting" @click="onCancel">{{ $t('shifts-main.form.cancel') }}</ElButton>
      <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onSubmit">
        {{ $t('shifts-main.form.submit') }}
      </ElButton>
    </template>
  </ElDialog>
</template>
