/**
 * 登出這個動作裡「每一頁都一樣」的那一半（§1.5：兩個以上頁面共用才移入共用區）。
 *
 * ## 為什麼是現在抽，以及為什麼只抽一半
 *
 * 登出按鈕在 `AppShell` 上，而 `AppShell` 刻意不呼叫 API、不碰 store（見該檔檔頭：登出成功後
 * 要去哪裡是頁面的事）。於是每一支套 `AppShell` 的頁面都各自抄了同一段：一個 `isSigningOut`
 * 的 ref、一個「進行中就直接 return」的防重複點擊（§6.2）、`logout()` 的呼叫、以及不論成敗都要
 * 收尾的 `finally`。第三個使用者出現時（`regulatory/datasets`）就是 §1.5 說的那個時機。
 *
 * **只抽一半，是因為另一半抽不進來。** §0.11 禁止 `shared/` import `stores/`——而登出的最後兩步
 * （清掉 auth store、導回登入頁）一定要碰 store 與 router。硬要整包搬進共用區的唯一辦法是讓
 * `shared/` 反向相依 `stores/`，那會讓「這支函式在哪些情境下能用」變成不可回答的問題（§0.11 的理由）。
 *
 * 因此界線畫在這裡：**可重用而且不碰任何 ambient state 的部分（呼叫端點 ＋ loading 狀態 ＋
 * 防重複點擊）在本檔，store 清除與導頁由呼叫端以 `onSignedOut` 回呼提供。**
 * 那一步各頁只剩兩行，而且那兩行本來就該由頁面決定（登出後去哪裡是頁面的事）。
 *
 * ## 為什麼 `catch` 之後仍然視為已登出
 *
 * 使用者按了登出就是要離開，讓一個「登出失敗」的錯誤把他留在已登入狀態，是他最不預期的結果。
 * 後端那一側作廢的是整條輪替鏈（後端規範 §5.4.7），而 `logout()` 內部無論如何都會清掉記憶體中的
 * token（見 `sessions.ts`），所以按下去之後身分已經沒了——畫面必須跟上。
 */
import { computed, ref, type ComputedRef } from 'vue'
import { logout } from './sessions.ts'

export type SignOutController = {
  /** 登出請求進行中。綁到按鈕的 `:loading` 與 `:disabled`（§6.2 防重複點擊）。 */
  readonly isSigningOut: ComputedRef<boolean>
  /** 觸發登出。進行中再按一次不會送出第二個請求。 */
  readonly requestSignOut: () => void
}

/**
 * @param onSignedOut 登出流程結束後要做的事（清 store、導回登入頁）。
 *   **不論後端成功或失敗都會被呼叫**，理由見檔頭。
 */
export const useSignOut = (onSignedOut: () => void): SignOutController => {
  const signingOut = ref(false)

  const requestSignOut = (): void => {
    if (signingOut.value) return
    signingOut.value = true

    logout()
      .catch(() => undefined)
      .finally(() => {
        signingOut.value = false
        onSignedOut()
      })
  }

  // 對外只給唯讀投影，不把可寫的 ref 交出去（§2.2 對 store 的要求，同一個理由：
  // 狀態能從任何元件直接賦值時，「這個值為什麼變了」要全域搜尋才答得出來）。
  return { isSigningOut: computed(() => signingOut.value), requestSignOut }
}
