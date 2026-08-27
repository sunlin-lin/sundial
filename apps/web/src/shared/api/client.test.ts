/**
 * 統一 client 的行為測試。
 *
 * **重點是 single-flight（前端規範 §3.1）**：那條規則是全文少數不靠靜態掃描、
 * 而是靠行為斷言的檢查——「有沒有收斂成一次 refresh」看程式碼形狀看不出來，
 * 只看得出跑起來發了幾次。
 *
 * 這裡 mock 的是**底層傳輸**（`replaceTransport`），不是 client 本身：
 * mock 掉 client 就等於在測 mock。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { forgetAccessToken, readAccessToken, rememberAccessToken } from './access-token.ts'
import { AuthRequiredError, BusinessRuleError, PermissionDeniedError } from './api-error.ts'
import { callApi, replaceTransport, setAuthRequiredHandler } from './client.ts'
import { axiosTransport, type Transport, type TransportRequest } from './http-transport.ts'
import { isRecord } from './record-shape.ts'
import { clearSessionDeadline } from './session-deadline.ts'

const REFRESH_PATH = '/sessions/main/refresh'
const PROBE_PATH = '/employees/main/list'
const PROBE_COMMAND = 'employees.main.list'

/** 只驗一個旗標欄位的 reader，讓測試專注在 client 的分支行為上。 */
const readProbeResult = (value: unknown): true | null =>
  isRecord(value) && value['ok'] === true ? true : null

const envelopeBody = (
  code: string,
  data: unknown,
  expiresIn: number | null,
  errors: readonly unknown[] = [],
): Record<string, unknown> => ({
  code,
  msg: '',
  errors,
  data,
  rspTS: '2026-08-27T10:00:00+08:00',
  cmd: PROBE_COMMAND,
  locale: 'zh-TW',
  expiresIn,
  exp: expiresIn === null ? null : '2026-08-27T12:00:00+08:00',
})

/** 讓出一次事件迴圈，用來確保三支請求真的同時在途中。 */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  // client、access token、deadline 都是模組層狀態，不清會讓測試互相汙染，
  // 而汙染的表現是「單獨跑會過、整批跑會失敗」這種最難查的形式。
  replaceTransport(axiosTransport)
  forgetAccessToken()
  clearSessionDeadline()
  setAuthRequiredHandler(() => undefined)
})

describe('並行的 refresh 收斂（single-flight）', () => {
  test('三支同時遇到 token 過期的請求，只會打出一次 refresh，且三支都拿到成功結果', async () => {
    rememberAccessToken('expired-token')

    const calledPaths: string[] = []
    let hasRefreshed = false

    const transport: Transport = async ({ path }: TransportRequest) => {
      calledPaths.push(path)
      await yieldToEventLoop()

      if (path === REFRESH_PATH) {
        hasRefreshed = true
        return { status: 200, payload: envelopeBody('200', { accessToken: 'fresh-token' }, 7200) }
      }

      // 換票之前一律回 900（沒有有效身分），換票之後才成功。
      return hasRefreshed
        ? { status: 200, payload: envelopeBody('200', { ok: true }, 7200) }
        : { status: 401, payload: envelopeBody('900', null, null) }
    }
    replaceTransport(transport)

    const results = await Promise.all([
      callApi(PROBE_COMMAND, PROBE_PATH, {}, readProbeResult),
      callApi(PROBE_COMMAND, PROBE_PATH, {}, readProbeResult),
      callApi(PROBE_COMMAND, PROBE_PATH, {}, readProbeResult),
    ])

    // (a) 底層實際只被打出一次 refresh——這是規則的全部重點。
    //     各自 refresh 的話，第二、第三支拿的是已被第一支換掉的舊票，
    //     後端依規定判定為外洩並作廢整條鏈，使用者在一次正常開頁動作中被踢回登入頁。
    expect(calledPaths.filter((path) => path === REFRESH_PATH)).toHaveLength(1)
    // (b) 三支請求最終都拿到成功結果。
    expect(results).toEqual([true, true, true])
    // 換回來的新票確實被記進記憶體，後續請求才帶得上。
    expect(readAccessToken()).toBe('fresh-token')
  })

  test('前一輪 refresh 結束後，下一輪會重新發出 refresh（in-flight promise 有被清掉）', async () => {
    rememberAccessToken('expired-token')

    const calledPaths: string[] = []
    let isTokenAccepted = false

    const transport: Transport = async ({ path }: TransportRequest) => {
      calledPaths.push(path)
      await yieldToEventLoop()

      if (path === REFRESH_PATH) {
        isTokenAccepted = true
        return { status: 200, payload: envelopeBody('200', { accessToken: 'fresh-token' }, 7200) }
      }
      if (isTokenAccepted) {
        // 第一輪成功之後把票再次判定為過期，模擬「隔了很久才做下一個操作」。
        isTokenAccepted = false
        return { status: 200, payload: envelopeBody('200', { ok: true }, 7200) }
      }
      return { status: 401, payload: envelopeBody('900', null, null) }
    }
    replaceTransport(transport)

    await callApi(PROBE_COMMAND, PROBE_PATH, {}, readProbeResult)
    await callApi(PROBE_COMMAND, PROBE_PATH, {}, readProbeResult)

    expect(calledPaths.filter((path) => path === REFRESH_PATH)).toHaveLength(2)
  })

  test('refresh 也失敗時清掉記憶體中的 token 並通知導向登入頁', async () => {
    rememberAccessToken('expired-token')

    let hasAskedForLogin = false
    setAuthRequiredHandler(() => {
      hasAskedForLogin = true
    })

    replaceTransport(async () => ({ status: 401, payload: envelopeBody('900', null, null) }))

    await expect(callApi(PROBE_COMMAND, PROBE_PATH, {}, readProbeResult)).rejects.toBeInstanceOf(
      AuthRequiredError,
    )
    expect(readAccessToken()).toBeNull()
    expect(hasAskedForLogin).toBe(true)
  })
})

describe('依 code 分支', () => {
  test('901 只拋無權限錯誤，不清 token 也不通知導向登入頁', async () => {
    rememberAccessToken('valid-token')

    let hasAskedForLogin = false
    setAuthRequiredHandler(() => {
      hasAskedForLogin = true
    })

    replaceTransport(async () => ({ status: 403, payload: envelopeBody('901', null, 7200) }))

    await expect(callApi(PROBE_COMMAND, PROBE_PATH, {}, readProbeResult)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
    // 把 403 當 401 導向登入頁，會產生「登入 → 點到沒權限的功能 → 被踢回登入頁」的無限迴圈。
    expect(hasAskedForLogin).toBe(false)
    expect(readAccessToken()).toBe('valid-token')
  })

  test('300 拋出帶 errors 的業務錯誤，供畫面依 field 的 dot-path 定位', async () => {
    replaceTransport(async () => ({
      status: 422,
      payload: envelopeBody('300', null, null, [
        { code: 'sessions.main.errors.invalid-credentials', msg: '帳號或密碼錯誤', data: { field: 'password' } },
      ]),
    }))

    const failure = await callApi(PROBE_COMMAND, PROBE_PATH, {}, readProbeResult).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(BusinessRuleError)
    expect(failure).toHaveProperty('errors.0.code', 'sessions.main.errors.invalid-credentials')
  })
})

describe('request envelope 的基底三欄由 client 自動補上', () => {
  test('rqTS 帶 +08:00 偏移，cmd 與 locale 不必由頁面提供', async () => {
    let sent: Readonly<Record<string, unknown>> = {}
    replaceTransport(async ({ body }: TransportRequest) => {
      sent = body
      return { status: 200, payload: envelopeBody('200', { ok: true }, 7200) }
    })

    await callApi(PROBE_COMMAND, PROBE_PATH, { keyword: '王' }, readProbeResult)

    expect(sent['cmd']).toBe(PROBE_COMMAND)
    expect(sent['locale']).toBe('zh-TW')
    expect(sent['keyword']).toBe('王')
    expect(String(sent['rqTS'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
  })
})
