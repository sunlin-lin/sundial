/**
 * 身分證字號的正規化（零 IO 純函式）。
 *
 * **兩個以上真實的 import 者**（§0.6.3 第 1 條，理由與 `shared/effective-period.ts` 同構）：
 * `modules/employees/main/`（員工本人身分證）與 `modules/dependents/main/`（眷屬身分證，
 * 實作計畫 `plans/05-employee-onboarding.md` §8 Stage 7）都需要把身分證字號正規化後
 * 再同時餵給加密與 blind index。兩處的正規化規則必須逐字相同——若各自演化出不同的大小寫或
 * 空白處理，同一個人的身分證在兩張表上會算出不同的 blind index，日後任何需要比對「這個身分證
 * 是不是同一個人」的維護作業都會對不上。原本只在 `modules/employees/main/domain/
 * employee-identity.ts` 一份，Stage 7 有了第二個真實呼叫者後抽到這裡（該檔改為單純 re-export，
 * 保留既有 import 路徑不變）。
 *
 * **為什麼要正規化：** 重複檢查靠 blind index（`*_hash`），而 HMAC 是逐位元組計算的
 * ——`a123456789` 與 `A123456789` 會算出兩個完全不同的雜湊，於是同一個人可以被建立兩次，
 * 而唯一鍵一次也擋不到。使用者不會知道自己輸入的大小寫決定了系統認不認得他，
 * 這種重複也不會有任何地方報錯。
 *
 * **為什麼不做在 `FieldCipher.blindIndex()` 裡：** 什麼算「同一個值」是各欄位的業務規則
 * ——身分證要轉大寫、Email 要轉小寫、地址則兩者都不該做。塞進通用的雜湊函式，
 * 等於讓一個不知道自己在雜湊什麼的函式替所有欄位決定相等定義，而那個決定在呼叫端看不見。
 */

/**
 * 身分證字號正規化：去掉前後空白、英文字母一律轉大寫。
 *
 * **正規化後的值同時用於加密與 blind index**，不是只用在雜湊上：兩者存不同形狀的話，
 * 解密回來的明文與拿去算雜湊的值就不是同一個東西，日後任何「重新計算全表雜湊」的維護作業
 * （換索引金鑰、修雜湊演算法）都會算出對不上的結果。
 *
 * `toUpperCase()` 不指定 locale：身分證字號是 ASCII 英數，不會踩到土耳其語 `i` 那類地區性規則。
 */
export const normalizeIdentityNumber = (identityNumber: string): string => identityNumber.trim().toUpperCase()
