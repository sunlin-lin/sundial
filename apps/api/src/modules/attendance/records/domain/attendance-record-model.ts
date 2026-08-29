/**
 * 業務層型別（純型別，零執行期程式碼）。放在 `domain/` 而不是入口檔的理由與 `attendance/
 * settings/domain/attendance-settings-context.ts` 檔頭相同：§0 的檔名白名單沒有「模組共用型別」
 * 的位置，放進入口檔會讓 `impl/` 的切片回頭 import 入口檔，形成循環相依。
 */
import type { AttendanceSourceTypeCodeValue, AttendanceTypeCodeValue } from '../../../../db/schema/index.ts'

export type { AttendanceSourceTypeCodeValue, AttendanceTypeCodeValue } from '../../../../db/schema/index.ts'

/** `create`（打卡）的輸入。`employeeId`／`employmentId` 不是輸入——由 token 推出的身分決定（計畫 §4.4）。 */
export type CreateAttendanceRecordInput = {
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly latitude: number | null
  readonly longitude: number | null
  readonly accuracyMeters: number | null
}

/**
 * 完整明細（服務內部流通用，含座標）。座標可見範圍的遮罩發生在 `get.service.ts` 組裝回應的
 * 那一步，不影響這個型別本身——這個型別代表「資料庫裡實際存的樣子」。
 */
export type AttendanceRecordDetail = {
  readonly id: string
  readonly employeeId: string
  readonly employmentId: string
  readonly workDate: string
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly sourceTypeCode: AttendanceSourceTypeCodeValue
  readonly sourceId: string | null
  readonly clockedAt: string
  /**
   * **已轉型為 `number`**（原始欄位是 `decimal`，drizzle 讀出來是字串）。這裡的 `Number(...)`
   * 不違反 §4.7「禁止 `Number(...)` 後再計算」：座標不加總、不做門檻比較，轉型後直接輸出，
   * 沒有計算，不是那條規則要防的情況——完整推論見計畫 §4.2、`db/schema/attendance-records.ts`
   * 檔頭。轉型動作本身在 `impl/attendance-records.find-detail.repository.ts` 那一行。
   */
  readonly latitude: number | null
  readonly longitude: number | null
  readonly accuracyMeters: number | null
  readonly address: string | null
  readonly addressResolvedAt: string | null
  readonly revokedAt: string | null
  readonly revokedBy: string | null
  /** 撤銷人姓名（登入帳號名稱，比照 `company-users/roles` 的 `assignedByName`／`revokedByName`
   * 既有作法）。未撤銷（`revokedBy` 為 `null`）時同為 `null`——由 repository 的 LEFT JOIN 自然
   * 得出，不是另外判斷出來的。 */
  readonly revokedByName: string | null
  readonly revokeReason: string | null
  readonly revokedSeq: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** `revoke`（本人）的輸入。**不接受 `employeeId`**（計畫 §4.3.1）：範圍來自 token 推出的身分。 */
export type RevokeOwnAttendanceRecordInput = {
  readonly recordId: string
  readonly reason: string
}

/** `revoke-other`（他人）的輸入。與 `revoke` 欄位形狀相同——差別在授權與稽核，不在 body。 */
export type RevokeOtherAttendanceRecordInput = {
  readonly recordId: string
  readonly reason: string
}

/** `get`（單筆明細）的輸入。 */
export type GetAttendanceRecordInput = {
  readonly recordId: string
}

/**
 * `get` 回應座標的三種狀態（計畫 §4.2）。**這個判斷本身不在任何工具的擋範圍內**，
 * 只能靠 `get.service.ts` 的測試守住——見該檔檔頭。
 */
export type AttendanceRecordCoordinates =
  | { readonly visible: true; readonly latitude: number | null; readonly longitude: number | null }
  | { readonly visible: false }

/** `revoke-other` 稽核用的前後快照。`before` 恆為 `null`——這是「記錄這筆打卡被撤銷了什麼」的
 * 快照事件，不是逐欄比較撤銷前後差異（撤銷不會改動 `clockedAt`／`attendanceTypeCode` 等欄位，
 * 若真的逐欄比較，這幾欄永遠不變、永遠不會出現在 `changes` 裡，稽核就少了「撤銷的是哪一張卡」
 * 這個最關鍵的資訊）。`before=null` 讓 `buildChangeSet` 對每一欄都判定「有變化」，欄位政策
 * （`Value`／`Presence`）再決定要不要記值——見 `modules/audit/main/domain/audit-field-policy.ts`
 * 的 `attendance_records` 節。
 */
export type AttendanceRecordRevokeOtherAuditSnapshot = {
  readonly clockedAt: string
  readonly attendanceTypeCode: number
  readonly latitude: number | null
  readonly longitude: number | null
  readonly address: string | null
  readonly revokeReason: string
}

/** `list-by-date` 的狀態篩選（UI 23）：全部／只看有效／只看已撤銷，依 `revoked_at IS NULL` 判斷。 */
export type AttendanceRecordListStatus = 'all' | 'active' | 'revoked'

/** `list-by-date` 的查詢條件。 */
export type ListAttendanceRecordsByDateQuery = {
  readonly workDate: string
  readonly departmentId: string | null
  readonly employeeId: string | null
  readonly status: AttendanceRecordListStatus
  readonly perPage: number
  readonly currentPage: number
  /** `employeeCode` 是 UI 23 定案的預設排序鍵（先依員工工號，同一員工再依打卡時間）；
   * `clockedAt` 保留給日後的時間軸瀏覽需求，見 `attendance-records.routes.ts` 的排序常數檔頭。 */
  readonly sort: { readonly field: 'employeeCode' | 'clockedAt'; readonly order: 'asc' | 'desc' }
}

/** `list-by-date` 單筆。**恆不含座標**（計畫 §4.2：列表一律不回座標，只有 `get` 明細才回）。 */
export type AttendanceRecordListItem = {
  readonly id: string
  readonly employeeId: string
  readonly employeeCode: string
  readonly employeeName: string
  readonly departmentName: string | null
  readonly employmentId: string
  readonly workDate: string
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly sourceTypeCode: AttendanceSourceTypeCodeValue
  readonly clockedAt: string
  readonly address: string | null
  readonly revokedAt: string | null
  readonly revokedBy: string | null
  readonly revokeReason: string | null
  readonly revokedSeq: number
}

export type ListAttendanceRecordsByDatePage = {
  readonly items: readonly AttendanceRecordListItem[]
  readonly totalCount: number
}

/**
 * `list-own-by-date` 的查詢條件。**範圍固定為呼叫者本人**（token 推出的身分，service 內部由
 * `company_user → employee_id` 解出），不接受 `employeeId`／`departmentId`——查自己不需要篩選
 * 是哪個員工、哪個部門。`workDate` 收一般日期而不是固定「今天」：Dashboard 現在只需要今天，
 * 但 Stage 7「我的出勤」查別天會需要同一支查詢，不含日期會讓那時候得再開一支幾乎一樣的端點
 * （Stage 5 補這個端點時一併判斷過，見 `attendance-records.routes.ts` 的端點說明）。
 */
export type ListOwnAttendanceRecordsByDateQuery = {
  readonly workDate: string
  readonly perPage: number
  readonly currentPage: number
  readonly sort: { readonly field: 'clockedAt'; readonly order: 'asc' | 'desc' }
}

/**
 * `list-own-by-date` 單筆。**恆不含座標**（計畫 §4.2：列表輸出範圍由端點形狀決定，不是由呼叫者
 * 身分決定——即使這是本人資料，這支端點仍是「列表」形狀，與 `list-by-date` 適用同一條規則；
 * §4.2「看自己的一律看得到」講的是 `get` 這種明細端點，兩者管的是不同軸線，見
 * `attendance-records.routes.ts` 的端點說明有完整推論）。
 *
 * 也不含 `employeeCode`／`employeeName`／`departmentName`——呼叫者查的必然是自己，不需要在
 * 每一列重複回聲自己的姓名與工號，這也是這支查詢不必 JOIN `employees`／部門相關表的理由。
 */
export type OwnAttendanceRecordListItem = {
  readonly id: string
  readonly employmentId: string
  readonly workDate: string
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly sourceTypeCode: AttendanceSourceTypeCodeValue
  readonly clockedAt: string
  readonly address: string | null
  readonly revokedAt: string | null
  readonly revokedBy: string | null
  readonly revokeReason: string | null
}

export type ListOwnAttendanceRecordsByDatePage = {
  readonly items: readonly OwnAttendanceRecordListItem[]
  readonly totalCount: number
}
