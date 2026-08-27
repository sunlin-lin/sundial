/**
 * 欄位級加密（AES-256-GCM）與 blind index（HMAC-SHA256）（§5.1）。
 *
 * **為什麼放在 `db/` 而不是 `shared/`：** 加密值的位元組排列是這幾個欄位的**儲存格式**——
 * 它決定欄位要開多寬、換金鑰之後舊資料還讀不讀得回來。那是資料層的關注點，與連線封裝
 * （`client.ts`）、驅動錯誤判讀（`driver-error.ts`）同一類。放進 `shared/` 會讓它看起來像
 * 一個通用工具，於是下一個人很容易「順手」拿它去加密別的東西，而那些東西不受本檔的
 * 欄位寬度與金鑰輪替假設保護。本檔**沒有分層檔名後綴**，因為它不屬於 §0 的模組分層
 * （那套後綴只適用 `modules/` 底下）。
 *
 * ## 兩把金鑰刻意分開
 *
 * 加密金鑰（`FIELD_ENCRYPTION_KEYS`）與索引金鑰（`FIELD_BLIND_INDEX_KEY`）**不得相同**，
 * 而且本檔在建立金鑰環時就會擋下相同的情況。理由是兩者外洩的後果差距極大：
 * 索引金鑰外洩，攻擊者只能拿一個**他已經知道的**身分證去算 hash、驗證「這個值在不在資料庫裡」；
 * 加密金鑰外洩則是整批明文。共用一把金鑰等於把後果較輕的那一半風險，升級成後果最重的那一種
 * ——而共用當下不會有任何症狀，因此不能靠「記得不要共用」，必須在啟動時擋。
 *
 * ## 多把加密金鑰：現在不輪替，但格式先留好
 *
 * 金鑰環允許一把 active（新資料一律用它加密）＋ 若干把舊金鑰（**只用於解密**），
 * 而每一筆加密值都在自己的位元組裡標明「我是用哪一把加密的」。
 * **現在不做輪替**，但格式現在就必須留：格式是寫進資料庫的，等到真的要輪替那天才加欄位，
 * 舊資料就沒有任何線索指出該用哪把金鑰解——只能全表重新加密，而那時候表已經很大，
 * 且解不開的那幾筆會直接變成永久遺失的個資。留一個位元組的成本，換的是「輪替不必停機」。
 *
 * ## 儲存格式（版本 1）
 *
 * ```text
 * ┌─────────┬──────────────┬──────────┬────────┬──────────┬────────────┐
 * │ 版本 1B │ 金鑰代號長 1B │ 金鑰代號 │ IV 12B │ 驗證碼16B │ 密文 (變動) │
 * └─────────┴──────────────┴──────────┴────────┴──────────┴────────────┘
 * ```
 *
 * - **版本**在最前面，因為換格式時要先能判斷「這一筆是舊格式還是新格式」。
 * - **IV 與 auth tag 與密文存在一起**，不另開欄位：GCM 的 IV 每次都必須不同，
 *   而 auth tag 是解密時驗證完整性的依據，三者少一個就解不開也驗不了。
 *   分成三欄的話，任何一次只更新其中一欄的寫入都會產生一筆永遠解不開的資料，而且不會報錯。
 * - **IV 隨機產生**，因此**同一個明文每次加密的結果都不同**。這是 GCM 的正確用法
 *   （固定 IV 在 GCM 下會直接洩漏金鑰流），代價是加密欄位不能拿來比對相等
 *   ——「這個身分證是不是已經存在」要靠 blind index，不能靠密文。
 */
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

/** AES-256 的金鑰長度。索引金鑰沿用同一個長度（HMAC-SHA256 的區塊大小也是 32 位元組）。 */
export const ENCRYPTION_KEY_BYTE_LENGTH = 32

/** blind index 的固定長度。**固定長度**是 §5.1 對 `*_hash` 欄位的要求，因此 DB 端用 `BINARY(32)`。 */
export const BLIND_INDEX_BYTE_LENGTH = 32

const CIPHER_ALGORITHM = 'aes-256-gcm'
const BLIND_INDEX_ALGORITHM = 'sha256'

/** GCM 的建議 IV 長度。12 位元組是 NIST SP 800-38D 指定的原生長度，其他長度要多做一次 GHASH。 */
const IV_BYTE_LENGTH = 12

/** GCM 驗證碼長度。截短會直接削弱完整性保證，因此固定取滿 16 位元組。 */
const AUTH_TAG_BYTE_LENGTH = 16

/** 目前的儲存格式版本。改格式時遞增，並保留舊版本的解析分支——舊資料不會自己改寫。 */
const FORMAT_VERSION = 1

/** 版本(1) ＋ 金鑰代號長度(1) 兩個前綴位元組。 */
const HEADER_PREFIX_BYTE_LENGTH = 2

/**
 * 金鑰代號的長度上限。
 *
 * 有上限才算得出「一個加密欄位最多需要多少額外空間」（見 {@link ENCRYPTED_OVERHEAD_MAX_BYTES}），
 * 而那個數字是資料表欄位寬度的依據。沒有上限的話，欄位開多寬只能用猜的，
 * 而猜太小的症狀是某一天某一筆資料寫進去被截斷——截斷後的密文解不開，且寫入時不會報錯。
 */
const KEY_ID_MAX_BYTE_LENGTH = 32

/** 金鑰代號：小寫英數與連字號，不得以連字號開頭。刻意限制成 ASCII，長度才等於位元組數。 */
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * 一個加密欄位除了明文之外最多需要的位元組數。
 *
 * 資料表的 `VARBINARY(n)` 要開多寬 ＝ 明文的最大 UTF-8 位元組數 ＋ 本常數。
 * 匯出它是為了讓 schema 的欄位寬度有一個**算得出來**的依據，而不是「看起來夠大」。
 */
export const ENCRYPTED_OVERHEAD_MAX_BYTES =
  HEADER_PREFIX_BYTE_LENGTH + KEY_ID_MAX_BYTE_LENGTH + IV_BYTE_LENGTH + AUTH_TAG_BYTE_LENGTH

/**
 * 環境變數提供的金鑰材料（尚未解碼、尚未驗證）。
 *
 * 由 `shared/config.ts` 從環境變數讀出來原樣傳進來：讀環境變數是那一支的職責，
 * 「這些值是不是合法的金鑰」則是本檔的職責——兩件事分開，config 才不必知道 base64 與金鑰長度。
 */
export type FieldEncryptionKeyMaterial = {
  /** `<金鑰代號>:<base64 金鑰>` 以逗號分隔，可有多組。第一次上線只會有一組。 */
  readonly keys: string
  /** 新資料一律用這個代號的金鑰加密；其餘金鑰只用於解密舊資料。 */
  readonly activeKeyId: string
  /** blind index 專用金鑰（base64）。**不得與任何一把加密金鑰相同**，見檔頭。 */
  readonly blindIndexKey: string
}

/** 驗證通過的金鑰環。 */
export type FieldEncryptionKeyRing = {
  readonly activeKeyId: string
  /** 金鑰代號 → 金鑰。含 active 與所有舊金鑰。 */
  readonly encryptionKeys: ReadonlyMap<string, Buffer>
  readonly blindIndexKey: Buffer
}

/**
 * 欄位加解密器。
 *
 * 刻意做成一個由金鑰環建立的物件而不是一組吃金鑰參數的自由函式：金鑰只在建立時出現一次，
 * 之後的每一次呼叫都不需要（也拿不到）金鑰本身，於是「不小心把金鑰記進 log」少了一整類入口。
 */
export type FieldCipher = {
  /** 明文 → 可直接寫進 `VARBINARY` 欄位的位元組。每次呼叫的結果都不同（隨機 IV）。 */
  encrypt(plaintext: string): Buffer
  /**
   * 資料庫讀回的位元組 → 明文。
   *
   * @throws 格式不符、金鑰代號不在金鑰環內、或驗證碼比對失敗時拋出（**系統錯誤**，§3.1.2）：
   *   這幾種情況都不是使用者做錯了什麼，而是資料或設定壞了，必須帶著堆疊進告警。
   *   例外訊息**不含明文也不含金鑰**（§3.2 最後一條）。
   */
  decrypt(stored: Uint8Array): string
  /**
   * 明文 → 固定長度的查詢用雜湊（§5.1 的 `*_hash`）。
   *
   * **不做任何正規化**（大小寫、空白一律照收）：什麼算「同一個值」是各欄位的業務規則
   * ——身分證要轉大寫、Email 要轉小寫、地址則兩者都不該做。把規則塞進這裡，
   * 等於讓一個通用函式替所有欄位決定它們的相等定義，而那個決定在呼叫端看不見。
   */
  blindIndex(plaintext: string): Buffer
}

const decodeKey = (label: string, encoded: string): Buffer => {
  const key = Buffer.from(encoded, 'base64')
  if (key.byteLength !== ENCRYPTION_KEY_BYTE_LENGTH) {
    // 刻意不把 `encoded` 放進訊息：那是金鑰本身，訊息會進 log（§5.1 禁止金鑰進 log）。
    throw new Error(
      `${label} 必須是 base64 編碼的 ${ENCRYPTION_KEY_BYTE_LENGTH} 位元組金鑰，實際解出 ${key.byteLength} 位元組`,
    )
  }
  return key
}

const parseEncryptionKeys = (raw: string): Map<string, Buffer> => {
  const keys = new Map<string, Buffer>()

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (trimmed === '') continue

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) {
      throw new Error('FIELD_ENCRYPTION_KEYS 的每一項必須是 `<金鑰代號>:<base64 金鑰>`')
    }

    const keyId = trimmed.slice(0, separatorIndex)
    if (!KEY_ID_PATTERN.test(keyId) || keyId.length > KEY_ID_MAX_BYTE_LENGTH) {
      throw new Error(
        `金鑰代號 ${keyId} 不合法：只允許小寫英數與連字號、不得以連字號開頭、長度不得超過 ${KEY_ID_MAX_BYTE_LENGTH}`,
      )
    }
    if (keys.has(keyId)) {
      // 重複代號會讓「這筆密文用哪把金鑰」變成不確定的，而後寫入的那一把會靜靜蓋掉前一把。
      throw new Error(`金鑰代號 ${keyId} 重複`)
    }

    keys.set(keyId, decodeKey(`金鑰 ${keyId}`, trimmed.slice(separatorIndex + 1)))
  }

  return keys
}

/**
 * 建立並驗證金鑰環。
 *
 * **缺值或格式不對一律拋出，讓服務起不來**——與 `time-zone-guard.ts` 是同一種取捨：
 * 金鑰設錯時，寫入端會用一把不該用的金鑰加密，而**這件事沒有任何症狀**：資料寫得進去、
 * 讀得回來、測試全綠，直到有人拿正確的金鑰來解才發現整批資料解不開。啟動就擋下來，
 * 是唯一能在事故發生**之前**攔住它的位置。
 *
 * @throws 金鑰缺漏、長度不對、active 代號不在清單內、或索引金鑰與加密金鑰相同時拋出。
 */
export const createKeyRing = (material: FieldEncryptionKeyMaterial): FieldEncryptionKeyRing => {
  const encryptionKeys = parseEncryptionKeys(material.keys)
  if (encryptionKeys.size === 0) {
    throw new Error('FIELD_ENCRYPTION_KEYS 至少要有一把金鑰')
  }

  if (!encryptionKeys.has(material.activeKeyId)) {
    throw new Error(
      `FIELD_ENCRYPTION_ACTIVE_KEY_ID=${material.activeKeyId} 不在 FIELD_ENCRYPTION_KEYS 之內。` +
        '新資料會用這個代號的金鑰加密，代號對不上就等於沒有金鑰可用。',
    )
  }

  const blindIndexKey = decodeKey('FIELD_BLIND_INDEX_KEY', material.blindIndexKey)

  // 兩把金鑰分開是本檔的核心假設（見檔頭），因此在這裡擋死而不是寫在文件裡靠人記得：
  // 共用一把金鑰不會有任何症狀，設定的人也不會知道自己把風險升級了。
  for (const [keyId, key] of encryptionKeys) {
    if (key.equals(blindIndexKey)) {
      throw new Error(
        `FIELD_BLIND_INDEX_KEY 不得與加密金鑰 ${keyId} 相同：` +
          '索引金鑰外洩只讓人能驗證「某個值在不在」，加密金鑰外洩才是全部明文，兩者不可共用。',
      )
    }
  }

  return { activeKeyId: material.activeKeyId, encryptionKeys, blindIndexKey }
}

/**
 * 啟動自檢：金鑰設定合法才讓服務起來（比照 `assertDatabaseTimeZone`）。
 *
 * 與 {@link createKeyRing} 是同一件事，分成兩個名字是為了讓啟動流程的呼叫點自己說出用途
 * ——那裡不需要金鑰環，只需要「設定有沒有問題」這個答案。
 */
export const assertFieldEncryptionKeys = (material: FieldEncryptionKeyMaterial): void => {
  createKeyRing(material)
}

export const createFieldCipher = (keyRing: FieldEncryptionKeyRing): FieldCipher => {
  const requireKey = (keyId: string): Buffer => {
    const key = keyRing.encryptionKeys.get(keyId)
    if (key === undefined) {
      throw new Error(`加密欄位使用的金鑰代號 ${keyId} 不在金鑰環內，無法解密（舊金鑰是否被移除？）`)
    }
    return key
  }

  return {
    encrypt: (plaintext) => {
      const keyIdBytes = Buffer.from(keyRing.activeKeyId, 'ascii')
      const iv = randomBytes(IV_BYTE_LENGTH)
      const cipher = createCipheriv(CIPHER_ALGORITHM, requireKey(keyRing.activeKeyId), iv)
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

      return Buffer.concat([
        Buffer.from([FORMAT_VERSION, keyIdBytes.byteLength]),
        keyIdBytes,
        iv,
        cipher.getAuthTag(),
        ciphertext,
      ])
    },

    decrypt: (stored) => {
      const buffer = Buffer.from(stored)
      if (buffer.byteLength < HEADER_PREFIX_BYTE_LENGTH) {
        throw new Error('加密欄位的位元組數不足，連格式標頭都放不下')
      }

      const version = buffer.readUInt8(0)
      if (version !== FORMAT_VERSION) {
        // 未來新增格式時，這裡改成依版本分派。現在只有一種，讀到別的值代表資料壞了或被截斷。
        throw new Error(`不支援的加密欄位格式版本 ${version}`)
      }

      const keyIdEnd = HEADER_PREFIX_BYTE_LENGTH + buffer.readUInt8(1)
      const ivEnd = keyIdEnd + IV_BYTE_LENGTH
      const authTagEnd = ivEnd + AUTH_TAG_BYTE_LENGTH
      if (buffer.byteLength < authTagEnd) {
        throw new Error('加密欄位的位元組數不足，IV 或驗證碼不完整（欄位寬度是否不夠？）')
      }

      const decipher = createDecipheriv(
        CIPHER_ALGORITHM,
        requireKey(buffer.subarray(HEADER_PREFIX_BYTE_LENGTH, keyIdEnd).toString('ascii')),
        buffer.subarray(keyIdEnd, ivEnd),
      )
      // 先掛驗證碼再解密：GCM 的 `final()` 會比對它，比對不過就拋出，
      // 於是「密文被竄改過」與「金鑰用錯了」都不會靜靜地產生一段亂碼明文。
      decipher.setAuthTag(buffer.subarray(ivEnd, authTagEnd))

      return Buffer.concat([decipher.update(buffer.subarray(authTagEnd)), decipher.final()]).toString('utf8')
    },

    blindIndex: (plaintext) =>
      createHmac(BLIND_INDEX_ALGORITHM, keyRing.blindIndexKey).update(plaintext, 'utf8').digest(),
  }
}
