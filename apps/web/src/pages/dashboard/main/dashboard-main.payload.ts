/**
 * 撤銷原因表單值 → 送出 payload（前端規範 §1.3 的第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * 只有一個欄位，轉換本身很單薄，但仍照規範拆出來——理由與其他頁一致：表單狀態（可能含前後
 * 空白）與送出值（已 trim）是兩件事，混在一起會讓「使用者填了空白鍵算不算填」這種判斷散落各處。
 */
export type RevokeFormState = { reason: string }

export const emptyRevokeFormState = (): RevokeFormState => ({ reason: '' })

export const toRevokePayload = (recordId: string, form: RevokeFormState): { recordId: string; reason: string } => ({
  recordId,
  reason: form.reason.trim(),
})
