/**
 * 回應 envelope 的內部代碼（§1.3）。
 *
 * 這六個值的分類軸**不是 HTTP 語意，而是「前端拿到之後該做什麼」**——因此多個 HTTP status
 * 會映到同一個代碼（404 與 500 都是 '400'，409 與 422 都是 '300'）。要新增代碼之前先問：
 * 前端對它的處置是否真的與既有六種都不同？不是的話就不該新增。
 */
export const WebFlowCode = {
  DataSuccess: '200', // 正常
  DataInvalid: '100', // 資料不正確（呼叫端沒照契約來，屬開發期問題，不附 errors）
  LogicError: '300', // 邏輯錯誤（業務規則不允許），唯一會附 errors 的代碼
  SystemError: '400', // 系統錯誤
  AuthRequired: '900', // 無有效身分
  PermissionDenied: '901', // 有身分但無權限
} as const

export type WebFlowCodeValue = (typeof WebFlowCode)[keyof typeof WebFlowCode]
