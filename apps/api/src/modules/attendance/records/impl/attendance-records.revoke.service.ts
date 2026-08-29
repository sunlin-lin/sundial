/**
 * 業務動作：本人撤銷自己的打卡（軟刪除，不寫稽核，計畫 §4.3、§4.3.1）。
 *
 * **範圍來自 token 推出的身分，不是 request body**：input 只有 `recordId`／`reason`，
 * **不接受呼叫端指定 `employeeId`**——比照 `sessions-main.logout-all.service.ts` 的先例。
 * 撈出這筆記錄後比對它的 `employee_id` 是否等於「目前登入身分透過 `company_users → employee_id`
 * 推出的本人」，不相等就視同找不到這筆記錄（回同一則 `not-found`），不讓呼叫端從錯誤訊息分辨出
 * 「這筆記錄存在、只是不是你的」。
 *
 * **檢查順序**：公司是否允許員工自行撤銷（`allow_employee_cancellation`，交易外先查，見下方
 * 「撤銷開關」段落）→ 目標存在且是本人 → 尚未撤銷 → 若是上班卡，其後是否已有有效下班卡（字典
 * 「已確認的 Dashboard 打卡與撤銷」：需先撤銷下班卡）→ 該工作日是否已被薪資結算鎖定
 * （`isPeriodLocked` 樁，見 `domain/attendance-record-period-lock.ts`）→ 條件式 `UPDATE`。
 *
 * ## 撤銷開關：`attendance_settings.allow_employee_cancellation`
 *
 * **這是 Stage 5 補回來的檢查，Stage 3 完全漏掉**：UI 10「本流程符合
 * `attendance_settings.allow_employee_cancellation`」與前端規範 §4.2「前端隱藏 ≠ 權限控制」都
 * 明講這一條，但這支 service 原本的檢查順序只有「本人／未撤銷／下班卡優先／薪資鎖定」四項，完全
 * 沒有讀這個開關——公司在設定頁把它關掉之後，員工直接呼叫這支端點照樣撤銷成功，只有前端擋，
 * 是一個安全缺口，不是遺漏文件。
 *
 * **只用在這支（`revoke`，本人），不用在 `revoke-other`（他人）**：這個欄位命名是
 * `allow_EMPLOYEE_cancellation`，字面上管的是「員工」自行撤銷這條自助路徑，不是具審核權限的
 * 人事／主管代為撤銷。`revoke-other` 已經有自己獨立的權限碼 `attendance.records.revoke-other`
 * 把關——公司關掉員工自助撤銷，語意上更接近「這類更正一律收斂到人事審核」，而不是「連人事都不能
 * 碰」，因此 `revoke-other` 不受這個開關約束，繼續只靠它自己的權限碼把關。
 *
 * **沒有 `attendance_settings` 列時（`get` 回 `null`，Stage 2 定案「不回預設值，消費端自己決定」）
 * ——本檔選擇視同「允許」（不擋）**：理由是這支自我撤銷邏輯在本開關存在之前就已經無條件開放，
 * `create.service.ts` 對其餘兩個沒有文件明講預設值的開關（`requireClockInBeforeClockOut`／
 * `gpsRequired`）也是各自依字典「本次定案」給一個具體預設值，不是統一「沒設定就擋」；改成
 * 「沒設定就擋」會讓所有還沒進過設定頁的既有公司一夜之間全面關閉員工自我更正，且沒有任何一次
 * 明確的管理動作觸發這個改變。反面（「沒設定就擋」）的好處是行為更保守，代價是造成前後不一致的
 * 使用者衝擊；本檔判斷撤銷自己的打卡是自我更正而非越權，不是需要保守以對的敏感操作，因此選擇
 * 「沒設定＝維持既有的開放行為」，直到公司真的去設定頁把它關掉為止。
 *
 * **不寫 `audit_logs`**：`revoked_by`／`revoked_at`／`revoke_reason` 三欄已完整回答「誰、何時、
 * 為何撤銷」，本人對自己資料的軟刪除性質上是自我更正（計畫 §4.6）。
 *
 * **不需要 `FOR UPDATE`**：撤銷是條件式 `UPDATE`（`WHERE revoked_at IS NULL AND id = ?`），
 * 影響列數為 0 就回衝突，不需要額外上鎖（計畫 §4.5）。
 *
 * **撤銷成功後，在同一筆交易內呼叫 Stage 4 的重算**（計畫 §4.3.1：兩種撤銷之後都要重算
 * `attendance_results`，沒有差別；09／10 的驗收明文要求）。呼叫 `recalculateAttendanceResultForWorkDay`
 * 而不是自己開一筆新交易——撤銷與重算若各自開交易，會出現「撤銷已 COMMIT、重算那筆交易卻失敗」
 * 的縫隙，見該函式檔頭。直接 import 同一個大目錄底下 `results` 次目錄的 `*.service.ts`，不經過
 * `modules/attendance/index.ts`（那是給其他大目錄用的出口），比照本檔已經在用的
 * `../../settings/attendance-settings.service.ts` 同一種同大目錄內的引用方式。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { AttendanceTypeCode } from '../../../../db/schema/index.ts'
import { getAttendanceSettings } from '../../settings/attendance-settings.service.ts'
import { recalculateAttendanceResultForWorkDay } from '../../results/attendance-results.service.ts'
import { isPeriodLocked } from '../domain/attendance-record-period-lock.ts'
import type { AttendanceRecordsContext } from '../domain/attendance-record-context.ts'
import type { AttendanceRecordDetail, RevokeOwnAttendanceRecordInput } from '../domain/attendance-record-model.ts'
import {
  attendanceRecordAlreadyRevoked,
  attendanceRecordCancellationNotAllowed,
  attendanceRecordClockOutMustBeRevokedFirst,
  attendanceRecordNotFound,
  attendanceRecordPeriodLocked,
} from '../attendance-records.errors.ts'
import {
  findAttendanceRecordDetail,
  findEmployeeIdForCompanyUser,
  findValidPunchOnDate,
  markAttendanceRecordRevoked,
} from '../attendance-records.repository.ts'

const revokeOwnAttendanceRecordInTransaction = async (
  tx: TransactionRunner,
  context: AttendanceRecordsContext,
  input: RevokeOwnAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => {
  const now = context.clock.now()

  const [requesterEmployeeId, record] = await Promise.all([
    findEmployeeIdForCompanyUser(tx, context.companyId, context.operatorCompanyUserId),
    findAttendanceRecordDetail(tx, context.companyId, input.recordId),
  ])

  // 目標不存在，或存在但不是呼叫者本人的——回同一則錯誤（見檔頭）。
  if (record === null || requesterEmployeeId === null || record.employeeId !== requesterEmployeeId) {
    return fail([attendanceRecordNotFound()])
  }
  if (record.revokedAt !== null) return fail([attendanceRecordAlreadyRevoked()])

  if (record.attendanceTypeCode === AttendanceTypeCode.ClockIn) {
    const dependentClockOut = await findValidPunchOnDate(
      tx,
      context.companyId,
      record.employmentId,
      record.workDate,
      AttendanceTypeCode.ClockOut,
    )
    if (dependentClockOut !== null) return fail([attendanceRecordClockOutMustBeRevokedFirst()])
  }

  // ★ 這是一根樁，不是真的檢查——見 `domain/attendance-record-period-lock.ts` 檔頭。
  if (isPeriodLocked(context.companyId, record.workDate)) return fail([attendanceRecordPeriodLocked()])

  const affectedRows = await markAttendanceRecordRevoked(tx, context.companyId, input.recordId, {
    revokedBy: context.operatorCompanyUserId,
    revokeReason: input.reason,
    revokedSeq: context.clock.epochMs(),
    now,
  })
  if (affectedRows === 0) return fail([attendanceRecordAlreadyRevoked()])

  // ★ 同一筆交易內重算（見檔頭）：撤銷影響的是 record.employeeId／record.workDate 這一天的判定，
  // 不是撤銷者自己的今天——撤銷本人過去某一天的打卡時，重算對象一樣是那一天，不是「現在」。
  await recalculateAttendanceResultForWorkDay(
    tx,
    context.companyId,
    { employeeId: record.employeeId, workDate: record.workDate },
    now,
  )

  const updated = await findAttendanceRecordDetail(tx, context.companyId, input.recordId)
  if (updated === null) {
    throw new Error(`打卡記錄 ${input.recordId} 撤銷後於同一交易內讀不回來`)
  }
  return succeed(updated)
}

export const revokeOwnAttendanceRecord = async (
  context: AttendanceRecordsContext,
  input: RevokeOwnAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => {
  // 讀出勤設定：交易外的一般查詢（§3.4「唯讀檢查放在交易之前」），比照 `create.service.ts` 同一種
  // 安排——`attendance/settings` 的 context 要的是連線池（`Database`），不是交易物件
  // （`AttendanceSettingsContext.db: Database`，`TransactionRunner` 型別上不滿足它），這個檢查
  // 也不需要交易內的一致性讀快照，放在交易外查一次即可。
  const settingsResult = await getAttendanceSettings({
    db: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  })
  if (!settingsResult.ok) {
    // `attendance.settings.get` 宣告的業務錯誤清單是空陣列——走得到這裡代表程式假設被打破，
    // 是系統錯誤而不是業務拒絕（§3.1.2），比照 `create.service.ts` 同一種處理方式。
    throw new Error('查詢出勤設定失敗，但 attendance.settings.get 理論上不會回傳業務錯誤')
  }
  // 沒有設定列時視同「允許」——理由見檔頭「撤銷開關」段落。
  const allowEmployeeCancellation = settingsResult.value?.allowEmployeeCancellation ?? true
  // ★ 撤銷開關：不牽涉任何一筆特定記錄，交易外先擋，連交易都不必開。
  if (!allowEmployeeCancellation) return fail([attendanceRecordCancellationNotAllowed()])

  return context.db.transaction((tx) => revokeOwnAttendanceRecordInTransaction(tx, context, input))
}
