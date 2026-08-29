<script setup lang="ts">
/**
 * §3.5 帳號與角色：角色指派（本頁私有子元件，§1.5）。
 *
 * 角色清單（`company-users/roles/list`，只看未撤銷的）與可指派角色字典（`roles/main/list`，
 * 只查啟用中的角色）一起載入一次；指派或撤銷成功後只重新載入角色清單——可指派角色字典不會因為
 * 這個帳號的指派變動而變動，沒有理由重查一次。
 *
 * **禁止移除最後一個角色**（UI 定案 §3.5）：畫面上先擋一次（`canRevokeRole` 只在剩餘角色數 > 1
 * 時允許按下「移除」，停用時搭配 tooltip 說明原因，§3.3），但真正的判定在後端同一筆交易內以
 * 鎖定列 ＋ 條件式 UPDATE 完成（`role-assignment-plan.ts` 的 `planRoleRevocation`）——前端這一半
 * 只是不讓使用者按一顆通常會被拒絕的按鈕，不能取代後端；兩個分頁／兩個人同時各自嘗試撤掉
 * 對方看不到的最後一個角色時，後端仍然是唯一真正擋下來的地方，因此撤銷失敗時仍然把後端回來的
 * 訊息（`company-users.roles.errors.last-role-required`）原樣顯示在角色清單上方，不是一句
 * 「移除失敗」帶過（見下方 `onRevoke`）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElMessage,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTooltip,
  ElTreeSelect,
} from 'element-plus'
import {
  companyUsersRolesCreate,
  companyUsersRolesList,
  companyUsersRolesRevoke,
  rolesMainList,
} from '../../../../api/generated/api-client.ts'
import { BusinessRuleError } from '../../../../shared/api/api-error.ts'
import { isListEcho } from '../../../../shared/api/list-echo.ts'
import { toLoadFailure, type LoadFailure } from '../../../../shared/api/load-failure.ts'
import { formatDateTime } from '../../../../shared/format/business-date.ts'
import type { TranslateMessage } from '../../../../shared/i18n/messages.ts'
import type { PermissionCode } from '../../../../shared/permission/permission-code.ts'
import { canAssignRole, canRevokeRole, canSubmitRoleAssignForm } from '../employees-detail.actions.ts'
import {
  emptyFormErrors,
  firstErroredElementId,
  formItemErrorProp,
  toFormErrors,
  toGeneralFailureMessage,
  type FormErrors,
} from '../employees-detail.errors.view.ts'
import {
  emptyRoleAssignFormState,
  toRoleAssignmentListQuery,
  toRoleAssignPayload,
  toRoleRevokePayload,
} from '../employees-detail.payload.ts'
import { assignableRoleOptions, type AssignableRoleItem, type RoleAssignmentItem } from '../employees-detail.view.ts'

const { t } = useI18n()
const $t: TranslateMessage = t

const props = defineProps<{ companyUserId: string; can: (code: PermissionCode) => boolean }>()

/** 一次抓滿：一家公司啟用中的角色是個位數到數十個（`company-users-roles.routes.ts` 的 `MAX_ROLE_IDS` 註解同構）。 */
const ROLE_DICTIONARY_PAGE_SIZE = 100

const assignments = ref<RoleAssignmentItem[]>([])
const allRoles = ref<AssignableRoleItem[]>([])
const isLoading = ref(false)
const failure = ref<LoadFailure | null>(null)
let requestSequence = 0

const load = (): void => {
  requestSequence += 1
  const thisRequest = requestSequence
  const query = toRoleAssignmentListQuery(props.companyUserId, 1)

  isLoading.value = true
  failure.value = null

  Promise.all([
    companyUsersRolesList(query),
    rolesMainList({ currentPage: 1, perPage: ROLE_DICTIONARY_PAGE_SIZE, status: 'ACTIVE' }),
  ])
    .then(([page, roles]) => {
      if (thisRequest !== requestSequence) return
      if (!isListEcho(page, query)) return
      assignments.value = [...page.data]
      allRoles.value = [...roles.data]
      isLoading.value = false
    })
    .catch((error: unknown) => {
      if (thisRequest !== requestSequence) return
      assignments.value = []
      allRoles.value = []
      failure.value = toLoadFailure(error)
      isLoading.value = false
    })
}

const onRetry = (): void => {
  load()
}

// `ElTreeSelect` 的 `data` prop 要求可變陣列（`TreeData`）；`assignableRoleOptions` 回傳
// `readonly` 陣列（純函式的慣例回傳型別，方便測試斷言 `toEqual`），這裡用展開淺拷貝一份。
const assignableOptions = computed(() => [...assignableRoleOptions(allRoles.value, assignments.value)])
const hasRevokePermission = computed(() => props.can('company-users.roles.revoke'))
const canRevokeNow = computed(() => canRevokeRole(props.can, assignments.value.length))

// --- 新增角色 ---------------------------------------------------------------------------

type FieldKey = 'roleIds'
const KNOWN_FIELD_KEYS: readonly FieldKey[] = ['roleIds']
const ELEMENT_ID: Record<FieldKey, string> = { roleIds: 'account-roles-field-role-ids' }

const form = reactive(emptyRoleAssignFormState())
const isSubmitting = ref(false)
const formErrors = ref<FormErrors<FieldKey>>(emptyFormErrors())

const canAssign = computed(() => canAssignRole(props.can))
const canSubmit = computed(() => canSubmitRoleAssignForm({ isSubmitting: isSubmitting.value, form }))

const onAssign = (): void => {
  if (!canSubmit.value) return

  isSubmitting.value = true
  formErrors.value = emptyFormErrors()

  companyUsersRolesCreate(toRoleAssignPayload(props.companyUserId, form))
    .then(() => {
      ElMessage.success($t('employees-detail.account.toast.role-assigned'))
      Object.assign(form, emptyRoleAssignFormState())
      load()
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessRuleError) {
        const result = toFormErrors(error.errors, KNOWN_FIELD_KEYS)
        formErrors.value = result
        const targetId = firstErroredElementId(result, KNOWN_FIELD_KEYS, ELEMENT_ID)
        if (targetId !== undefined) {
          document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        return
      }
      formErrors.value = { fieldErrors: new Map(), generalMessages: [toGeneralFailureMessage(error, $t)] }
    })
    .finally(() => {
      isSubmitting.value = false
    })
}

// --- 移除角色 ---------------------------------------------------------------------------

const revokingRoleId = ref<string | null>(null)
/** 撤銷失敗時的訊息，原樣顯示後端每一則 `msg`（§6.3 保底路徑：這裡沒有可以就地標紅的表單欄位）。 */
const revokeErrorMessages = ref<readonly string[]>([])

const onRevoke = (roleId: string): void => {
  if (!canRevokeNow.value || revokingRoleId.value !== null) return

  revokingRoleId.value = roleId
  revokeErrorMessages.value = []

  companyUsersRolesRevoke(toRoleRevokePayload(props.companyUserId, roleId))
    .then(() => {
      ElMessage.success($t('employees-detail.account.toast.role-revoked'))
      load()
    })
    .catch((error: unknown) => {
      revokeErrorMessages.value =
        error instanceof BusinessRuleError ? error.errors.map((item) => item.msg) : [toGeneralFailureMessage(error, $t)]
    })
    .finally(() => {
      revokingRoleId.value = null
    })
}

onMounted(() => {
  load()
})
</script>

<template>
  <section>
    <h3 class="text-sm font-semibold text-ink">{{ $t('employees-detail.account.section.roles') }}</h3>

    <ElAlert
      v-if="failure?.kind === 'permission-denied'"
      class="mt-2"
      type="error"
      show-icon
      :closable="false"
      :title="failure.message"
    />
    <div v-else-if="failure !== null" class="mt-2">
      <ElAlert type="error" show-icon :closable="false" :title="$t('error.system')" />
      <ElButton class="mt-2" :loading="isLoading" @click="onRetry">{{ $t('employees-detail.retry') }}</ElButton>
    </div>
    <ElSkeleton v-else-if="isLoading" class="mt-2" :rows="3" animated />
    <ElEmpty
      v-else-if="assignments.length === 0"
      class="mt-2"
      :description="$t('employees-detail.account.roles-empty')"
    />
    <div v-else class="mt-2">
      <ElAlert
        v-for="(message, index) in revokeErrorMessages"
        :key="index"
        class="mb-2"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />
      <ElTable :data="assignments" row-key="id" :border="true" size="small">
        <ElTableColumn :label="$t('employees-detail.account.column.role')">
          <template #default="scope">{{ scope.row['roleName'] }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.account.column.assigned-at')" width="160">
          <template #default="scope">{{ formatDateTime(scope.row['assignedAt']) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.account.column.assigned-by')" width="140">
          <template #default="scope">{{ scope.row['assignedByName'] }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('employees-detail.employment.column.action')" width="100">
          <template #default="scope">
            <ElTooltip
              v-if="hasRevokePermission && !canRevokeNow"
              :content="$t('employees-detail.account.hint.last-role')"
            >
              <span>
                <ElButton size="small" disabled>{{ $t('employees-detail.account.action.revoke') }}</ElButton>
              </span>
            </ElTooltip>
            <ElButton
              v-else-if="hasRevokePermission"
              size="small"
              type="danger"
              :loading="revokingRoleId === scope.row['roleId']"
              :disabled="revokingRoleId !== null"
              @click="onRevoke(scope.row['roleId'])"
            >
              {{ $t('employees-detail.account.action.revoke') }}
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <ElForm v-if="canAssign" class="mt-4" :inline="true" @submit.prevent="onAssign">
      <ElAlert
        v-for="(message, index) in formErrors.generalMessages"
        :key="index"
        class="mb-2 w-full"
        type="error"
        show-icon
        :closable="false"
        :title="message"
      />
      <ElFormItem
        v-bind="formItemErrorProp(formErrors, 'roleIds')"
        :id="ELEMENT_ID.roleIds"
        :label="$t('employees-detail.account.field.role-ids')"
      >
        <ElTreeSelect
          v-model="form.roleIds"
          :data="assignableOptions"
          multiple
          show-checkbox
          node-key="id"
          :props="{ label: 'name' }"
          :disabled="isSubmitting"
          filterable
          class="w-64"
        />
      </ElFormItem>
      <ElFormItem>
        <ElButton type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="onAssign">
          {{ $t('employees-detail.account.action.assign') }}
        </ElButton>
      </ElFormItem>
    </ElForm>
  </section>
</template>
