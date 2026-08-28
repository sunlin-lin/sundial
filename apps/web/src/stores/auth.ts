/**
 * 登入身分、所屬公司與權限碼（前端規範 §2.1）。
 *
 * §2.1 要同時滿足三點才進 store：跨頁共用、有生命週期、不是可重取的清單快照。
 * 「登入身分與所屬公司、權限碼集合」是它明列的少數幾項之一——每一頁的頁首都要顯示前者，
 * 選單與路由守衛每一次導航都要讀後者，兩者都在登入時建立、在登出時清除。
 *
 * **這裡不存 access token。** token 在統一 client 的模組層變數裡（後端規範 §5.4.3），
 * 放進 store 會讓它出現在 devtools 的狀態樹上，也讓「誰讀得到 token」從一個檔案擴大到全站。
 *
 * ## 權限碼為什麼由這一層持有
 *
 * §0.11 禁止 `shared/` import `stores/`，所以 `shared/permission/` 只能是**不吃 ambient state
 * 的純函式**（見該目錄檔頭）。「目前使用者有哪些權限碼」是一個有生命週期的狀態，它的家只能在
 * 這裡；本檔把那支純函式綁上這份狀態，對外提供 {@link useAuthStore} 的 `can`。
 * 於是「判斷邏輯可以逐格測」與「相依方向只有一個」兩件事同時成立。
 *
 * ## 重新整理不掉線
 *
 * access token 只存在記憶體，**重整後一定是 `null`**，所以重整後這個 store 也是空的。
 * 但 refresh 票是後端下發的 httpOnly cookie，瀏覽器仍然帶著它——因此啟動時打一次
 * `sessions/main/context` 就能把身分與權限碼一起換回來（換票由統一 client 在收到 `900` 時
 * 自己完成，§3.1 明文禁止頁面自行呼叫 refresh）。那一次探測就是 {@link useAuthStore} 的
 * `restoreOnce`，由路由守衛在第一次導航時 await。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { readSessionContext, type SignedInIdentity } from '../shared/api/sessions.ts'
import type { PermissionCode } from '../shared/permission/permission-code.ts'
import { hasPermission } from '../shared/permission/permission.ts'

export const useAuthStore = defineStore('auth', () => {
  const identity = ref<SignedInIdentity | null>(null)
  const restoring = ref(false)

  /**
   * 「啟動時嘗試恢復身分」這件事只做一次。
   *
   * 存在 setup 函式的閉包裡（store 是單例，效果等同模組層變數）。**沒有它會怎樣**：
   * 守衛在每一次導航都會 await 一次 `restoreOnce()`，於是使用者每點一次選單就多打一支
   * `context`——而且那些請求全部會成功，畫面上完全正常，只是每次導航都慢一個往返。
   *
   * `reset()` 刻意**不**清掉它：登出之後 refresh 票已經作廢，再探測一次的結果必然是「沒有身分」，
   * 那一個往返純粹是浪費。真正需要重新建立身分的路徑是登入，而登入走的是 `signIn`。
   */
  let restoreAttempt: Promise<void> | null = null

  // 對外只暴露 readonly 的衍生值與具名 action，**不把可寫的 ref 直接 return**（§2.2）。
  // 狀態能從任何元件直接賦值時，「這個值為什麼變了」要全域搜尋才答得出來。
  const isSignedIn = computed(() => identity.value !== null)
  const displayName = computed(() => identity.value?.user.displayName ?? '')
  const companyName = computed(() => identity.value?.company.name ?? '')

  /**
   * 身分探測進行中。
   *
   * **唯一的消費者是 `main.ts` 的 `900` 全域處置**：探測收到 `900` 是預期結果（沒有可用的
   * refresh cookie ＝ 真的沒登入），不是「操作到一半掉線」。兩者要走不同的路，理由見那裡。
   */
  const isRestoringIdentity = computed(() => restoring.value)

  /**
   * 有沒有某個權限碼（§4.1 的 `can`）。
   *
   * `?? []` 那一支涵蓋「還沒登入」與「探測還沒回來」：兩者都應該是「什麼都不能」。
   * 反過來寫成「拿不到身分就一律允許」會讓啟動的那幾百毫秒內整份選單全部亮著再一項項消失。
   */
  const can = (code: PermissionCode): boolean =>
    hasPermission(identity.value?.permissionCodes ?? [], code)

  const signIn = (next: SignedInIdentity): void => {
    identity.value = next
  }

  /**
   * 嘗試用瀏覽器手上的 refresh cookie 恢復身分。**至多做一次**，之後每次呼叫都是同一個 promise。
   *
   * 失敗一律吞掉（`catch`）：這支的語意是「試試看」，而「試不出來」的正確結果是**沒有身分**，
   * 不是一個錯誤。讓 `AuthRequiredError` 逃出去的話，守衛那一側會變成一個 rejected promise，
   * 而守衛裡的例外會變成 unhandled rejection ＋ 導航中止——使用者看到的是一片空白的畫面，
   * 而不是登入頁。
   */
  const restoreOnce = (): Promise<void> => {
    restoreAttempt ??= (() => {
      restoring.value = true
      return readSessionContext()
        .then((next) => {
          identity.value = next
        })
        .catch(() => undefined)
        .finally(() => {
          restoring.value = false
        })
    })()

    return restoreAttempt
  }

  /**
   * §2.2 要求每個 store 都要有 `reset()`，並在登出與切換公司時被呼叫。
   * 沒有它的話，切換公司會殘留上一家公司的權限碼——畫面會出現使用者在新公司沒有的按鈕。
   */
  const reset = (): void => {
    identity.value = null
  }

  return {
    isSignedIn,
    displayName,
    companyName,
    isRestoringIdentity,
    can,
    signIn,
    restoreOnce,
    reset,
  }
})
