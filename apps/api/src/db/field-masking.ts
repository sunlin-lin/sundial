/**
 * 敏感個資的遮罩（§5.1）。
 *
 * **對外回應一律走本檔，完整明文不在任何端點提供。** §5.1 只寫死兩個數字
 * （身分證僅末 3 碼、帳號僅末 4 碼），其餘欄位只說「一律遮罩」，因此下面每一種遮罩的
 * **保留範圍都是本檔做的決定**，理由逐條寫在函式上，改的時候請連理由一起改。
 *
 * **為什麼與 `field-encryption.ts` 放在一起：** 這兩件事是同一條規則的兩半——加密決定
 * 「資料庫裡不能有明文」，遮罩決定「回應裡不能有明文」。放在一起，翻開這個目錄就看得完
 * 「一個敏感欄位這輩子會經過哪些形狀」；拆到兩個目錄之後，新增一個敏感欄位的人
 * 很容易只做到其中一半，而漏掉遮罩那一半**不會有任何地方變紅**。
 *
 * **本檔刻意只吃已解密的明文、只吐字串**，不碰資料庫也不碰 http：它是純函式，
 * 因此測得起來，也不會把「怎麼取得這個值」的知識帶進遮罩規則裡。
 */

/** 遮罩字元。固定用半形星號：全形字元在等寬字型下的寬度不一致，畫面上會跳。 */
const MASK_CHARACTER = '*'

/**
 * 自由文字的固定長度遮罩。
 *
 * **刻意是固定長度，不隨原值變長變短**：可變長度會把原值的字數洩漏出去，
 * 而地址與 Email 的字數本身就是可用來縮小比對範圍的資訊。
 */
const FIXED_MASK = MASK_CHARACTER.repeat(3)

/**
 * 保留尾端 N 個字元，其餘逐字元遮成星號。
 *
 * 用於**格式固定**的欄位（身分證、電話）：這類欄位的長度是公開資訊（身分證一律 10 碼），
 * 因此逐字元遮罩不會多洩漏什麼，而保留原長度讓畫面上的欄寬不會跳動。
 *
 * 值比要保留的位數還短時**整串遮掉**：那種值多半是髒資料，露出「幾乎全部」比露出末 3 碼更糟。
 */
const keepTail = (value: string, visibleCount: number): string => {
  const characters = [...value]
  if (characters.length <= visibleCount) return MASK_CHARACTER.repeat(characters.length)
  return MASK_CHARACTER.repeat(characters.length - visibleCount) + characters.slice(-visibleCount).join('')
}

/** §5.1 寫死的兩個數字之一：身分證僅末 3 碼。 */
const IDENTITY_NUMBER_VISIBLE_TAIL = 3

/**
 * 電話保留的末碼數。
 *
 * §5.1 沒有規定電話要留幾碼。取 3 而不是 4，是為了與身分證一致：同一個畫面上兩個欄位
 * 用不同的保留長度時，使用者（與寫前端的人）會開始猜「為什麼這個多露一碼」，
 * 而那個問題沒有答案。§5.1 的 4 碼是給**銀行帳號**的，本專案還沒有那個欄位。
 */
const PHONE_VISIBLE_TAIL = 3

/**
 * 地址保留的開頭字元數。
 *
 * 取 6 是因為台灣地址的前 6 個字大致就是「縣市＋行政區」（`台北市信義區`、`新北市板橋區`），
 * 那是客服核對身分時唯一需要的粒度；再多一個字就會露出路名，而路名＋姓名足以定位到人。
 */
const ADDRESS_VISIBLE_HEAD = 6

/** 身分證字號。§5.1 明文規定僅末 3 碼。 */
export const maskIdentityNumber = (identityNumber: string): string =>
  keepTail(identityNumber, IDENTITY_NUMBER_VISIBLE_TAIL)

/** 電話。理由見 {@link PHONE_VISIBLE_TAIL}。 */
export const maskPhone = (phone: string): string => keepTail(phone, PHONE_VISIBLE_TAIL)

/**
 * 出生年月日（`YYYY-MM-DD`）→ `YYYY-**-**`。
 *
 * **保留年份、遮掉月日**：年份是計算年齡級距（勞退提繳率、特休年資）時會用到的粒度，
 * 而「完整生日」才是能拿去和其他資料庫比對、猜密碼提示問題的那一半。
 * 值不是預期格式時整串遮掉——寧可畫面上少一個資訊，也不要把一段沒被規則涵蓋的字串直接印出去。
 */
export const maskBirthday = (birthday: string): string => {
  const separatorIndex = birthday.indexOf('-')
  if (separatorIndex <= 0) return FIXED_MASK
  return `${birthday.slice(0, separatorIndex)}-**-**`
}

/**
 * Email → 首字元 ＋ 固定遮罩 ＋ `@網域`。
 *
 * **保留網域**：客服要判斷的通常是「這是公司信箱還是私人信箱」，網域就足夠；
 * 而 local part 才是可以直接拿去寄信、拿去撞其他服務帳號的那一段。
 * 沒有 `@` 的值視為髒資料，整串遮掉。
 */
export const maskEmail = (email: string): string => {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return FIXED_MASK
  return `${email.slice(0, 1)}${FIXED_MASK}${email.slice(atIndex)}`
}

/** 選填 Email 的遮罩。`null` 原樣帶過，不要遮成 `***`——那會讓「沒填」與「填了但看不到」分不出來。 */
export const maskOptionalEmail = (email: string | null): string | null => (email === null ? null : maskEmail(email))

/** 地址 → 保留開頭的縣市與行政區。理由見 {@link ADDRESS_VISIBLE_HEAD}。 */
export const maskAddress = (address: string): string => {
  const characters = [...address]
  if (characters.length <= ADDRESS_VISIBLE_HEAD) return FIXED_MASK
  return characters.slice(0, ADDRESS_VISIBLE_HEAD).join('') + FIXED_MASK
}
