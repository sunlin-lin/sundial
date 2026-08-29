/**
 * 動作可用性（前端規範 §1.3 的第 (3) 類、§0.5 的 `.actions.ts`）。
 *
 * 「按鈕何時可按」留在模板裡就等於零測試覆蓋，而它又最容易錯又最不容易一眼看出錯：
 * 「某個狀態下本該停用的操作還亮著」不會報錯，只會讓使用者按下去吃一個錯誤。
 * 抽成純函式之後，整張狀態矩陣可以逐格寫成測試。
 */
import type { LoginInput } from '../../../shared/api/sessions.ts'

/**
 * 登入鈕是否可按。
 *
 * 兩個條件：
 * 1. **沒有請求在途中**——送出中必須停用（§6.2）。網路慢時連按兩下，第二次請求可能剛好落在
 *    第一次完成之後，後端擋得住，但使用者會看到一個莫名其妙的錯誤。
 * 2. **三個欄位都填了**。這是「動作可用性」，不是欄位驗證——長度、格式這類**驗證規則必須來自
 *    OpenAPI schema**（§6.1），前端另寫一套一定會漂移。`gen:api` 還不存在，所以這一頁
 *    目前**沒有任何前端驗證規則**，格式問題一律由後端判定並回 `300`。
 */
export const canSubmitLogin = (payload: LoginInput, isSubmitting: boolean): boolean =>
  !isSubmitting && payload.companyCode !== '' && payload.username !== '' && payload.password !== ''
