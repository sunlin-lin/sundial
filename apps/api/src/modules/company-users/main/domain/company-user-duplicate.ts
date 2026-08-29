/**
 * 唯一鍵違反的判讀（零 IO 純函式）。形狀比照 `employees/main/domain/employee-duplicate.ts`。
 *
 * §4.3：唯一性檢查**禁止用「先 SELECT 再 INSERT」**取代資料庫唯一鍵——兩個併發請求會同時查到
 * 「沒有」，然後都寫進去。本檔負責把驅動丟出來的例外翻譯成「撞到了 `users.username` 的唯一鍵」。
 *
 * **這一支特別重要的理由（實作計畫 `05-employee-onboarding.md`「二、`username` 全域唯一造成的
 * 跨租戶問題」）：** `users.username` 是**全域**唯一鍵，不是公司內唯一鍵。定案是「重複即拒絕，
 * 不得連結到既有的 `users` 列」——因此這裡偵測到撞鍵之後，呼叫端唯一能做的事就是回一個業務錯誤，
 * **不得**接著去 `SELECT` 那個既有帳號、更不得去 `UPDATE` 它的任何欄位（尤其是 `password_hash`）。
 * 本函式只回一個布林式的分類結果，刻意不回傳撞到的那一列——呼叫端拿不到那一列的任何資訊，
 * 「順手看一下是誰在用」這件事在型別上就做不到。
 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

/** `users` 唯一擋公司無關身分的鍵。名稱須與 `db/schema/users.ts` 及其 migration 逐字相同。 */
export const USER_USERNAME_UNIQUE_INDEX = 'uq_users_username'

/**
 * 這個例外是不是「撞到 `users.username` 的唯一鍵」。
 *
 * 對無法辨識的唯一鍵回 `false`，由呼叫端原樣重拋（§3.1.2）——`users` 目前只有這一個唯一鍵，
 * 但仍然比對名稱而不是只看 `errno`，理由與 `employee-duplicate.ts` 相同：日後若加了第二個唯一鍵，
 * 這裡不比對名稱的話會把不相干的撞鍵也回報成「帳號已被使用」。
 */
export const isUsernameDuplicate = (error: unknown): boolean => isUniqueViolation(error, USER_USERNAME_UNIQUE_INDEX)
