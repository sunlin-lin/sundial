/**
 * 政府 CSV 資源的讀取（零 IO 純函式，§0.1）。
 *
 * ## 為什麼會有這個檔案：健保署那兩份**只有 CSV**
 *
 * 既有四個資料集全部取 JSON（欄位名在內容裡，不必處理標頭列與跳脫），而 `dataset_code=2`
 * 與 `5` 沒有這個選項——健保署把資源託管在自己那裡（`info.nhi.gov.tw/api/iode0000s01/Dataset?rId=…`），
 * 2026-08 實測 `20251` 的 16 個資源與 `20246` 的 19 個資源**全部只有 CSV 一種格式**。
 *
 * ## 產物是「欄位名 → 值」的物件，不是位置索引
 *
 * 這樣兩支健保解析器的內文與既有四支 JSON 解析器**逐字同構**：一樣用一個 `FIELD` 常數把政府的
 * 欄位名逐字寫出來、一樣用 `readField` 取值。改成 `row[2]` 這種位置索引的話，
 * 政府在中間插一欄會讓每一欄的值整批位移，而位移之後每一個值單獨看都完全合法
 * ——月投保金額讀到本人負擔金額，是一個小一個數量級但完全正常的數字。
 *
 * ## 表頭逐字比對，而且它同時是**內容檢查**的一部分
 *
 * {@link parseCsvTable} 要求表頭與呼叫端給的清單完全一致（順序也一樣），不做「找得到就好」的比對。
 * 這對 `dataset_code=5` 特別重要：它的表頭裡寫著負擔比率
 * （`本人負擔金額（負擔比率30%）`、`投保單位負擔金額（負擔比率60%）`、`政府補助金額（補助比率10%）`），
 * 於是逐字比對同時擋住了「比率改了」——那是法規變更，必須有人知道，而它在資料列上完全看不出來
 *（每一格都還是合法的金額）。
 *
 * ## 引號跳脫是**呼叫端必須明講**的期望，不是「兩種都接受」
 *
 * 健保署那兩份（`dataset_code=2`、`5`）從來沒有出現過引號（實測 35 個資源），而財政部臺北國稅局的
 * 扣繳稅額表（`9`）**每一列都有**：第一欄是 `"80,001 ~ 80,500"`，加引號正是因為值裡有逗號。
 *
 * 因此 {@link CsvQuoting} 是必填參數且是封閉聯集，形式與 `regulatory-amount.ts` 的
 * `AmountUnit`／`PercentSuffix` 逐字相同：**呼叫端必須明講自己期望哪一種**。
 *
 * 做成「有沒有都接受」的代價是實的：健保署那兩份哪天冒出引號，寬容的版本會照樣解析成功，
 * 而那正是我們最需要有人去看一眼的時刻（引號代表某一欄的值裡出現了逗號，
 * 而那多半是政府把兩欄併成一欄或加了千分位）。宣告 `reject` 的那兩個資料集會當場失敗。
 *
 * 反過來說，`rfc4180` 那條路**不是一台沒有人跑過的狀態機**：`dataset_code=9` 的每一列、
 * 每一次同步都會經過它，而且測試餵的就是政府那一份的實測內容。
 * 這與「寫一個順便支援的版本」是兩件事——後者的問題從來不是複雜度，是沒有資料會經過它。
 */

/** UTF-8 BOM。健保署那兩份都帶（實測），不去掉的話第一個欄位名會變成 `﻿組別級距`。 */
const BYTE_ORDER_MARK = '﻿'

/** 這一份 CSV 期望的引號處置。封閉聯集，呼叫端必須明講，見檔頭。 */
export type CsvQuoting =
  /** 一律不該有引號（`dataset_code=2`、`5`）：出現引號即代表格式已變，整份失敗。 */
  | 'reject'
  /** RFC 4180 的引號欄位（`dataset_code=9` 的 `"80,001 ~ 80,500"`）。 */
  | 'rfc4180'

/** 一列 CSV → 各欄的原始字串（未 trim）。失敗代表引號用法讀不懂。 */
type CsvLineResult = { readonly ok: true; readonly cells: readonly string[] } | { readonly ok: false; readonly reason: string }

/**
 * 拆一列 RFC 4180 的 CSV。
 *
 * 支援的只有兩件事：以引號包住整個欄位，以及欄位內用 `""` 表示一個引號字元。
 * **不支援跨列的引號欄位**（欄位裡有換行）——那一種在讀到列尾時仍然停在引號內，
 * 本函式回失敗而不是把下一列接進來。實測財政部那八個年度一次都沒有出現過，
 * 而「把下一列接進來」會讓一份被截斷的檔案安靜地少掉一整列。
 *
 * 引號只准出現在欄位的開頭：`80,0"01` 這種值代表政府那一份壞了或我們讀錯了分隔符號，
 * 一律失敗（§7.2 的精神：讀不懂就停下來）。
 */
const splitRfc4180Line = (line: string): CsvLineResult => {
  const cells: string[] = []
  let index = 0

  while (index <= line.length) {
    if (line[index] === '"') {
      index += 1
      let value = ''
      for (;;) {
        const closing = line.indexOf('"', index)
        if (closing === -1) {
          return { ok: false, reason: `引號欄位沒有結尾的引號（本解析器不支援跨列的引號欄位）：${JSON.stringify(line)}` }
        }
        value += line.slice(index, closing)
        // `""` 是一個引號字元本身；否則這個引號就是欄位的結尾。
        if (line[closing + 1] === '"') {
          value += '"'
          index = closing + 2
          continue
        }
        index = closing + 1
        break
      }
      if (index < line.length && line[index] !== ',') {
        return { ok: false, reason: `引號欄位的結尾後面不是逗號：${JSON.stringify(line)}` }
      }
      cells.push(value)
      index += 1
      // 剛好在列尾結束（`index === line.length + 1`）時不再開下一欄。
      if (index > line.length) return { ok: true, cells }
      continue
    }

    const comma = line.indexOf(',', index)
    const end = comma === -1 ? line.length : comma
    const value = line.slice(index, end)
    if (value.includes('"')) {
      return { ok: false, reason: `引號出現在欄位中間（只支援整個欄位加引號）：${JSON.stringify(line)}` }
    }
    cells.push(value)
    if (comma === -1) return { ok: true, cells }
    index = comma + 1
  }

  return { ok: true, cells }
}

/** 拆一列 CSV，依呼叫端宣告的引號處置。`reject` 那一種的引號檢查在 {@link parseCsvTable} 一次做完。 */
const splitCsvLine = (line: string, quoting: CsvQuoting): CsvLineResult =>
  quoting === 'reject' ? { ok: true, cells: line.split(',') } : splitRfc4180Line(line)

/**
 * 一列 CSV：欄位名 → 值（值已 trim，空字串保留原樣，由呼叫端的 `readField` 決定要不要當成缺）。
 */
export type CsvRow = Readonly<Record<string, string>>

export type CsvTableResult =
  | { readonly ok: true; readonly rows: readonly CsvRow[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 把政府的 CSV 讀成一批「欄位名 → 值」。
 *
 * @param rawText 資源的原始內容（未經任何前處理，與寫進 `raw_data` 的是同一串）。
 * @param options `header` 是期望的表頭（**逐字、逐順序**）；`quoting` 是期望的引號處置（見檔頭）；
 *   `label` 是這份資料叫什麼，只用來組錯誤訊息——那句話會原樣進 `regulatory_sync_logs.error_message`。
 *
 * 每一格都會 trim。這與 `normalizeAmount` 去逗號同一種處置：前後空白是欄寬補齊，不是資訊，
 * 去掉它沒有做任何推測。**但欄位數不夠或多出來一律失敗**，不補空值也不忽略多的那一欄
 * ——補空值會讓「政府少給一欄」變成「那一欄是空的」，而後者在解析器眼中是一列缺值的資料，
 * 錯誤訊息會指向欄位內容，不會指向「這份 CSV 的形狀變了」。
 */
export const parseCsvTable = (
  rawText: string,
  options: { readonly header: readonly string[]; readonly quoting: CsvQuoting; readonly label: string },
): CsvTableResult => {
  const { header, quoting, label } = options

  if (quoting === 'reject' && rawText.includes('"')) {
    return {
      ok: false,
      reason: `${label}的 CSV 出現引號：本資料集宣告不使用 RFC 4180 的引號欄位（實測從未出現），格式已變`,
    }
  }

  const withoutBom = rawText.startsWith(BYTE_ORDER_MARK) ? rawText.slice(BYTE_ORDER_MARK.length) : rawText
  const lines = withoutBom.split(/\r?\n/)
  // 只去掉**尾端**的空行（政府那兩份都以換行結尾）。中間的空行是形狀異常，留給下面的欄位數檢查去紅。
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop()

  const [headerLine, ...dataLines] = lines
  if (headerLine === undefined) {
    return { ok: false, reason: `${label}的 CSV 是空的，一列都沒有` }
  }

  const headerCells = splitCsvLine(headerLine, quoting)
  if (!headerCells.ok) return { ok: false, reason: `${label}的 CSV 表頭讀不懂：${headerCells.reason}` }

  const actualHeader = headerCells.cells.map((cell) => cell.trim())
  if (actualHeader.length !== header.length || actualHeader.some((cell, index) => cell !== header[index])) {
    return {
      ok: false,
      reason:
        `${label}的 CSV 表頭與期望不符。期望：${header.join(',')}；` +
        `實際：${actualHeader.join(',')}（政府改了欄位名、欄位順序或欄位數）`,
    }
  }

  if (dataLines.length === 0) {
    // 只有表頭會「成功」地產生一個沒有任何資料的版本，而 Payroll 查得到版本、查不到內容。
    return { ok: false, reason: `${label}的 CSV 只有表頭，沒有任何資料列` }
  }

  const rows: CsvRow[] = []
  for (const [index, line] of dataLines.entries()) {
    const split = splitCsvLine(line, quoting)
    if (!split.ok) {
      return { ok: false, reason: `${label}的 CSV 第 ${String(index + 1)} 列讀不懂：${split.reason}` }
    }
    const cells = split.cells.map((cell) => cell.trim())
    if (cells.length !== header.length) {
      return {
        ok: false,
        reason:
          `${label}的 CSV 第 ${String(index + 1)} 列有 ${String(cells.length)} 個欄位，` +
          `期望 ${String(header.length)} 個：${JSON.stringify(line)}`,
      }
    }
    rows.push(Object.fromEntries(header.map((name, position) => [name, cells[position] ?? ''])))
  }

  return { ok: true, rows }
}

/**
 * 從一列裡取一個欄位。**空字串算缺**，與四支 JSON 解析器的 `readField` 逐字同一種處置。
 *
 * 表頭已經逐字比對過，因此「欄位不存在」在這裡走不到（真的走到代表呼叫端寫了表頭以外的欄位名）；
 * 但仍然回 `null` 而不是拋錯——回 `null` 之後，解析器既有的「這一欄缺值」訊息會照常帶出欄位名，
 * 而那句話比一個型別錯誤更接近看紀錄的人要的答案。
 */
export const readCsvField = (row: CsvRow, field: string): string | null => {
  const value = row[field]
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
