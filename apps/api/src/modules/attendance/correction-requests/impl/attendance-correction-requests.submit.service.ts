/**
 * 業務動作：員工提交補打卡申請（UI 13「新增申請」）。
 *
 * **範圍來自 token 推出的身分，不是 request body**：input 沒有 `employeeId`／`employmentId`
 * ——比照 `attendance/records` 的 `create`／`revoke`。
 *
 * ## 檢查順序（UI 13「送出檢查」＋字典「已確認流程與約束」）
 *
 * 1. 不可選擇未來日期。
 * 2. 操作者必須連結有效員工與任職（否則不知道這筆申請歸屬誰）。
 * 3. 公司是否允許申請補登（`attendance_settings.allow_correction_request`）——**這是比照
 *    `attendance-records.revoke.service.ts` 檔頭「Stage 5 補回的檢查」記取的教訓，從一開始就
 *    做這一步，不要等漏掉之後才回頭補**：這個開關存在的意義就是讓公司能整個關閉補打卡功能，
 *    若這裡不查，前端隱藏入口只是「看不到」，直接呼叫端點仍然能送出申請。
 *    **沒有設定列時視同「允許」**：理由與 `allowEmployeeCancellation` 相同
 *    （見 `attendance-records.revoke.service.ts` 檔頭「撤銷開關」段落）——這個功能在開關存在之前
 *    就是無條件開放的既有行為，沒有一次明確的管理動作把它關掉之前，不該讓「還沒進過設定頁」的
 *    公司一夜之間全面停用。
 * 4. 該工作日是否已被薪資結算鎖定（`isPeriodLocked` 樁）。
 * 5. 這個工作日、這個類型是否已有一張有效打卡（`attendance_records`）——已經打過卡就不需要補登。
 *    同時檢查補登時間與同一工作日另一種類型的有效打卡是否符合基本先後關係（上班應早於下班、
 *    下班應晚於上班）；沒有另一種類型的有效打卡時，這一步無從比較，直接略過（不是自己與自己比）。
 * 6. 這個工作日、這個類型是否已有一筆待審核申請（預檢查＋唯一鍵最終攔截，見 `domain/
 *    attendance-correction-request-duplicate.ts`）。
 *
 * **查有效打卡走 `attendance/records` 的 service，不是裸 repository**：`listOwnAttendanceRecordsByDate`
 * 已經在 `attendance-records.service.ts`（service 入口）匯出，屬於同一個大目錄下次目錄之間
 * 「可以互相 import，但只能透過對方的 service」的合法路徑（`sundial-backend` skill
 * module-layout §3），與本檔另外幾支複製的小函式（`find-operator-employment.repository.ts`
 * 等）不是同一類——那幾支是 `records` 沒有在 service 入口匯出的內部細節，這裡則是它本來就已經
 * 對外開放的查詢動作，直接引用即可，不需要複製。
 *
 * **不寫稽核，也不需要交易**：見 `attendance-correction-requests.errors.ts` 上一層（本檔）的
 * 判斷已寫進 PR 說明——這裡只做一次 INSERT，沒有第二個寫入動作需要與它綁在同一個原子單位裡，
 * 單一語句本身已經是原子的。稽核與否的判斳見本模組交付時的 PR 說明（比照計畫 §4.6 對「打卡建立」
 * 的判斷：不落在五類必稽核操作，且本表自己的 `reason`／`created_at`／`status_code` 已完整回答
 * 「誰、何時、為何申請」）。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { AttendanceTypeCode } from '../../../../db/schema/index.ts'
import { getAttendanceSettings } from '../../settings/attendance-settings.service.ts'
import { listOwnAttendanceRecordsByDate } from '../../records/attendance-records.service.ts'
import { isPeriodLocked } from '../domain/attendance-correction-request-period-lock.ts'
import type { AttendanceCorrectionRequestsContext } from '../domain/attendance-correction-request-context.ts'
import type {
  AttendanceCorrectionRequestDetail,
  SubmitAttendanceCorrectionRequestInput,
} from '../domain/attendance-correction-request-model.ts'
import {
  attendanceCorrectionRequestAlreadyPunched,
  attendanceCorrectionRequestDuplicatePendingRequest,
  attendanceCorrectionRequestFutureDateNotAllowed,
  attendanceCorrectionRequestInvalidClockOrder,
  attendanceCorrectionRequestNotAllowed,
  attendanceCorrectionRequestOperatorNotEmployee,
  attendanceCorrectionRequestPeriodLocked,
} from '../attendance-correction-requests.errors.ts'
import {
  findActiveEmploymentIdForOperator,
  findAttendanceCorrectionRequestDetail,
  findPendingAttendanceCorrectionRequest,
  insertAttendanceCorrectionRequest,
} from '../attendance-correction-requests.repository.ts'

/** 一次查出當天所有有效打卡，供「已打過卡」與「先後順序」兩項檢查共用（同一批資料，不重複查詢，
 * §4.5 N+1 規則）。`perPage` 給一個遠大於任何一天正常打卡筆數的值——同一工作日同一類型最多一筆
 * 有效卡，兩種類型合計不會超過個位數，這裡的 50 純粹是保守上限，不是分頁需求。 */
const findValidPunchesOnWorkDate = async (
  context: AttendanceCorrectionRequestsContext,
  workDate: string,
): Promise<
  readonly { readonly attendanceTypeCode: number; readonly clockedAt: string; readonly revokedAt: string | null }[]
> => {
  const result = await listOwnAttendanceRecordsByDate(
    {
      db: context.db,
      clock: context.clock,
      companyId: context.companyId,
      operatorCompanyUserId: context.operatorCompanyUserId,
    },
    { workDate, perPage: 50, currentPage: 1, sort: { field: 'clockedAt', order: 'asc' } },
  )
  if (!result.ok) {
    // `attendance.records.list-own-by-date` 宣告的業務錯誤清單是空陣列——走得到這裡代表程式假設
    // 被打破，是系統錯誤而不是業務拒絕（§3.1.2），比照 `attendance-records.create.service.ts`
    // 對 `attendance.settings.get` 的同一種處理。
    throw new Error('查詢本人當日打卡失敗，但 attendance.records.list-own-by-date 理論上不會回傳業務錯誤')
  }
  return result.value.items.filter((item) => item.revokedAt === null)
}

export const submitAttendanceCorrectionRequest = async (
  context: AttendanceCorrectionRequestsContext,
  input: SubmitAttendanceCorrectionRequestInput,
): Promise<ServiceResult<AttendanceCorrectionRequestDetail>> => {
  const today = context.clock.today()
  if (input.workDate > today) return fail([attendanceCorrectionRequestFutureDateNotAllowed()])

  const operatorEmployment = await findActiveEmploymentIdForOperator(
    context.db,
    context.companyId,
    context.operatorCompanyUserId,
  )
  if (operatorEmployment === null) return fail([attendanceCorrectionRequestOperatorNotEmployee()])

  const settingsResult = await getAttendanceSettings({
    db: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  })
  if (!settingsResult.ok) {
    throw new Error('查詢出勤設定失敗，但 attendance.settings.get 理論上不會回傳業務錯誤')
  }
  // 沒有設定列時視同「允許」，見檔頭。
  const allowCorrectionRequest = settingsResult.value?.allowCorrectionRequest ?? true
  if (!allowCorrectionRequest) return fail([attendanceCorrectionRequestNotAllowed()])

  if (isPeriodLocked(context.companyId, input.workDate)) return fail([attendanceCorrectionRequestPeriodLocked()])

  const validPunches = await findValidPunchesOnWorkDate(context, input.workDate)
  const samePunch = validPunches.find((punch) => punch.attendanceTypeCode === input.attendanceTypeCode)
  if (samePunch !== undefined) return fail([attendanceCorrectionRequestAlreadyPunched()])

  const oppositePunch = validPunches.find((punch) => punch.attendanceTypeCode !== input.attendanceTypeCode)
  if (oppositePunch !== undefined) {
    const isOrderValid =
      input.attendanceTypeCode === AttendanceTypeCode.ClockIn
        ? input.requestedClockedAt < oppositePunch.clockedAt
        : input.requestedClockedAt > oppositePunch.clockedAt
    if (!isOrderValid) return fail([attendanceCorrectionRequestInvalidClockOrder()])
  }

  const existingPending = await findPendingAttendanceCorrectionRequest(
    context.db,
    context.companyId,
    operatorEmployment.employeeId,
    input.workDate,
    input.attendanceTypeCode,
  )
  if (existingPending !== null) return fail([attendanceCorrectionRequestDuplicatePendingRequest()])

  const id = crypto.randomUUID()
  const now = context.clock.now()
  const outcome = await insertAttendanceCorrectionRequest(context.db, context.companyId, {
    id,
    employeeId: operatorEmployment.employeeId,
    employmentId: operatorEmployment.employmentId,
    workDate: input.workDate,
    attendanceTypeCode: input.attendanceTypeCode,
    requestedClockedAt: input.requestedClockedAt,
    reason: input.reason,
    now,
  })
  // 唯一鍵是預檢查之外最後一道保險（§4.3）：預檢查與寫入之間仍有極短的併發窗口，
  // 攔截驅動錯誤才是真正的保證，呼叫端不需要分辨是哪一層擋下來的。
  if (outcome === 'duplicate') return fail([attendanceCorrectionRequestDuplicatePendingRequest()])

  const detail = await findAttendanceCorrectionRequestDetail(context.db, context.companyId, id)
  if (detail === null) {
    throw new Error(`補打卡申請 ${id} 建立後讀不回來`)
  }
  return succeed(detail)
}
