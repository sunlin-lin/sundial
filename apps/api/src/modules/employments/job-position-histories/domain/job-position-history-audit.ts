/**
 * 稽核用：把職務 id 陣列序列化成一個可進 `changes` 的字串（零 IO 純函式）。
 * 理由與 `company-users/roles/domain/role-assignment-audit.ts` 的 `serializeRoleIds` 逐字同構
 * ——`AuditFieldValue` 不允許陣列，且排序後才序列化以避免查詢順序被誤記成一次變更。
 */
export const serializeJobPositionIds = (jobPositionIds: readonly string[]): string | null =>
  jobPositionIds.length === 0 ? null : JSON.stringify([...jobPositionIds].sort())
