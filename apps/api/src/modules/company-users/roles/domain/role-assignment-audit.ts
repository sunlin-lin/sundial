/**
 * 稽核用：把角色 id 陣列序列化成一個可進 `changes` 的字串（零 IO 純函式）。
 *
 * `AuditFieldValue`（`modules/audit/main/domain/audit-change-set.ts`）刻意不允許物件與陣列：
 * 允許巢狀值等於開一條路，讓整包子結構以「一個欄位」的名義繞過逐欄政策。`roleIds` 在業務上
 * 是一組 id，因此在交給 `buildAuditChanges`之前，這裡先把它壓成一個字串。
 *
 * **排序後才序列化**：`listActiveAssignments` 是依 `roles.code` 排序回來的，順序本身沒有業務
 * 意義——同一組角色只要查詢當下的順序不同（例如新增了一個 code 排在前面的角色），字串就會
 * 不一樣，而那不是使用者做了什麼變更，是排序的副作用。固定排序後再比對，才不會把「查詢順序
 * 剛好不同」誤記成一次角色變更。
 */
export const serializeRoleIds = (roleIds: readonly string[]): string | null =>
  roleIds.length === 0 ? null : JSON.stringify([...roleIds].sort())
