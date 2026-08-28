/**
 * `dataset_code = 8` 最低工資（月薪與時薪）的來源探索與解析器（零 IO 純函式，§0.1）。
 *
 * 來源：勞動部「歷年最低工資/基本工資調整」公告頁
 * （`https://www.mol.gov.tw/1607/28162/28166/28180/70460/76761/`，2026-08 實地查證）。
 * 內容區塊逐字如下（**沒有任何 `<span>` 把數字切開**，這一點很重要，見下）：
 *
 * ```html
 * <li>民國113年9月19日發布，自114年1月1日起實施，訂定每月最低工資為28,590元，每小時最低工資為190元。</li>
 * <li>民國114年10月21日發布，自115年1月1日起實施，訂定每月最低工資為29,500元，每小時最低工資為196元。</li>
 * ```
 *
 * ## 三個來源都看過，選了這一個，另外兩個各輸在哪
 *
 * **① data.gov.tw `6281`「基本工資之制定與調整經過」——不用，而且是最危險的一個。**
 * 它有乾淨的 `實施日期` 欄位，看起來最理想，但**內容停在民國 113 年施行的 183 元**，
 * 缺 114、115 兩次調整，而它的 `modifiedDate` 仍顯示 2026-06。也就是說：
 * 自動同步會成功、會拿到一個完全合理的舊值、不會報任何錯（計畫 §7.0）。
 * **這比沒有資料更危險**，因為錯誤是靜默的。
 *
 * **② 行政院公報 XML——輸在它多了一層會產生「合理錯值」的轉換。**
 * 它最權威、生效日最乾淨（公告全文），但公告裡的金額寫成**中文數字**
 * （「二萬九千五百元」「一百九十六元」）。中文數字轉換寫錯時**不會轉不出來，會轉出一個合法的數字**
 * ——漏讀一個位就是 2,950 或 29,050，兩者都通得過 decimal 字串的驗證、都通得過形狀驗證，
 * 而錯的是全國法定的工資下限。這個模組的每一條規則都在避免「合理的錯值」，
 * 而這條路是**主動**引進一個。次要的理由是資源探索：公報是全政府的，要靠關鍵字搜尋去撈那一則，
 * 而搜尋條件本身就是一個會靜靜漏掉新公告的地方。
 *
 * **③ 勞動部公告頁——選它。** 金額是阿拉伯數字帶千分位、句型固定、實施日就寫在同一句話裡。
 * 最重要的是**它讀不懂的時候是真的讀不懂**：句型變了就比對不到，於是失敗（§7.2），
 * 而不是產出一個看起來合理的值。權威性確實不如公報，但公報那一份的內容與這一頁是同一件事，
 * 而這一頁是勞動部自己維護的權威公告清單。
 *
 * ## ⚠️ 「基本工資之制訂與調整經過」那一頁**刻意不爬**，代價寫在這裡
 *
 * 民國 113 年以前的調整在另一頁（`…/28182/28184/29016/`）。不爬它的理由**不是**它難解析
 * （雖然它確實把每個數字包在 `<span>` 裡），是**它的公告有一半不是自足的**：
 *
 * ```
 * 民國101年10月16日發布，自102年1月1日起實施，每小時基本工資調整為109元。   ← 只調時薪
 * 民國102年4月2日發布，自102年4月1日起實施，每月基本工資調整為19,047元。    ← 只調月薪
 * ```
 *
 * 本資料集的一個版本必須同時有月薪與時薪兩筆（Payroll 兩者都要）。單值公告只有兩條路可走，
 * 而**兩條都不能走**：
 *
 * - 把單值公告排除 → `resolve` 在那段期間會回**上一版**，於是 102 年 1 月起的時薪仍然是舊值，
 *   一個完全合理、不會報錯的錯數字。
 * - 讓新版本「繼承」上一版沒被調整的那一個值 → 那是**推測**，正是計畫 §7.2 禁止的那一類。
 *
 * 因此民國 113 年以前的基本工資**不在這個資料集裡**。Payroll 補算 113 年以前的期間會查不到版本，
 * 而依 §7.2 那是一個明確的錯誤，不是安靜的錯值。這與 `dataset_code=2` 只回補到民國 110 年 1 月、
 * `1`／`4`／`6` 只有當期版本是同一類的、已經寫在計畫 §7.0 裡的代價。
 *
 * ## 一頁 → N 個版本，走的是多資源那條路
 *
 * 每一則公告是一個版本，而**版本代碼從公告本文就知道**（`自115年1月1日起實施`），
 * 因此它走 `RegulatoryMultiVersionSource`：探索（列出公告）→ 推導生效日 → 幂等判定 → 逐一寫入。
 * 三個「資源」欄位的對應是：`resourceDescription` ＝ 那一則公告的原文、
 * `downloadUrl` ＝ **公告頁本身**（每一則都一樣，它們在同一頁上）。
 *
 * ⚠️ 因此本資料集的 `raw_data` 是**整頁 HTML**，而同一次探索建立的多個版本會有**相同的 checksum**。
 * 那個欄位的不變式仍然成立（checksum 與**同一列的** `raw_data` 對得起來），只是它回答的問題變成
 * 「那一頁變了沒」而不是「這一則公告變了沒」。代價可接受：既有版本本來就不重抓（見 run 切片），
 * 因此 checksum 在這個資料集上不參與任何判定。
 */
import type { RegulatoryRecordData } from '../../datasets/regulatory-datasets.service.ts'
import { normalizeAmount, INTEGER_AMOUNT_PATTERN } from './regulatory-amount.ts'
import { listHtmlListItems, sliceHtmlBetween, toPlainText } from './regulatory-html.ts'
import { parseRocCompactDate } from './regulatory-roc-date.ts'
import type {
  ParsedRegulatoryRecord,
  RegulatoryEffectiveFromResult,
  RegulatoryParseContext,
  RegulatoryRecordsResult,
} from './regulatory-sync-model.ts'
import { toSourceResource, type RegulatorySourceResourceListResult } from './regulatory-source-resource.ts'

/** `dataset_code=8` 的 `data` 形狀（唯一來源在 `datasets/domain/regulatory-record-shape.ts`）。 */
type MinimumWage = RegulatoryRecordData<8>

/**
 * 公告頁網址。**這是這個資料集唯一寫死的政府位址**（沒有 metadata API 可以探索，見檔頭）。
 *
 * 網址壞掉的形式是 404 或改版，兩者都會讓探索抓不到任何公告 → 失敗。
 */
export const MINIMUM_WAGE_PAGE_URL = 'https://www.mol.gov.tw/1607/28162/28166/28180/70460/76761/'

/**
 * 內容區塊的兩端。**逐字比對，找不到就整批失敗**（見 `regulatory-html.ts` 檔頭那條規則）。
 *
 * 不從整頁抓 `<li>` 的理由很具體：那一頁的導覽列與麵包屑裡也有「最低工資」四個字（實測整頁 25 處），
 * 而導覽列的項目在版面調整時會變。鎖在內容區塊之後，改版的結果是**一則公告都抓不到**（失敗），
 * 不是「抓到一則導覽列的文字」。
 */
const CONTENT_SECTION_OPEN = '<section class="cp">'
const CONTENT_SECTION_CLOSE = '</section>'

/**
 * 候選判準（計畫 §7.1.2）：**條列文字要含「最低工資」四個字才是候選。**
 *
 * 內容區塊裡除了公告，還有頁面自己的資訊（`更新日期:2025-12-04`、`發布單位:…`）與一個指向
 * 歷年基本工資的連結（`歷年基本工資調整情形`）。它們**不是公告**，因此排除而不是失敗。
 *
 * **這個判準的失敗方向是對的**：政府新增一則最低工資公告時，那一則一定含這四個字（它是法定名稱），
 * 於是它會成為候選；如果句型改了，它會以**候選但推導不出來**的身分失敗（§7.2），
 * 而不是安靜地掉出候選範圍。反過來說，若哪天連「最低工資」這個詞都不用了，
 * 候選數會從 2 掉到 0，而摘要裡的「另有 N 個條列不在候選範圍」會跟著跳——那是要人去看的訊號。
 */
const ANNOUNCEMENT_KEYWORD = '最低工資'

/**
 * 一則公告的完整句型，**整句錨定**。
 *
 * ```
 * 民國114年10月21日發布，自115年1月1日起實施，訂定每月最低工資為29,500元，每小時最低工資為196元。
 * ```
 *
 * ## 為什麼是 `^…$` 而不是「在句子裡找幾個數字」
 *
 * 這是本檔最重要的一行。寬鬆的寫法（找到「每月最低工資為X元」就算數）在頁面改版時的行為是
 * **抓到一個看起來合理的值**——例如政府把說明改成「自115年1月1日起實施，
 * 每月最低工資為29,500元（114年為28,590元）」，寬鬆的 pattern 會挑到其中一個，而挑錯的那一半
 * 沒有任何症狀。整句錨定的行為是**比對不到 → 這一則失敗 → `error_message` 裡看得到原文**，
 * 而那正是計畫 §7.2 要的方向：讀不懂就停下來，不要挑一個看起來合理的解釋。
 *
 * 兩個民國日期都用 `(?<!\d)` 以外的方式擋掉西元寫法：整句錨定已經把年份鎖在「民國」與「自」後面，
 * 而日曆合法性（閏年、月份、日數）交給 `parseRocCompactDate`，本檔不重寫一份。
 *
 * 金額允許千分位逗號（政府那一頁的月薪帶逗號、時薪不帶），去逗號由 `normalizeAmount` 做——
 * 那一步沒有損失任何資訊，也沒有做任何推測。
 */
const ANNOUNCEMENT_PATTERN =
  /^民國(\d{2,3})年(\d{1,2})月(\d{1,2})日發布，自(\d{2,3})年(\d{1,2})月(\d{1,2})日起實施，訂定每月最低工資為([\d,]+)元，每小時最低工資為([\d,]+)元。$/

const pad2 = (value: string): string => value.padStart(2, '0')

/** 一則公告拆解之後的內容。 */
type Announcement = {
  /** 公告發布日 `YYYY-MM-DD`。 */
  readonly announcedOn: string
  /** 實施日 `YYYY-MM-DD`＝這個版本的 `effective_from`。 */
  readonly effectiveFrom: string
  /** 每月最低工資，decimal 字串。 */
  readonly monthlyAmount: string
  /** 每小時最低工資，decimal 字串。 */
  readonly hourlyAmount: string
}

type AnnouncementResult =
  | { readonly ok: true; readonly value: Announcement }
  | { readonly ok: false; readonly reason: string }

/**
 * 一則公告原文 → 拆解結果。
 *
 * **同一支函式同時被探索（推導生效日）與解析（產出 records）呼叫**，因此兩者不可能對同一句話
 * 有不同的解讀。分成兩份的話，其中一份哪天放寬了句型，會出現「探索建得出版本代碼、
 * 解析卻讀不出金額」這種要看兩個檔案才想得通的失敗。
 */
const parseAnnouncement = (text: string): AnnouncementResult => {
  const matched = ANNOUNCEMENT_PATTERN.exec(text)
  if (matched === null) {
    return {
      ok: false,
      reason:
        '公告句型無法辨識（期望「民國N年N月N日發布，自N年N月N日起實施，訂定每月最低工資為X元，每小時最低工資為Y元。」）：' +
        JSON.stringify(text),
    }
  }

  const announcedOn = parseRocCompactDate(`${matched[1] ?? ''}${pad2(matched[2] ?? '')}${pad2(matched[3] ?? '')}`)
  if (!announcedOn.ok) return { ok: false, reason: `公告的發布日不合法（${announcedOn.reason}）：${JSON.stringify(text)}` }

  const effectiveFrom = parseRocCompactDate(`${matched[4] ?? ''}${pad2(matched[5] ?? '')}${pad2(matched[6] ?? '')}`)
  if (!effectiveFrom.ok) {
    return { ok: false, reason: `公告的實施日不合法（${effectiveFrom.reason}）：${JSON.stringify(text)}` }
  }

  const monthlyAmount = normalizeAmount(matched[7] ?? '')
  const hourlyAmount = normalizeAmount(matched[8] ?? '')
  if (!INTEGER_AMOUNT_PATTERN.test(monthlyAmount) || !INTEGER_AMOUNT_PATTERN.test(hourlyAmount)) {
    return { ok: false, reason: `公告的金額不是整數元：${JSON.stringify(text)}` }
  }

  // 完整性檢查：月薪必須大於時薪。**這不需要引進任何法規知識**——兩個數字都在同一句話裡，
  // 對不起來就是 pattern 的兩個擷取群組換了位置，而換了之後每一個值單獨看都完全合法
  //（`29500` 與 `196` 都是合法的工資金額）。這是本資料集唯一擋得住「兩欄對調」的東西。
  if (BigInt(monthlyAmount) <= BigInt(hourlyAmount)) {
    return {
      ok: false,
      reason: `公告的每月最低工資 ${monthlyAmount} 不大於每小時最低工資 ${hourlyAmount}：兩個金額可能對調了：${JSON.stringify(text)}`,
    }
  }

  return {
    ok: true,
    value: { announcedOn: announcedOn.value, effectiveFrom: effectiveFrom.value, monthlyAmount, hourlyAmount },
  }
}

/** 內容區塊裡的每一則條列（已轉成純文字）。找不到區塊時回 `null`＝頁面結構已變更。 */
const listContentItems = (pageHtml: string): readonly string[] | null => {
  const section = sliceHtmlBetween(pageHtml, CONTENT_SECTION_OPEN, CONTENT_SECTION_CLOSE)
  if (section === null) return null
  return listHtmlListItems(section).map(toPlainText)
}

/**
 * 資源探索：公告頁 HTML → 每一則條列一個「資源」。
 *
 * **含非候選的條列也一起回傳**，這是刻意的：候選判準統一由 {@link deriveMinimumWageEffectiveFrom}
 * 執行，於是被排除的數量會經過 `planMultiVersionSync` 進到同步摘要（計畫 §7.1.2 要求排除不得靜默）。
 * 在這一層先過濾掉的話，那個數字就永遠不會有人看到——而「政府把公告改成別的寫法」正是
 * 我們要從那個數字上看見的事。
 *
 * 每一個資源的 `downloadUrl` 都是**同一個公告頁網址**（它們在同一頁上），
 * 幂等因此完全靠 `version_code`，見 `regulatory-multi-version-plan.ts` 檔頭。
 */
export const listMinimumWageAnnouncements = (pageHtml: string): RegulatorySourceResourceListResult => {
  const items = listContentItems(pageHtml)
  if (items === null) {
    return {
      ok: false,
      reason: `最低工資公告頁找不到內容區塊（期望 ${CONTENT_SECTION_OPEN} … ${CONTENT_SECTION_CLOSE}）：頁面結構已變更`,
    }
  }

  const values = []
  for (const item of items) {
    if (item === '') continue
    const resource = toSourceResource(
      { downloadUrl: MINIMUM_WAGE_PAGE_URL, resourceDescription: item, sourceModifiedAt: null },
      '最低工資公告頁的條列',
    )
    if (!resource.ok) return resource
    values.push(resource.value)
  }

  if (values.length === 0) {
    // 內容區塊在、但一則條列都沒有＝那一頁的內容換了組織方式。
    return { ok: false, reason: '最低工資公告頁的內容區塊裡一個條列都沒有：頁面結構已變更' }
  }

  return { ok: true, values }
}

/**
 * 生效日推導**與候選判準**（計畫 §7.2 ＋ §7.1.2 在本資料集上的落點）。
 *
 * 三種結局：
 *
 * | 條列 | 結局 |
 * |---|---|
 * | 不含「最低工資」（`更新日期:…`、指向歷年基本工資的連結） | **不是候選**，排除並計數 |
 * | 含「最低工資」但整句比對不到 | **失敗**：政府改了句型，要有人去看 |
 * | 完整的公告 | 生效日＝實施日 |
 *
 * `effectiveTo` 一律 `null`：最低工資的一次調整**沿用到下一次調整為止**，政府沒有明示失效日
 * （計畫 §3.2 (d)）。這與 `dataset_code=9` 的「115年度」相反，那一個是資源自己就宣告了適用年度。
 */
export const deriveMinimumWageEffectiveFrom = (resourceDescription: string | null): RegulatoryEffectiveFromResult => {
  if (resourceDescription === null) {
    return { ok: false, excluded: true, reason: '這一則條列沒有文字，不是公告' }
  }
  if (!resourceDescription.includes(ANNOUNCEMENT_KEYWORD)) {
    return {
      ok: false,
      excluded: true,
      reason: `條列裡沒有「${ANNOUNCEMENT_KEYWORD}」，不是公告：${JSON.stringify(resourceDescription)}`,
    }
  }

  const announcement = parseAnnouncement(resourceDescription)
  if (!announcement.ok) return { ok: false, excluded: false, reason: announcement.reason }

  return { ok: true, effectiveFrom: announcement.value.effectiveFrom, effectiveTo: null }
}

/**
 * 一個版本要有哪幾筆 record，以及它們在錯誤訊息裡叫什麼。
 *
 * **`satisfies Record<MinimumWage['item'], …>` 是總的**：形狀那邊多一個 `item` 字面值卻沒有在這裡
 * 產出對應的 record，**這一行當場編譯不過**。這就是本資料集的「期望清單」——
 * 一個版本必須同時有月薪與時薪兩筆，而少了其中一筆的症狀是 Payroll 那一側查不到那一項，
 * 於是最低工資檢核靜靜地只做一半。
 */
const ITEM_LABEL = {
  monthly: '每月最低工資',
  hourly: '每小時最低工資',
} as const satisfies Record<MinimumWage['item'], string>

/** `record_key` 的前綴。純數字或純代碼的 key 看起來像值，加前綴之後一眼看得出它是識別碼。 */
const RECORD_KEY = {
  monthly: 'monthly-minimum-wage',
  hourly: 'hourly-minimum-wage',
} as const satisfies Record<MinimumWage['item'], string>

/**
 * 解析一則最低工資公告 → 月薪與時薪兩筆 record。
 *
 * @param rawText **整頁公告頁的 HTML**（與寫進 `raw_data` 的是同一串）。
 * @param context 本次要解析的是哪一則公告：`resourceDescription` 就是探索階段讀到的那一則原文。
 *
 * ## 為什麼要用 `resourceDescription` 去頁面裡「找回」那一則
 *
 * 多資源那條路的解析器拿到的是「這一個資源的內容」，而本資料集的一個資源是**一頁裡的一則條列**
 * ——內容本身仍然是整頁。因此這裡照探索階段給的原文去比對回去，找不到就失敗：
 * 那代表探索與下載之間那一頁被改過（政府在我們同步的那幾秒內更新了頁面），
 * 而那時**寧可失敗重來**，也不要拿另一則公告的金額配上這一版的生效日。
 *
 * ## `record_key` 為什麼是概念名而不是政府的任何識別碼
 *
 * 資料字典要求 `record_key` 在同一版本內唯一、且**跨版本穩定**。這個資料集沒有級距、沒有代碼，
 * 兩筆 record 的身分就是「月薪下限」與「時薪下限」這兩個**概念**。
 *
 * 用概念名撐得住政府改版：民國 114 年《最低工資法》施行時，法定名稱從「基本工資」變成「最低工資」，
 * 句型也跟著變（`每小時基本工資調整為X元` → `每小時最低工資為X元`）。若當初拿政府的措辭當 key，
 * 那一次改名會讓跨版本比對看起來像「舊的兩筆消失、新的兩筆出現」，而實際上是同兩件事換了名字。
 * 形式與 `dataset_code=10` 的 `rate`／`charge-lower-bound` 一致（那也是三個概念）。
 */
export const parseMinimumWage = (rawText: string, context: RegulatoryParseContext): RegulatoryRecordsResult => {
  const { resourceDescription } = context
  if (resourceDescription === null) {
    return { ok: false, reason: '沒有指定要解析哪一則公告（resourceDescription 是 null）' }
  }

  const items = listContentItems(rawText)
  if (items === null) {
    return { ok: false, reason: `最低工資公告頁找不到內容區塊（期望 ${CONTENT_SECTION_OPEN}）：頁面結構已變更` }
  }
  if (!items.includes(resourceDescription)) {
    return {
      ok: false,
      reason: `公告頁上找不到探索階段讀到的那一則公告（頁面在同步途中被改過？）：${JSON.stringify(resourceDescription)}`,
    }
  }

  const announcement = parseAnnouncement(resourceDescription)
  if (!announcement.ok) return { ok: false, reason: announcement.reason }

  const amount = {
    monthly: announcement.value.monthlyAmount,
    hourly: announcement.value.hourlyAmount,
  } as const satisfies Record<MinimumWage['item'], string>

  // 兩筆的順序即 `sort_order`：月薪在前、時薪在後，與政府那一句話的順序一致。
  const records: ParsedRegulatoryRecord[] = Object.entries(ITEM_LABEL).map(([key, label], index) => {
    const item = key as MinimumWage['item']
    const data: MinimumWage = {
      item,
      amount: amount[item],
      announcedOn: announcement.value.announcedOn,
      // 政府原文留著：拆解結果對不上時要能回頭看原文（同 `dataset_code=1` 的 `monthlySalaryRangeText`）。
      announcementText: resourceDescription,
    }

    return {
      recordKey: RECORD_KEY[item],
      // `code` 是業務代碼＝項目本身；`name` 是政府對它的稱呼（`每月最低工資`）。
      code: item,
      name: label,
      // 最低工資不是級距，沒有上下限。填 `0` 或某個很大的數會讓一支寫錯的級距查詢命中它。
      rangeFrom: null,
      rangeTo: null,
      amount: amount[item],
      // 本資料集沒有費率。
      rate: null,
      data,
      sortOrder: index + 1,
    }
  })

  return { ok: true, records }
}
