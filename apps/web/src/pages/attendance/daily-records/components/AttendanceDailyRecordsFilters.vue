<script setup lang="ts">
/**
 * 每日全員打卡明細的查詢條件：日期／部門／人員／狀態（本頁私有子元件，§1.5；UI 23「查詢條件」）。
 *
 * **「狀態」查詢條件用 `ElRadioGroup`，不用 `ElSelect`＋`ElOption`**：選項只有「全部／只看有效／
 * 只看已撤銷」三個、彼此互斥、永遠有一個被選取，`ElRadio` 屬於「選項少」的既有選型（skill
 * §1.6）。這裡也沒有踩到 §1.7 的地雷——`ElRadioGroup.modelValue` 不接受 `null`／`undefined`，
 * 但這裡的「全部」本身就是一個真正的預設業務值（不是「使用者還沒選」的哨兵），欄位一律有值，
 * 不需要另外發明哨兵。UI 23 特別強調：這個「只看已撤銷」是篩選，不是控制已撤銷紀錄顯不顯示的
 * 開關（已撤銷紀錄預設就顯示在列表中），因此**不與任何顯示開關合併**，維持獨立的一個查詢條件。
 *
 * 人員選項需要依關鍵字搜尋員工編號或姓名，且選定部門後只顯示該部門員工（UI 23）——**這裡自己
 * 直接呼叫 `employeesMainList`**，不透過頁面轉發：這是一個單純的唯讀查詢（沒有表單要送出、
 * 沒有欄位要標紅），與 `ShiftListTable.vue` 對簡單動作「直接在元件內呼叫 API」的既有慣例相同。
 *
 * **部門變更時清空已選的人員與關鍵字**：人員選項的範圍會跟著部門重新查，先前選的人員可能已經
 * 不在新範圍內，留著等於顯示一個使用者以為還套用中、實際上跟畫面看到的部門篩選對不上的選取值。
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElDatePicker, ElForm, ElFormItem, ElInput, ElRadio, ElRadioGroup, ElTreeSelect } from 'element-plus'
import { employeesMainList } from '../../../../api/generated/api-client.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { toEmployeeOptions, type DepartmentTreeNode, type EmployeeOption } from '../attendance-daily-records.view.ts'
import type { AttendanceDailyRecordStatusFilter } from '../attendance-daily-records.payload.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ departmentTree: readonly DepartmentTreeNode[]; disabled: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const date = defineModel<string>('date', { required: true })
const departmentId = defineModel<string | null>('departmentId', { required: true })
const employeeId = defineModel<string | null>('employeeId', { required: true })
const status = defineModel<AttendanceDailyRecordStatusFilter>('status', { required: true })

const employeeKeyword = ref('')
const employeeOptions = ref<EmployeeOption[]>([])
const isSearchingEmployees = ref(false)

const EMPLOYEE_SEARCH_DEBOUNCE_MS = 300
const EMPLOYEE_SEARCH_PAGE_SIZE = 20
let searchTimer: ReturnType<typeof setTimeout> | null = null

const searchEmployees = (): void => {
  const keyword = employeeKeyword.value.trim()
  if (keyword === '') {
    employeeOptions.value = []
    return
  }

  isSearchingEmployees.value = true
  employeesMainList({
    keyword,
    ...(departmentId.value === null ? {} : { departmentId: departmentId.value }),
    currentPage: 1,
    perPage: EMPLOYEE_SEARCH_PAGE_SIZE,
  })
    .then((page) => {
      employeeOptions.value = toEmployeeOptions(page.data)
      isSearchingEmployees.value = false
    })
    .catch(() => {
      // 唯讀查詢失敗只清空選項，不擋住整頁——使用者可以清掉關鍵字重打，或直接不使用人員篩選。
      employeeOptions.value = []
      isSearchingEmployees.value = false
    })
}

watch(employeeKeyword, () => {
  if (searchTimer !== null) clearTimeout(searchTimer)
  searchTimer = setTimeout(searchEmployees, EMPLOYEE_SEARCH_DEBOUNCE_MS)
})

/** 部門變更：清空人員選取與關鍵字（見檔頭），並通知父層條件變更（回到第 1 頁重新查詢，§7.1）。 */
const onDepartmentChanged = (): void => {
  employeeId.value = null
  employeeKeyword.value = ''
  employeeOptions.value = []
  emit('changed')
}
</script>

<template>
  <ElForm :inline="true" @submit.prevent>
    <ElFormItem :label="$t('attendance-daily-records.filter.date')">
      <ElDatePicker
        v-model="date"
        type="date"
        value-format="YYYY-MM-DD"
        :clearable="false"
        :disabled="disabled"
        @change="emit('changed')"
      />
    </ElFormItem>
    <ElFormItem :label="$t('attendance-daily-records.filter.department')">
      <ElTreeSelect
        v-model="departmentId"
        :data="[...departmentTree]"
        node-key="id"
        :props="{ label: 'name', children: 'children' }"
        :disabled="disabled"
        clearable
        filterable
        class="w-56"
        @change="onDepartmentChanged"
      />
    </ElFormItem>
    <ElFormItem :label="$t('attendance-daily-records.filter.employee')">
      <ElInput
        v-model="employeeKeyword"
        :placeholder="$t('attendance-daily-records.filter.employee-keyword-placeholder')"
        clearable
        :disabled="disabled"
        class="w-48"
      />
      <ElTreeSelect
        v-model="employeeId"
        :data="employeeOptions"
        node-key="id"
        :props="{ label: 'label' }"
        :disabled="disabled"
        :loading="isSearchingEmployees"
        clearable
        class="ml-2 w-56"
        @change="emit('changed')"
      />
    </ElFormItem>
    <ElFormItem :label="$t('attendance-daily-records.filter.status')">
      <ElRadioGroup v-model="status" :disabled="disabled" @change="emit('changed')">
        <ElRadio value="all">{{ $t('attendance-daily-records.filter.status-all') }}</ElRadio>
        <ElRadio value="active">{{ $t('attendance-daily-records.filter.status-active') }}</ElRadio>
        <ElRadio value="revoked">{{ $t('attendance-daily-records.filter.status-revoked') }}</ElRadio>
      </ElRadioGroup>
    </ElFormItem>
  </ElForm>
</template>
