<script setup lang="ts">
/**
 * §3.3 組織資料（本頁私有子元件，§1.5）。
 *
 * **組織異動掛在「目前在職中的任職」底下**：部門／職稱／職務歷史都是 `employmentId` 範圍的資料
 * （UI 定案本身沒有明講「異動屬於哪一段任職」，這是本頁依 schema 形狀做的判斷——組織資料本來就是
 * 「在職期間」的屬性，員工離職後不會再有新的組織異動，回任後的組織資料屬於新的那段任職）。
 * 沒有在職中的任職（剛離職、尚未回任）時，這個分頁沒有掛載對象，顯示說明訊息，不硬挑一段舊任職。
 *
 * 部門樹／職稱／職務三份字典在這裡自己載入一次（不從 `.page.vue` 往下傳）：只有這個分頁用得到，
 * 理由與 `ShiftFormDialog.vue` 自己打 API 同構——沒有第二個消費者，不需要拉到更上層共用。
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElAlert, ElButton, ElSkeleton } from 'element-plus'
import { departmentsMainTree, jobPositionsMainList, jobTitlesMainList } from '../../../../api/generated/api-client.ts'
import { toLoadFailure, type LoadFailure } from '../../../../shared/api/load-failure.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import {
  activeOnly,
  type DepartmentTreeNode,
  type EmploymentItem,
  type JobDictionaryItem,
} from '../employees-detail.view.ts'
import DepartmentHistorySection from './DepartmentHistorySection.vue'
import JobPositionHistorySection from './JobPositionHistorySection.vue'
import JobTitleHistorySection from './JobTitleHistorySection.vue'

const { t } = useI18n()
const $t: TranslateMessage = t

defineProps<{ activeEmployment: EmploymentItem | null; can: (code: PermissionCode) => boolean }>()

/** 字典清單一次最多抓 100 筆，理由與 `employees-onboarding.page.vue` 的 `DICTIONARY_PAGE_SIZE` 相同。 */
const DICTIONARY_PAGE_SIZE = 100

const departmentTree = ref<DepartmentTreeNode[]>([])
const jobTitleOptions = ref<JobDictionaryItem[]>([])
const jobPositionOptions = ref<JobDictionaryItem[]>([])
const isLoadingDictionaries = ref(false)
const dictionariesFailure = ref<LoadFailure | null>(null)

const loadDictionaries = (): void => {
  isLoadingDictionaries.value = true
  dictionariesFailure.value = null

  Promise.all([
    departmentsMainTree({}),
    jobTitlesMainList({ currentPage: 1, perPage: DICTIONARY_PAGE_SIZE }),
    jobPositionsMainList({ currentPage: 1, perPage: DICTIONARY_PAGE_SIZE }),
  ])
    .then(([departments, jobTitles, jobPositions]) => {
      departmentTree.value = [...departments]
      jobTitleOptions.value = [...activeOnly(jobTitles.data)]
      jobPositionOptions.value = [...activeOnly(jobPositions.data)]
      isLoadingDictionaries.value = false
    })
    .catch((error: unknown) => {
      dictionariesFailure.value = toLoadFailure(error)
      isLoadingDictionaries.value = false
    })
}

const onRetry = (): void => {
  loadDictionaries()
}

onMounted(() => {
  loadDictionaries()
})
</script>

<template>
  <section>
    <ElAlert
      v-if="dictionariesFailure?.kind === 'permission-denied'"
      type="error"
      show-icon
      :closable="false"
      :title="dictionariesFailure.message"
    />
    <div v-else-if="dictionariesFailure !== null">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-4" :loading="isLoadingDictionaries" @click="onRetry">{{
        $t('employees-detail.retry')
      }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoadingDictionaries" :rows="6" animated />

    <ElAlert
      v-else-if="activeEmployment === null"
      type="info"
      show-icon
      :closable="false"
      :title="$t('employees-detail.organization.no-active-employment')"
    />

    <div v-else class="space-y-6">
      <p class="text-xs text-ink-muted">{{ $t('employees-detail.organization.hint') }}</p>
      <DepartmentHistorySection :employment-id="activeEmployment.id" :department-tree="departmentTree" :can="can" />
      <JobTitleHistorySection :employment-id="activeEmployment.id" :job-title-options="jobTitleOptions" :can="can" />
      <JobPositionHistorySection
        :employment-id="activeEmployment.id"
        :job-position-options="jobPositionOptions"
        :can="can"
      />
    </div>
  </section>
</template>
