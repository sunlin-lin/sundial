/**
 * 訊息目錄的「形狀」：巢狀樹的型別工具 ＋ 攤平成點分隔 key 的函式。
 *
 * **為什麼語系檔是巢狀樹，查詢用的 key 卻是一條字串。** 兩邊各自解一個問題：
 * - 樹是**寫給人改的形狀**。key 由模組路徑機械推導（`<大目錄>.<次目錄>.<類別>.<訊息名>`），
 *   而樹的每一層剛好就是路徑的一段——新增一支端點的訊息時，該放哪裡不需要任何判斷，
 *   跟著目錄結構放就對了；也因此「這個大目錄有哪些訊息」是一個看得見的區塊，而不是
 *   在一份幾百行的扁平清單裡靠前綴排序去猜。
 * - 扁平 key 是**寫給程式用的形狀**。`ErrorCode` 必須是一份字面值聯集（見 `messages.ts`），
 *   而 `errors[].code` 進 JSON 回應時只能是一條字串——巢狀物件在那裡沒有意義。
 *
 * 兩種形狀只有**一份資料**：樹是來源，扁平是由 {@link flattenMessageTree}／{@link MessageKeysOf}
 * 推導出來的投影。手寫第二份的下場是兩邊會少一邊，而症狀是某幾則訊息在執行期查不到。
 */

/**
 * 任意深度的訊息樹（葉節點是字串）。
 *
 * 值帶著 `undefined` 是為了容納 {@link PartialMessageTree}：非預設語系可以只翻一部分，
 * 那些「還沒翻」的節點在型別上就是 optional，而 optional 屬性的值型別含 `undefined`。
 */
export type MessageTree = { readonly [segment: string]: string | MessageTree | undefined }

/**
 * 樹 → 點分隔 key 的字面值聯集。
 *
 * 這是整套編譯期檢查的起點：`ErrorCode` 由它算出來，於是「錯誤碼打錯一個字母」是編譯錯誤
 * 而不是執行期一句查不到的訊息。
 *
 * **刻意展開成剛好四層，而不是寫成任意深度的遞迴。** 兩個理由：
 * - 四段是**規則**（`<大目錄>.<次目錄>.<類別>.<訊息名>`），不是這棵樹碰巧長成的樣子。
 *   寫死四層之後，語系檔少一層或多一層都算不出 key，於是用到它的模組當場編譯不過
 *   ——遞迴版則會照單全收，把一個五段的 key 安靜地接受下來。
 * - 無深度上限的遞迴在 template literal 裡會讓 TS 直接放棄（TS2589「型別實例化過深」），
 *   而那個錯誤出現在這裡，看起來卻像語系檔的問題。
 *
 * 空的子樹（例如目前還沒有任何錯誤碼的 `permissions.main.errors`）算出來是 `never`，
 * 於是它一個 key 都不貢獻——**檔案與形狀可以先存在，不必為了「讓它有東西」而先發明一個碼**。
 */
export type MessageKeysOf<TTree> = {
  [TDirectory in keyof TTree & string]: {
    [TSubdirectory in keyof TTree[TDirectory] & string]: {
      [TCategory in keyof TTree[TDirectory][TSubdirectory] & string]: {
        [
          TName in keyof TTree[TDirectory][TSubdirectory][TCategory] & string
        ]: `${TDirectory}.${TSubdirectory}.${TCategory}.${TName}`
      }[keyof TTree[TDirectory][TSubdirectory][TCategory] & string]
    }[keyof TTree[TDirectory][TSubdirectory] & string]
  }[keyof TTree[TDirectory] & string]
}[keyof TTree & string]

/**
 * 非預設語系的樹：任何一層都可以整段略過，但**略不掉的是形狀**。
 *
 * 由預設語系的樹推導而不是各寫一份：新語系拼錯一段路徑（`role` 而不是 `roles`）當場編譯不過，
 * 而不是靜靜多出一個永遠查不到的分支、少掉一則永遠回落中文的訊息。
 */
export type PartialMessageTree<TTree> = {
  readonly [TSegment in keyof TTree]?: TTree[TSegment] extends string ? string : PartialMessageTree<TTree[TSegment]>
}

/**
 * 把樹攤平成 `{ 'roles.main.errors.in-use': '仍有…' }`。
 *
 * 回傳型別刻意是寬鬆的 `Record<string, string>` 而不是精確的 key 聯集：精確版只能靠型別斷言
 * 去騙編譯器（實作是遞迴，TS 追不出來），而那個斷言一旦寫錯就沒有任何東西會發現。
 * **精確的那一份由 {@link MessageKeysOf} 在型別層獨立算出**——它不經過這個函式，
 * 因此不需要相信這裡的實作，兩者也不可能因為一個錯誤的斷言而一起錯。
 *
 * @param prefix 遞迴用的已走過路徑，外部呼叫一律省略。
 */
export const flattenMessageTree = (tree: MessageTree, prefix = ''): Record<string, string> => {
  const flat: Record<string, string> = {}

  for (const [segment, node] of Object.entries(tree)) {
    // 非預設語系尚未翻譯的節點：略過即可，回落規則由 `messages.ts` 處理。
    if (node === undefined) continue

    const key = prefix === '' ? segment : `${prefix}.${segment}`
    if (typeof node === 'string') {
      flat[key] = node
    } else {
      Object.assign(flat, flattenMessageTree(node, key))
    }
  }

  return flat
}

/**
 * 在樹裡沿著點分隔 key 走一遍，走不到就回 `undefined`。
 *
 * **給「這一則在這個語系有沒有」用，不是給翻譯用**（翻譯是 i18next 的事）。
 * 之所以不預先把每個語系攤平成一張表再查：那張表得是 `Record<LocaleValue, …>` 才能免去
 * 「查不到語系」的分支，而由 `Object.fromEntries` 生出來的東西只有索引簽章，
 * 要騙過型別就得寫一個斷言——為了省下每次呼叫四步走訪而埋一個沒人驗證的斷言，不划算。
 */
export const findMessage = (tree: MessageTree, key: string): string | undefined => {
  let node: string | MessageTree | undefined = tree

  for (const segment of key.split('.')) {
    // 走到葉節點卻還有段沒走完（或這一段根本不存在）＝這個語系沒有這一則。
    if (node === undefined || typeof node === 'string') return undefined
    node = node[segment]
  }

  return typeof node === 'string' ? node : undefined
}
