/**
 * 登入與登出的呼叫。
 *
 * ⚠️ ⚠️ **本檔整份都是暫時的，`bun run gen:api` 可用之後必須整份換掉。** ⚠️ ⚠️
 *
 * 前端規範 §3.2 明文禁止手寫描述 API 形狀的 `interface`／`type`，§0.10 也禁止手寫的
 * `api/<領域>/*.api.ts` 包裝樹——請求與回應型別、以及 API client 函式，一律由後端 OpenAPI
 * 產生（`bun run gen:api`）。**目前那條產生鏈還不存在**（後端的 sessions 路由尚未掛上組裝點，
 * 因此還產不出 openapi.json），前端沒有任何合法的型別來源，於是這裡先就地寫下最小的形狀。
 *
 * **為什麼寫在這裡而不是頁面裡**：手寫的形狀本質上是把後端契約複製一份，複製品一定會漂移。
 * 至少要讓它**只有一份、而且集中在統一 client 內**——後端改欄位時要改的是這一個檔案，
 * 而不是散在各頁的 N 份副本。
 *
 * **`gen:api` 可用之後要換掉的東西（一個都不能留）**：
 *   1. `LoginInput`             → 產生的 `sessions.main.login` request 型別
 *   2. `SignedInIdentity`       → 產生的 `sessions.main.login` response `data` 型別
 *   3. `readLoginData`          → 產生的 client 已收窄回傳型別，這個 reader 就沒有存在理由
 *   4. `readLogoutData`         → 同上
 *   5. `login()` / `logout()`   → 產生的 client 函式（§0.10：不再有手寫包裝層）
 *   另外 client.ts 內的 `readRefreshedAccessToken` 也是同一批。
 *
 * 產生器的 fetcher **必須注入本專案的統一 client**（§3.1），禁止使用預設 fetcher：
 * 用預設 fetcher 的請求會繞過 token 附加、single-flight refresh、envelope 拆解與 `code` 分支，
 * 而且**在本機開發時完全看不出來**——access token 在有效期內不會過期，refresh 那條路徑
 * 要等兩、三個小時後才走得到，那時候通常已經上線了。
 */
import { rememberAccessToken } from './access-token.ts'
import { callApi, discardSession } from './client.ts'
import { isRecord, readNonEmptyString } from './record-shape.ts'

/** ⚠️ 暫時型別，見檔頭第 1 項。對應後端 `POST /sessions/main/login` 的業務欄位。 */
export type LoginInput = {
  readonly companyCode: string
  readonly username: string
  readonly password: string
}

/** ⚠️ 暫時型別，見檔頭第 2 項。登入成功後拿到的「登入身分與所屬公司」。 */
export type SignedInIdentity = {
  readonly user: {
    readonly id: string
    readonly companyUserId: string
    readonly displayName: string
  }
  readonly company: {
    readonly id: string
    readonly companyCode: string
    readonly name: string
  }
}

/**
 * 登入回應的 `data`：`{ accessToken, user, company }`。
 *
 * access token 不進這個函式的回傳值，而是直接交給記憶體保管（見下方 `login`）——
 * 讓它不要有機會被誰放進 store、放進 localStorage，或不小心印到 log 裡。
 */
const readLoginResult = (
  value: unknown,
): { readonly accessToken: string; readonly identity: SignedInIdentity } | null => {
  if (!isRecord(value)) return null

  const accessToken = readNonEmptyString(value, 'accessToken')
  const rawUser = value['user']
  const rawCompany = value['company']
  if (accessToken === null || !isRecord(rawUser) || !isRecord(rawCompany)) return null

  const id = readNonEmptyString(rawUser, 'id')
  const companyUserId = readNonEmptyString(rawUser, 'companyUserId')
  const displayName = readNonEmptyString(rawUser, 'displayName')
  const companyId = readNonEmptyString(rawCompany, 'id')
  const companyCode = readNonEmptyString(rawCompany, 'companyCode')
  const companyName = readNonEmptyString(rawCompany, 'name')

  if (id === null || companyUserId === null || displayName === null) return null
  if (companyId === null || companyCode === null || companyName === null) return null

  return {
    accessToken,
    identity: {
      user: { id, companyUserId, displayName },
      company: { id: companyId, companyCode, name: companyName },
    },
  }
}

/** 登出回應的 `data`：`{ ok: true }`。 */
const readLogoutResult = (value: unknown): true | null =>
  isRecord(value) && value['ok'] === true ? true : null

/**
 * 登入。
 *
 * 失敗時後端回 **422 ＋ `code='300'` ＋ `errors[0].code = 'sessions.main.errors.invalid-credentials'`**，
 * 不是 `900`（後端規範 §1.3）——因為使用者已經在登入頁了，「導向登入頁」對他不是一個動作。
 * 因此呼叫端會收到 `BusinessRuleError`，而不是被 client 導走。
 *
 * 成功時把 access token 交給記憶體保管（§5.4.3），**回傳值不含它**：
 * 呼叫端拿到的只有「登入身分與所屬公司」，那才是能進 store 的東西（§2.1）。
 */
export const login = async (input: LoginInput): Promise<SignedInIdentity> => {
  const result = await callApi(
    'sessions.main.login',
    '/sessions/main/login',
    { companyCode: input.companyCode, username: input.username, password: input.password },
    readLoginResult,
  )

  // refresh 票同時由後端以 httpOnly cookie 下發，前端讀不到也不需要讀（§5.4.3）。
  // 這一行是全前端僅有的兩處 access token 寫入之一（另一處是 client 內的 refresh）。
  rememberAccessToken(result.accessToken)
  return result.identity
}

/**
 * 登出。
 *
 * 不論後端怎麼回，**記憶體中的 token 一律清掉**：使用者按了登出就是要離開，
 * 讓一個「登出失敗」的錯誤把他留在已登入狀態，是他最不預期的結果。
 * 後端那一側的作廢是整條輪替鏈（後端規範 §5.4.7），與這裡清不清無關。
 */
export const logout = async (): Promise<void> => {
  try {
    await callApi('sessions.main.logout', '/sessions/main/logout', {}, readLogoutResult)
  } finally {
    discardSession()
  }
}
