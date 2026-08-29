/**
 * 資料存取：在交易內批次鎖定並確認一組職務存在，且是這家公司看得到的（自訂或系統預設）。
 *
 * ## ★ 為什麼鎖 `job_positions`，不是 `employee_employments`、也不是本表自己
 *
 * 計畫 §4.3 末段：「同一任職可同時有多個有效職務，但同一職務期間不得重疊」——鎖粒度是
 * `(employment_id, job_position_id)` 這個**組合**，而 `job_positions` 是這個組合裡在寫入前就已經
 * 存在的那一半（一個職務必須先建在主檔裡才可能被指派），可以直接拿來當序列化點：
 *
 * - **鎖 `employee_employments`（比照 `department-histories`／`job-title-histories`）是錯的**：
 *   會把同一任職對兩個不同職務的建立請求序列化，若順便照抄那兩張表「重疊檢查只看
 *   employment_id」的寫法，就會把「同一任職同時擔任兩個不同職務」這個合法情境誤判為衝突。
 * - **鎖本表（`employee_job_position_histories`）某一列是錯的**：對「這個 (employment,
 *   job_position) 組合的第一筆歷史」，寫入前根本沒有任何一列可以鎖——`SELECT ... FOR UPDATE`
 *   對零匹配列的行為（是否退化成 gap lock）依賴 MariaDB 的隔離等級與索引形狀，不像鎖一個
 *   保證存在的主檔列那樣可預期。
 * - **鎖 `job_positions` 那一列**：它一定先於任何一筆職務歷史存在，`SELECT ... FOR UPDATE`
 *   有明確的一列可鎖；兩個交易同時替**同一個職務**建立職務歷史，會在這裡序列化，第二個交易
 *   進入重疊檢查時一定看得到第一個交易剛提交的資料。**唯一的代價**：兩個不同員工的任職被指派
 *   `同一個` 職務、且期間剛好重疊，會被這個鎖排隊（不是拒絕，只是等待）而不是真正並行寫入
 *   ——那不是本次三支必要併發測試要求的情境，是刻意接受的效能取捨，理由與計畫 §4.3 對其餘
 *   兩張表「不完美，但把失敗模式從靜默重疊換成拿不到鎖」的一貫態度一致。
 *
 * **一次查完全部涉及的職務，不是逐筆呼叫**（§4.5）：`WHERE id IN (...)` 搭配 `FOR UPDATE` 在單一
 * 語句內鎖住多列，呼叫端（`create.service.ts`）因此不需要在迴圈裡呼叫本函式。
 */
import { and, inArray, isNull, or, eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobPositions } from '../../../../db/schema/index.ts'

/** @returns 這批 id 裡，真的存在且這家公司看得到的那些 id（`Set`，供呼叫端比對缺漏）。 */
export const findJobPositionsForUpdate = async (
  runner: QueryRunner,
  companyId: string,
  jobPositionIds: readonly string[],
): Promise<ReadonlySet<string>> => {
  if (jobPositionIds.length === 0) return new Set()

  const rows = await new TenantDatabase(runner, companyId)
    .selectFrom({ id: jobPositions.id }, jobPositions)
    .where(
      and(
        inArray(jobPositions.id, [...jobPositionIds]),
        or(eq(jobPositions.companyId, companyId), isNull(jobPositions.companyId)),
        eq(jobPositions.deletedSeq, 0),
        isNull(jobPositions.deletedAt),
      ),
    )
    .for('update')

  return new Set(rows.map((row) => row.id))
}
