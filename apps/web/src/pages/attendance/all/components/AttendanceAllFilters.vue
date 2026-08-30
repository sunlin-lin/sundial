<script setup lang="ts">
/**
 * 全體出勤的查詢條件：年月／部門／人員（本頁私有子元件，§1.5；UI 09「查詢條件」）。
 *
 * 人員選項需要依關鍵字搜尋員工編號或姓名，且選定部門後只顯示該部門員工（UI 09）——這裡直接呼叫
 * `employeesMainList`，不透過頁面轉發：與 `attendance-daily-records` 的
 * `AttendanceDailyRecordsFilters.vue` 是同一種既有慣例（單純唯讀查詢，沒有表單要送出）。
 *
 * **部門變更時清空已選的人員與關鍵字**：人員選項的範圍會跟著部門重新查，理由與
 * `AttendanceDailyRecordsFilters.vue` 相同，不重述。
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElDatePicker, ElForm, ElFormItem, ElInput, ElTreeSelect } from 'element-plus'
import { employeesMainList } from '../../../../api/generated/api-client.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import { toEmployeeOptions, type DepartmentTreeNode, type EmployeeOption } from '../attendance-all.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ departmentTree: readonly DepartmentTreeNode[]; disabled: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const yearMonth = defineModel<string>('yearMonth', { required: true })
const departmentId = defineModel<string | null>('departmentId', { required: true })
const employeeId = defineModel<string | null>('employeeId', { required: true })

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

/** 部門變更：清空人員選取與關鍵字，並通知父層條件變更（回到第 1 頁重新查詢，§7.1）。 */
const onDepartmentChanged = (): void => {
  employeeId.value = null
  employeeKeyword.value = ''
  employeeOptions.value = []
  emit('changed')
}
</script>

<template>
  <ElForm :inline="true" @submit.prevent>
    <ElFormItem :label="$t('attendance-all.filter.year-month')">
      <ElDatePicker
        v-model="yearMonth"
        type="month"
        value-format="YYYY-MM"
        :clearable="false"
        :disabled="disabled"
        @change="emit('changed')"
      />
    </ElFormItem>
    <ElFormItem :label="$t('attendance-all.filter.department')">
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
    <ElFormItem :label="$t('attendance-all.filter.employee')">
      <ElInput
        v-model="employeeKeyword"
        :placeholder="$t('attendance-all.filter.employee-keyword-placeholder')"
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
  </ElForm>
</template>
