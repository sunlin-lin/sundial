/**
 * 業務動作：打卡（上班卡／下班卡）。
 *
 * ## §4.5 併發：鎖的粒度＝任職，`FOR UPDATE` 必須是交易的第一句
 *
 * MariaDB 預設 `REPEATABLE READ`：一般 `SELECT` 的一致性讀快照在交易內**第一次**執行一般
 * `SELECT` 的當下建立，鎖定讀（`FOR UPDATE`）不受這份快照約束。若先做「配對用的一般查詢」再
 * 上鎖，鎖到手之後配對邏輯讀到的仍是鎖定前那份舊快照，兩個交易一樣會同時判定「沒有衝突」而
 * 雙雙寫入成功——見 `db/schema/attendance-records.ts` 檔頭與
 * `__tests__/attendance-records.concurrency.test.ts`。
 *
 * 因此本檔的呼叫順序刻意分兩段：
 *
 * 1. **交易之外**（本函式 `createAttendanceRecord`）：用 `context.db`（連線池，不是交易）解出
 *    操作者「自己」目前有效的員工與任職 id（{@link findActiveEmploymentIdForOperator}）、
 *    讀出勤設定（`gpsRequired`／`requireClockInBeforeClockOut`）。這兩步都是一般 `SELECT`，
 *    但發生在打卡交易**開始之前**，用的是連線池借出的另一條連線，不會污染稍後那筆交易的快照。
 * 2. **交易之內**（{@link createAttendanceRecordInTransaction}）：第一句固定是
 *    `findEmploymentForUpdate`（`SELECT ... FOR UPDATE`），鎖到手之後才做配對與重複檢查
 *    （一般 `SELECT`，這時讀到的已經是鎖定之後的最新已提交資料），最後寫入。
 *
 * ## 配對規則（字典「打卡欄位定案」節）
 *
 * 上班卡：`work_date` 恆為今天，若今天已經有一張有效上班卡則衝突。
 * 下班卡：`work_date` 取自「還沒配到有效下班卡的最新一張有效上班卡」；找不到時，依出勤設定
 * `require_clock_in_before_clock_out`（沒有設定列時預設為 `true`，見 `db/schema/
 * attendance-settings.ts` 檔頭「字典本次需求為 true」）決定拒絕還是退回打卡當日。
 *
 * ## 不寫稽核
 *
 * 打卡建立不落在五類必須稽核的操作裡（計畫 §4.6）：不是個資異動、不是金額、不是帳號或角色，
 * 量的考量也在（全公司每人每天至少兩次打卡）。
 *
 * **本檔的 `createAttendanceRecordInTransaction` 只收外部交易 handle**：開交易的包裝是
 * `createAttendanceRecord` 自己，這裡沒有像其他模組那樣切成「單一端點用」與「供編排點用」兩支
 * ——Stage 3 沒有任何編排點需要把打卡納進別人的交易，先寫成一支即可，日後真的出現編排需求時
 * 再拆。
 *
 * ## 打卡成功後，在同一筆交易內重算 `attendance_results`（補計畫 §4.3.1 遺漏的主要路徑）
 *
 * `revoke`／`revoke-other` 成功後都會呼叫 `recalculateAttendanceResultForWorkDay`，但計畫
 * §4.3.1 只寫了「撤銷後要重算」，沒提到打卡成功本身。若正常打卡不重算，`attendance_results`
 * 永遠只會因為「撤銷」而出現——這是反過來的：唯一會產生判定結果的路徑竟然是撤銷，正常上下班
 * 打卡反而不會留下任何 `attendance_results` 紀錄，UI 09「全體出勤」與 UI 12「我的出勤」會一片
 * 空白。因此本檔比照 `revoke.service.ts` 的形狀，在同一筆交易內呼叫同一支重算函式。
 *
 * **上班卡與下班卡都要重算，不是只有下班卡**：上班卡打完時還沒有下班卡，`computeAttendanceResult`
 * 對缺一張卡的情況固定回傳 `worked_minutes = 0`（見該函式檔頭），不是算不出來而中止。若只在下班卡
 * 才重算，當天只打了上班卡、還在上班中的員工，那一整天在 `attendance_results` 裡完全沒有紀錄，
 * UI 09「全體出勤」會看不到這個人今天已經打卡上班——這比顯示「工時 0、尚未下班」更誤導，因為後者
 * 至少誠實反映「人在，還沒打下班卡」這個事實，前者則讓人以為他今天根本沒來。這與 `revoke`／
 * `revoke-other` 對 `ClockIn` 類型的撤銷一樣要重算（不分卡別）是同一個對稱：卡的類型不影響
 * 「這個工作日是否需要重算」這個判斷，只影響重算後算出來的值長什麼樣。
 *
 * 重算對象是配對後解出來的 `workDate`（上班卡固定是今天；下班卡可能配對到前一天，例如跨日班），
 * 不是打卡當下的今天——比照 `revoke.service.ts` 檔頭「撤銷影響的是那一天，不是撤銷者自己的今天」
 * 同一個道理。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { AttendanceSourceTypeCode, AttendanceTypeCode } from '../../../../db/schema/index.ts'
import { getAttendanceSettings } from '../../settings/attendance-settings.service.ts'
import { recalculateAttendanceResultForWorkDay } from '../../results/attendance-results.service.ts'
import type { AttendanceRecordsContext } from '../domain/attendance-record-context.ts'
import type { AttendanceRecordDetail, CreateAttendanceRecordInput } from '../domain/attendance-record-model.ts'
import {
  attendanceRecordAlreadyPunched,
  attendanceRecordGpsRequired,
  attendanceRecordNoClockInToPair,
  attendanceRecordOperatorNotEmployee,
} from '../attendance-records.errors.ts'
import {
  findActiveEmploymentIdForOperator,
  findAttendanceRecordDetail,
  findEmploymentForUpdate,
  findPairingClockInWorkDate,
  findValidPunchOnDate,
  insertAttendanceRecord,
} from '../attendance-records.repository.ts'

const createAttendanceRecordInTransaction = async (
  tx: TransactionRunner,
  context: AttendanceRecordsContext,
  operatorEmploymentId: string,
  requireClockInBeforeClockOut: boolean,
  input: CreateAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => {
  const now = context.clock.now()
  const today = context.clock.today()

  // ★ 鎖的粒度＝任職，且是本交易的第一句資料庫語句（見檔頭）。
  const employment = await findEmploymentForUpdate(tx, context.companyId, operatorEmploymentId)
  if (employment === null) return fail([attendanceRecordOperatorNotEmployee()])

  let workDate: string
  if (input.attendanceTypeCode === AttendanceTypeCode.ClockIn) {
    workDate = today
    const existing = await findValidPunchOnDate(
      tx,
      context.companyId,
      employment.id,
      workDate,
      input.attendanceTypeCode,
    )
    if (existing !== null) return fail([attendanceRecordAlreadyPunched()])
  } else {
    const pairingWorkDate = await findPairingClockInWorkDate(tx, context.companyId, employment.id)
    if (pairingWorkDate === null) {
      if (requireClockInBeforeClockOut) return fail([attendanceRecordNoClockInToPair()])
      // 出勤設定允許不先打上班卡：退回打卡當日，這種情況本身就應被判定為異常（字典「打卡欄位
      // 定案」節），但異常判定屬於 Stage 4 判定引擎的職責，Stage 3 只負責誠實記錄事件本身。
      workDate = today
    } else {
      workDate = pairingWorkDate
    }
    const existing = await findValidPunchOnDate(
      tx,
      context.companyId,
      employment.id,
      workDate,
      input.attendanceTypeCode,
    )
    if (existing !== null) return fail([attendanceRecordAlreadyPunched()])
  }

  const id = crypto.randomUUID()
  const outcome = await insertAttendanceRecord(tx, context.companyId, {
    id,
    employeeId: employment.employeeId,
    employmentId: employment.id,
    workDate,
    attendanceTypeCode: input.attendanceTypeCode,
    sourceTypeCode: AttendanceSourceTypeCode.Field,
    clockedAt: now,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
    now,
  })
  // 唯一鍵是配對／重複檢查之外最後一道保險（計畫 §4.5）：鎖不完美時（例如鎖粒度以外的邊界
  // 情況）擋不住的，交給唯一鍵擋，回同一則業務錯誤——呼叫端不需要分辨是哪一層擋下來的。
  if (outcome === 'duplicate') return fail([attendanceRecordAlreadyPunched()])

  // ★ 同一筆交易內重算（見檔頭「打卡成功後……」那一段）：上班卡與下班卡都要重算，且重算對象是
  // 上面配對解出來的 `workDate`，不是 `today`——下班卡可能配對到前一天。
  await recalculateAttendanceResultForWorkDay(
    tx,
    context.companyId,
    { employeeId: employment.employeeId, workDate },
    now,
  )

  const detail = await findAttendanceRecordDetail(tx, context.companyId, id)
  if (detail === null) {
    throw new Error(`打卡記錄 ${id} 建立後於同一交易內讀不回來`)
  }
  return succeed(detail)
}

export const createAttendanceRecord = async (
  context: AttendanceRecordsContext,
  input: CreateAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => {
  // ① 交易之外解出操作者「自己」的員工與任職（見檔頭，不可移進交易內部）。
  const operatorEmployment = await findActiveEmploymentIdForOperator(
    context.db,
    context.companyId,
    context.operatorCompanyUserId,
  )
  if (operatorEmployment === null) return fail([attendanceRecordOperatorNotEmployee()])

  // ② 讀出勤設定（同樣是交易外的一般查詢，不影響交易內的快照規則）。
  const settingsResult = await getAttendanceSettings({
    db: context.db,
    clock: context.clock,
    companyId: context.companyId,
    operatorCompanyUserId: context.operatorCompanyUserId,
  })
  if (!settingsResult.ok) {
    // `attendance/settings` 的 `get` 端點宣告的業務錯誤清單是空陣列——這裡走得到失敗分支
    // 代表程式假設被打破，是系統錯誤而不是業務拒絕（§3.1.2）。
    throw new Error('查詢出勤設定失敗，但 attendance.settings.get 理論上不會回傳業務錯誤')
  }
  const settings = settingsResult.value
  // 沒有設定列時的預設值，逐字對應 `db/schema/attendance-settings.ts` 檔頭「字典本次需求為
  // true」／「字典本次定案為 false」——公司從未呼叫過 `attendance/settings/update` 不代表這兩條
  // 規則不適用，只是還沒有人明確調整過。
  const gpsRequired = settings?.gpsRequired ?? false
  const requireClockInBeforeClockOut = settings?.requireClockInBeforeClockOut ?? true

  if (gpsRequired && (input.latitude === null || input.longitude === null)) {
    return fail([attendanceRecordGpsRequired()])
  }

  return context.db.transaction((tx) =>
    createAttendanceRecordInTransaction(
      tx,
      context,
      operatorEmployment.employmentId,
      requireClockInBeforeClockOut,
      input,
    ),
  )
}
