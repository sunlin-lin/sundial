/**
 * 登入身分與所屬公司（前端規範 §2.1）。
 *
 * §2.1 要同時滿足三點才進 store：跨頁共用、有生命週期、不是可重取的清單快照。
 * 「登入身分與所屬公司」是它明列的少數幾項之一——每一頁的頁首都要顯示它，
 * 它在登入時建立、在登出時清除，而且**沒有任何端點可以重新取得它**（見下）。
 *
 * **這裡不存 access token。** token 在統一 client 的模組層變數裡（後端規範 §5.4.3），
 * 放進 store 會讓它出現在 devtools 的狀態樹上，也讓「誰讀得到 token」從一個檔案擴大到全站。
 *
 * ⚠️ **已知限制**：目前沒有「用 access token 換回登入身分」的端點，身分只能從登入回應取得。
 * 因此**重新整理頁面之後 store 是空的，使用者會被路由守衛送回登入頁**。
 * 後端補上讀取自身身分的端點之後，啟動時先 refresh 再取一次身分即可補上（§3.1）。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { SignedInIdentity } from '../shared/api/sessions.ts'

export const useAuthStore = defineStore('auth', () => {
  const identity = ref<SignedInIdentity | null>(null)

  // 對外只暴露 readonly 的衍生值與具名 action，**不把可寫的 ref 直接 return**（§2.2）。
  // 狀態能從任何元件直接賦值時，「這個值為什麼變了」要全域搜尋才答得出來。
  const isSignedIn = computed(() => identity.value !== null)
  const displayName = computed(() => identity.value?.user.displayName ?? '')
  const companyName = computed(() => identity.value?.company.name ?? '')

  const signIn = (next: SignedInIdentity): void => {
    identity.value = next
  }

  /**
   * §2.2 要求每個 store 都要有 `reset()`，並在登出與切換公司時被呼叫。
   * 沒有它的話，切換公司會殘留上一家公司的資料——畫面會出現使用者在新公司不該看到的東西。
   */
  const reset = (): void => {
    identity.value = null
  }

  return { isSignedIn, displayName, companyName, signIn, reset }
})
