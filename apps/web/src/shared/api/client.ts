/**
 * 專案唯一的 HTTP client（前端規範 §3.1）。
 *
 * **元件、store、composable 一律禁止 import axios，所有請求都走這裡。** 集中在這裡的有五件事：
 * 附上 access token、補齊 envelope 的三個基底欄位（`rqTS`／`cmd`／`locale`）、
 * 覆寫 session deadline、依 `code` 分支、以及把後端錯誤轉成型別化錯誤。
 * 這幾件事若散落各頁，任一項要改就得改遍全站——而**漏改的那幾頁不會編譯失敗**，
 * 只會在 token 過期或後端回非 `200` 時默默壞掉。
 *
 * 對外只回 `data`，失敗一律拋型別化錯誤；頁面碰不到 `rspTS`／`locale`／`msg`／`exp`。
 */
import { forgetAccessToken, readAccessToken, rememberAccessToken } from './access-token.ts'
import { AuthRequiredError, BusinessRuleError, PermissionDeniedError, SystemFailureError } from './api-error.ts'
import { parseResponseEnvelope, WEB_FLOW_CODE, type ResponseEnvelope } from './envelope.ts'
import { axiosTransport, type Transport } from './http-transport.ts'
import { isRecord, readNonEmptyString } from './record-shape.ts'
import { currentRequestTimestamp } from './request-timestamp.ts'
import { clearSessionDeadline, isSessionDeadlinePassed, renewSessionDeadline } from './session-deadline.ts'

/** 介面語言（後端規範 §1.3 的 `locale`）。目前只有 zh-TW。 */
const LOCALE = 'zh-TW'

const REFRESH_PATH = '/sessions/main/refresh'
const REFRESH_COMMAND = 'sessions.main.refresh'

/**
 * 把 `unknown` 的 `data` 收斂成呼叫端要的型別，形狀不符回 `null`。
 *
 * 為什麼要每支端點自己帶一個 reader：`gen:api` 產生的型別還不存在（見 sessions.ts 的說明），
 * 而外部邊界一律先當 `unknown`、驗證過才進業務邏輯（通用規範 §2.2）。
 * 沒有這一步的話，收斂只能靠 `as`——那不做任何執行期轉換，只是叫編譯器閉嘴，
 * 後端改了欄位之後錯誤會在好幾層之外以 `Cannot read property of undefined` 爆出來。
 */
export type DataReader<TData> = (value: unknown) => TData | null

// --- 全域處置的掛載點 -------------------------------------------------------
//
// `900` 要導向登入頁、`901` 要顯示無權限、系統錯誤要進錯誤回報——這三件事需要 router 與 UI。
// client 直接 import router 會形成 `shared/ → router/ → pages/` 的循環相依（§0.11 明文禁止），
// 而循環相依在 Vite 底下大多不報錯，症狀是「某個模組在初始化時是 undefined」，
// 只在特定進入順序下發作，本機開發通常碰不到。改成由啟動點注入，方向就只有一個。

let authRequiredHandler: (() => void) | null = null
let permissionDeniedHandler: ((message: string) => void) | null = null
let systemFailureHandler: ((failure: SystemFailureError) => void) | null = null

export const setAuthRequiredHandler = (handler: () => void): void => {
  authRequiredHandler = handler
}

export const setPermissionDeniedHandler = (handler: (message: string) => void): void => {
  permissionDeniedHandler = handler
}

export const setSystemFailureHandler = (handler: (failure: SystemFailureError) => void): void => {
  systemFailureHandler = handler
}

let transport: Transport = axiosTransport

/**
 * 換掉底層傳輸。
 *
 * 正式執行期沒有人呼叫它——存在的理由是 §3.1 規定 single-flight 必須用**行為斷言**證明：
 * mock 底層請求、同時發三支過期的請求、斷言只打出一次 refresh。
 * 「有沒有收斂」看程式碼形狀看不出來，只看得出跑起來發了幾次。
 */
export const replaceTransport = (next: Transport): void => {
  transport = next
}

// --- 送出與拆解 -------------------------------------------------------------

const sendEnvelope = async (path: string, body: Readonly<Record<string, unknown>>): Promise<ResponseEnvelope> => {
  const response = await transport({ path, body, accessToken: readAccessToken() })
  const envelope = parseResponseEnvelope(response.payload)

  if (envelope === null) {
    // 不是 envelope：多半打到了 proxy 的錯誤頁，或前後端部署不同步（後端規範 §1.3 的 404 那一段）。
    throw new SystemFailureError('回應格式不符契約', `http-${String(response.status)}`, null)
  }

  // §3.7：**先無條件覆寫 deadline，再依 `code` 分支。**
  // 這一行的位置就是規則本身——寫進成功分支裡的話，`100`／`300`／`400`／`901` 這些
  // 同樣帶著續期後秒數的回應就不會續期，於是使用者每遇到一次錯誤（尤其是點到沒權限的功能）
  // 就少活一次續期，最後在一連串正常操作中莫名其妙被登出。
  renewSessionDeadline(envelope.expiresIn)

  return envelope
}

const buildRequestEnvelope = (command: string, body: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
  // 三個基底欄位由 client 自動補上，頁面不得自己組（§3.1）。
  rqTS: currentRequestTimestamp(),
  cmd: command,
  locale: LOCALE,
  // 業務欄位平鋪在同一層，不另開 payload 節點（後端規範 §1.3）。
  ...body,
})

// --- refresh 的 single-flight 收斂 -----------------------------------------

/**
 * refresh 回應的 `data`。
 *
 * ⚠️ **暫時型別**：`bun run gen:api` 可用之後必須換成產生型別（§3.2 禁止手寫 DTO）。
 * 這一支的形狀刻意留在 client 內部而不是 sessions.ts，因為 refresh **只能在 client 內做**
 *（§3.1）——頁面連呼叫它的機會都不該有。
 */
const readRefreshedAccessToken = (value: unknown): string | null =>
  isRecord(value) ? readNonEmptyString(value, 'accessToken') : null

let refreshInFlight: Promise<boolean> | null = null

const runRefresh = async (): Promise<boolean> => {
  const envelope = await sendEnvelope(REFRESH_PATH, {
    rqTS: currentRequestTimestamp(),
    cmd: REFRESH_COMMAND,
    locale: LOCALE,
  })

  if (envelope.code !== WEB_FLOW_CODE.DataSuccess) return false

  const token = readRefreshedAccessToken(envelope.data)
  if (token === null) return false

  rememberAccessToken(token)
  return true
}

/**
 * 併發的 refresh 必須收斂成**同一個** promise（§3.1）。
 *
 * 為什麼這條特別重要：後端的 refresh token 是一次性輪替＋偷用偵測（後端規範 §5.4.2）。
 * 一個頁面初始化時同時打三支查詢很常見，三支同時撞到 access token 過期也很常見；
 * 各自去 refresh 的話，第二、第三支拿的是**已經被第一支換掉的舊票**，後端依規定判定為外洩，
 * 整條鏈作廢，使用者在一次完全正常的開頁動作中被踢回登入頁。
 * 而且**錯誤現場當場消失**——重登之後一切正常，log 上只有一次偷用偵測，沒有人重現得出來。
 *
 * `.finally` 的清除必須等 refresh 真的結束（成功或失敗）才做，下一輪才會重新開始；
 * 提早清掉就等於沒有收斂。
 */
const refreshOnce = (): Promise<boolean> => {
  refreshInFlight ??= runRefresh()
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

const abandonSession = (): void => {
  forgetAccessToken()
  clearSessionDeadline()
}

// --- 依 `code` 分支（§3.6，全站只做這一次） --------------------------------

const resolveEnvelope = <TData>(envelope: ResponseEnvelope, readData: DataReader<TData>): TData => {
  switch (envelope.code) {
    case WEB_FLOW_CODE.DataSuccess: {
      const data = readData(envelope.data)
      if (data === null) {
        throw new SystemFailureError('回應的 data 形狀不符契約', envelope.code, envelope.exp)
      }
      return data
    }

    case WEB_FLOW_CODE.AuthRequired: {
      abandonSession()
      authRequiredHandler?.()
      throw new AuthRequiredError(envelope.msg)
    }

    case WEB_FLOW_CODE.PermissionDenied: {
      // 身分還是有效的，**絕對不清 token、絕對不導登入頁**（§3.6）。
      permissionDeniedHandler?.(envelope.msg)
      throw new PermissionDeniedError(envelope.msg)
    }

    case WEB_FLOW_CODE.LogicError: {
      // 業務錯誤：`errors` 交給呼叫端依 `data.field` 的 dot-path 定位（§6.3）。
      throw new BusinessRuleError(envelope.msg, envelope.errors)
    }

    default: {
      // `100`／`400`／以及任何沒見過的 code：一律當系統錯誤，細節不對使用者顯示。
      const failure = new SystemFailureError('系統錯誤', envelope.code, envelope.exp)
      systemFailureHandler?.(failure)
      throw failure
    }
  }
}

// --- 對外唯一入口 -----------------------------------------------------------

/**
 * 呼叫一支後端端點。
 *
 * @param command 端點的 `cmd`，等於路徑去掉開頭 `/` 再把 `/` 換成 `.`（後端規範 §1.3）
 * @param path    後端端點路徑，固定三段
 * @param body    業務欄位，平鋪；基底三欄由本函式補上
 * @param readData 把 `data` 收斂成呼叫端型別的驗證函式
 */
export const callApi = async <TData>(
  command: string,
  path: string,
  body: Readonly<Record<string, unknown>>,
  readData: DataReader<TData>,
): Promise<TData> => {
  const requestEnvelope = buildRequestEnvelope(command, body)

  // 已經知道票過期就先換票，讓同時出發的一批請求共用同一次 refresh。
  // 少了這一段也不會壞（下面的 `900` 分支會補上），只是每一支都得先浪費一次往返。
  if (readAccessToken() !== null && isSessionDeadlinePassed()) {
    await refreshOnce()
  }

  let envelope = await sendEnvelope(path, requestEnvelope)

  if (envelope.code === WEB_FLOW_CODE.AuthRequired && path !== REFRESH_PATH) {
    const hasNewToken = await refreshOnce()
    if (hasNewToken) {
      // 重試是一次新的請求，`rqTS` 要重新產生——沿用舊值會讓 log 上的時序對不上。
      envelope = await sendEnvelope(path, { ...requestEnvelope, rqTS: currentRequestTimestamp() })
    }
  }

  return resolveEnvelope(envelope, readData)
}

/**
 * 明確放棄目前的身分。
 *
 * 登出成功後、以及改密碼成功後（§4.2：改密碼會作廢所有 session，必須立刻清掉手上的 token
 * 並導回登入頁，否則使用者會看到一連串莫名其妙的 `900`）由呼叫端呼叫。
 */
export const discardSession = abandonSession
