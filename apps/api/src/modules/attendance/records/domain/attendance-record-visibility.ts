/**
 * 座標可見範圍的判斷（計畫 §4.2）：**這是本專案第一次出現「同一支 `get` 端點依呼叫者身分回傳
 * 不同欄位」的模式**，判斷邏輯抽成這支純函式，讓 `get.service.ts` 與它各自的測試都能直接對到
 * 這一個判斷點，不必每次都從頭讀一遍條件式。
 *
 * **這裡只回答「看不看得到座標」，不決定回應物件的鍵存不存在**——那一步（`t.Optional` 對應到
 * 「整個不出現」）留在 `attendance-records.handler.ts` 的映射函式，因為那是 JSON 序列化的形狀
 * 問題，不是業務判斷。
 *
 * **這個分支沒有任何工具在擋**（`check:layers` 管的是 import 邊界，不管一支端點對不同呼叫者
 * 回傳的欄位是否正確）。`__tests__/attendance-records.endpoints.test.ts` 的 `get` 測試至少要
 * 涵蓋三種情境（本人／有權限查他人／無權限查他人），且要斷言回應物件的鍵存不存在，
 * 不能只斷言值——只斷言值的話，「沒權限」與「沒 GPS」都是 falsy，測試會通過而規則沒被驗證。
 */

/** 有 `attendance.records.view-all`／`attendance.records.revoke-other` 任一者即視為「有權限看別人」。 */
export const VIEW_OTHERS_COORDINATES_PERMISSION_CODES = [
  'attendance.records.view-all',
  'attendance.records.revoke-other',
] as const

export type CoordinateVisibility = { readonly visible: true } | { readonly visible: false }

/**
 * @param recordEmployeeId 這筆打卡記錄所屬的員工 id。
 * @param requesterEmployeeId 呼叫者自己的員工 id；`null` 代表呼叫者本身沒有連結員工身分
 *   （例如純協作者帳號）——此時一定不是「查自己的」，走「查別人的」那一支判斷。
 * @param requesterHasViewOthersPermission 呼叫者是否具備 `view-all`／`revoke-other` 任一權限碼。
 */
export const resolveCoordinateVisibility = (
  recordEmployeeId: string,
  requesterEmployeeId: string | null,
  requesterHasViewOthersPermission: boolean,
): CoordinateVisibility => {
  const isOwnRecord = requesterEmployeeId !== null && requesterEmployeeId === recordEmployeeId
  return { visible: isOwnRecord || requesterHasViewOthersPermission }
}
