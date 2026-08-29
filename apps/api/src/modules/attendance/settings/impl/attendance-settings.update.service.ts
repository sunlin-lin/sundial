/**
 * 業務動作：修改出勤設定——**在這間公司從未存過設定時，本動作等同「建立」**。
 *
 * ## 為什麼只有一支 `update`，沒有另一支 `create`
 *
 * `attendance_settings` 是「一間公司一筆」的單例表（完整推論見 `db/schema/
 * attendance-settings.ts` 檔頭）：沒有 `code` 可以指認「新增的是哪一筆」，也沒有 `list` 需要
 * 「新增一筆到清單裡」。使用者在畫面上看到的永遠是同一份表單——第一次填寫與之後修改，
 * 對使用者而言是同一個動作（「儲存我們公司的打卡規則」），只是伺服器這一側剛好知道
 * 「這是第一次還是第 N 次」。開兩支端點會製造一個假選擇：前端得先查一次 `get` 才知道該呼叫
 * `create` 還是 `update`，而 `get` 剛好回 `null` 又剛好在那個瞬間被別人建立的競態視窗依然存在
 * ——不如讓伺服器自己決定，前端永遠呼叫同一支。
 *
 * ## 併發：唯一鍵擋，不需要 `SELECT ... FOR UPDATE`
 *
 * 這與 `job-position-histories`／`labor-pension` 那種「鎖 `employee_employments` 再做期間
 * 重疊檢查」的併發問題**不是同一類**：那裡的重複判定需要跨列比較日期區間，唯一鍵表達不出來，
 * 必須先鎖住相關列才能讓後續的一般查詢讀到「鎖定後」的資料。這裡的規則單純到唯一鍵就能完整
 * 表達——「一間公司只能有一筆」是 `uq_attendance_settings_company_id` 自己能保證的事，
 * 不需要應用層另外用鎖去重建同一個保證。
 *
 * 兩個人同時對**還沒有存過設定**的公司第一次送出本動作：都在下面查到 `existing === null`，
 * 都嘗試 insert；先到的成功，後到的撞唯一鍵，`insertAttendanceSettings` 回傳
 * `'duplicate-company'`，這裡轉成一個可重試的衝突錯誤（比照 `departments` 代碼重複的處置：
 * 不是系統錯誤，重新整理、重新送出就會成功——此時公司已經有設定了，會走下面的更新分支）。
 *
 * 已經有設定之後的一般更新，兩個人前後幾秒各自儲存，後寫覆蓋先寫是預期行為，不是需要偵測的
 * 併發衝突（`impl/attendance-settings.update-profile.repository.ts` 檔頭已說明理由）。
 *
 * ## 稽核：整表 `value` 級（計畫 §4.6 定案）
 *
 * `before` 在建立分支固定為 `null`（與 `labor-pension-main.create.service.ts` 同一種形狀）；
 * 更新分支則是既有那一筆的完整快照，`buildAuditChanges` 只會挑出真的變動的欄位（`audit-
 * change-set.ts` 的比對邏輯）。兩個分支共用同一個 `action`（`attendance.settings.update`）
 * ——這支端點只有一個，稽核紀錄的 `changes` 本身就能回答「這是第一次填寫還是後續修改」
 * （`before: null` 一望即知），不需要為此另外設計動作碼。
 *
 * **本檔不開交易**：`upsertAttendanceSettingsInTransaction` 只收外部交易 handle
 * （`TransactionRunner`，`db/client.ts`），開交易的包裝在入口檔的 `upsertAttendanceSettings`。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceSettingsContext } from '../domain/attendance-settings-context.ts'
import type {
  AttendanceSettingsAuditSnapshot,
  AttendanceSettingsDetail,
  UpdateAttendanceSettingsInput,
} from '../domain/attendance-settings-model.ts'
import { attendanceSettingsConcurrentlyInitialized } from '../attendance-settings.errors.ts'
import {
  findAttendanceSettings,
  insertAttendanceSettings,
  updateAttendanceSettingsProfile,
} from '../attendance-settings.repository.ts'

const toAuditSnapshot = (input: UpdateAttendanceSettingsInput): AttendanceSettingsAuditSnapshot => ({
  requireClockInBeforeClockOut: input.requireClockInBeforeClockOut,
  allowEmployeeCancellation: input.allowEmployeeCancellation,
  allowCorrectionRequest: input.allowCorrectionRequest,
  correctionRequiresApproval: input.correctionRequiresApproval,
  gpsEnabled: input.gpsEnabled,
  gpsRequired: input.gpsRequired,
})

export const upsertAttendanceSettingsInTransaction = async (
  tx: TransactionRunner,
  context: AttendanceSettingsContext,
  input: UpdateAttendanceSettingsInput,
): Promise<ServiceResult<AttendanceSettingsDetail>> => {
  const now = context.clock.now()
  const after = toAuditSnapshot(input)
  const existing = await findAttendanceSettings(tx, context.companyId)

  if (existing === null) {
    const id = crypto.randomUUID()
    const outcome = await insertAttendanceSettings(tx, context.companyId, { id, ...input, now })
    if (outcome === 'duplicate-company') return fail([attendanceSettingsConcurrentlyInitialized()])

    await recordAudit(tx, {
      companyId: context.companyId,
      actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
      action: 'attendance.settings.update',
      subjectTable: 'attendance_settings',
      subjectId: id,
      changes: buildAuditChanges('attendance_settings', null, after),
      effectiveDate: null,
      now,
    })

    return succeed({ id, ...input, createdAt: now, updatedAt: now })
  }

  const before = toAuditSnapshot(existing)
  await updateAttendanceSettingsProfile(tx, context.companyId, existing.id, { ...input, now })

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'attendance.settings.update',
    subjectTable: 'attendance_settings',
    subjectId: existing.id,
    changes: buildAuditChanges('attendance_settings', before, after),
    effectiveDate: null,
    now,
  })

  return succeed({ id: existing.id, ...input, createdAt: existing.createdAt, updatedAt: now })
}
