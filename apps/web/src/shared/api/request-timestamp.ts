/**
 * envelope 的 `rqTS`：ISO 8601 **帶 `+08:00` 偏移**（後端規範 §1.3、§6.1）。
 *
 * 這是全前端唯一產生「帶時區偏移的時間字串」的地方，而且它只走傳輸層、
 * **永遠不上畫面**（前端規範 §9.2）。頁面不得自己組這個欄位。
 *
 * 為什麼不用 `toISOString()`：那會輸出 UTC（`Z`），而契約要的是台北時間加上 `+08:00`。
 * 為什麼不用 `toLocaleString` 之類的在地化 API：輸出跟著**裝置**的時區與地區設定跑——
 * 使用者把筆電時區設成東京，送出去的字串就多一小時，而畫面上不會有任何異狀。
 * 這裡改成先把時間軸平移到台北再一律用 UTC 取值，裝置時區完全不參與計算。
 */
const TAIPEI_OFFSET_MINUTES = 8 * 60
const TAIPEI_OFFSET_SUFFIX = '+08:00'

const pad2 = (value: number): string => String(value).padStart(2, '0')

export const currentRequestTimestamp = (): string => {
  const taipei = new Date(Date.now() + TAIPEI_OFFSET_MINUTES * 60_000)
  const date = `${String(taipei.getUTCFullYear())}-${pad2(taipei.getUTCMonth() + 1)}-${pad2(taipei.getUTCDate())}`
  const time = `${pad2(taipei.getUTCHours())}:${pad2(taipei.getUTCMinutes())}:${pad2(taipei.getUTCSeconds())}`
  return `${date}T${time}${TAIPEI_OFFSET_SUFFIX}`
}
