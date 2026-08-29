/**
 * ★ 這是一根樁（stub），不是真的檢查。
 *
 * 撤銷（`revoke`／`revoke-other`）的唯一限制是「該工作日是否已被薪資結算鎖定」（計畫 §4.3.1、
 * 字典「已確認的 Dashboard 打卡與撤銷」段落：「已鎖定日期不得由員工直接撤銷，應改走更正流程」）。
 * 判斷依據是 `payroll_periods.status_code`（依 `work_date` 落在哪一個 `payroll_period_id` 區間，
 * 檢查其狀態是否為「已結算」，見 `docs/schema/02-payroll-calculation-settlement.md`）。
 *
 * **但 `payroll_periods` 只存在於文件層級的設計，薪資結算模組（第 5 層）尚未實作**——本函式現階段
 * 固定回傳「未鎖定」（`false`），因此 Stage 3 的撤銷檢查點永遠放行，不是真的查過結算狀態。
 *
 * **第 5 層薪資結算模組上線時要做的事**：把這支函式改成依 `companyId`／`workDate` 查
 * `payroll_periods` 落在哪一個區間、其 `status_code` 是否為「已結算」，回傳對應的布林值。
 * 呼叫端（`impl/attendance-records.revoke.service.ts`、`impl/attendance-records.revoke-other.
 * service.ts`）不需要跟著改——兩者都只依賴這支函式的簽章，不知道也不需要知道內部怎麼查。
 */
export const isPeriodLocked = (_companyId: string, _workDate: string): boolean => {
  // 固定回傳「未鎖定」，見檔頭。參數暫時用不到，保留簽章是為了讓呼叫端與未來的真實查詢一致，
  // 不必在薪資模組上線時改呼叫端的傳參方式。
  return false
}
