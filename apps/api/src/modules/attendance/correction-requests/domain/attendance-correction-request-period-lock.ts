/**
 * ★ 這是一根樁（stub），不是真的檢查。
 *
 * **這是刻意複製，不是跨次目錄 import**：`attendance/records` 已經有一支邏輯相同的
 * `isPeriodLocked`（`impl/attendance-records.find-... ` 旁邊的 `domain/
 * attendance-record-period-lock.ts`），但它沒有在 `attendance-records.service.ts`（service 入口）
 * re-export——`sundial-backend` skill module-layout §3「同一大目錄內的次目錄之間可以互相
 * import，但業務層以外的檔案（這裡是 `domain/`）不透過對方的入口檔匯出」，因此 `correction-
 * requests` 這個次目錄不該直接伸手進 `records/domain/` 拿它。理由與 `attendance/results`
 * 複製 `findEmployeeIdForCompanyUser` 的判準相同（見 `attendance-results.
 * find-employee-for-company-user.repository.ts` 檔頭）：這是一段不含業務規則、不會分岔的純函式
 * （固定回傳 `false`），也不足以構成「升格成 `records` 的業務動作」，因此就地複製一份。
 *
 * **業務語意**：補打卡申請的送出，與撤銷打卡（`attendance/records` 的 `revoke`／`revoke-other`）
 * 適用同一條薪資結算鎖定規則——計畫 §4.3.1「該工作日是否已被薪資結算鎖定」是撤銷的唯一限制，
 * 而字典「已確認流程與約束」明文補打卡申請同樣受「已結算月份不得提出申請」限制，兩者是同一套
 * `payroll_periods` 鎖定機制的兩種表現，不是各自獨立的規則（見 `docs/plans/06-attendance.md`
 * §4.3.1 對「與 attendance_correction_requests／attendance_correction_reviews 現有規則是同一條
 * 鎖定機制的不同表現」的原文）。
 *
 * **但 `payroll_periods` 只存在於文件層級的設計，薪資結算模組（第 5 層）尚未實作**——本函式現階段
 * 固定回傳「未鎖定」（`false`），因此 Stage 8 的 `submit` 檢查點永遠放行，不是真的查過結算狀態。
 * 第 5 層薪資結算模組上線時，這裡與 `attendance/records` 的同名樁要一起接上真正的查詢。
 */
export const isPeriodLocked = (_companyId: string, _workDate: string): boolean => {
  // 固定回傳「未鎖定」，見檔頭。參數暫時用不到，保留簽章是為了讓呼叫端與未來的真實查詢一致。
  return false
}
