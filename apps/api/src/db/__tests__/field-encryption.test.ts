/**
 * 欄位加密與 blind index 的純函式測試（§7.1）。
 *
 * **不需要資料庫**：金鑰由測試自己造，加解密與雜湊都是純計算。這幾條測的是
 * 「密文換一把金鑰就解不開」「同值同雜湊」這類**性質**，而不是某一次呼叫的回傳值
 * ——性質壞掉的症狀是資料靜靜地解不開或重複擋不住，那正是沒有測試就看不見的那一種。
 */
import { Buffer } from 'node:buffer'
import { describe, expect, test } from 'bun:test'
import {
  BLIND_INDEX_BYTE_LENGTH,
  createFieldCipher,
  createKeyRing,
  ENCRYPTED_OVERHEAD_MAX_BYTES,
  ENCRYPTION_KEY_BYTE_LENGTH,
  type FieldEncryptionKeyMaterial,
} from '../field-encryption.ts'

/** 產生一把測試金鑰。內容不重要，長度與「彼此不同」才重要。 */
const key = (seed: number): string => Buffer.alloc(ENCRYPTION_KEY_BYTE_LENGTH, seed).toString('base64')

const KEY_A = key(1)
const KEY_B = key(2)
const INDEX_KEY = key(3)
const OTHER_INDEX_KEY = key(4)

const material = (overrides: Partial<FieldEncryptionKeyMaterial> = {}): FieldEncryptionKeyMaterial => ({
  keys: `v1:${KEY_A}`,
  activeKeyId: 'v1',
  blindIndexKey: INDEX_KEY,
  ...overrides,
})

const cipherFrom = (overrides: Partial<FieldEncryptionKeyMaterial> = {}) =>
  createFieldCipher(createKeyRing(material(overrides)))

describe('加解密往返', () => {
  test('加密後解回來與原文相同', () => {
    const cipher = cipherFrom()
    expect(cipher.decrypt(cipher.encrypt('A123456789'))).toBe('A123456789')
  })

  test('中文與全形字元往返後不變（UTF-8 沒有被截斷或重新解碼）', () => {
    const cipher = cipherFrom()
    const address = '台北市信義區信義路五段7號──１０樓之２'
    expect(cipher.decrypt(cipher.encrypt(address))).toBe(address)
  })

  test('空字串也能往返', () => {
    // 空字串是合法明文（例如未來某個選填欄位真的存了空字串）。GCM 對空明文只產生 tag，
    // 若解析時假設「一定有密文」就會在這裡爆掉，而那個 bug 只有空值資料才會踩到。
    const cipher = cipherFrom()
    expect(cipher.decrypt(cipher.encrypt(''))).toBe('')
  })

  test('同一個明文每次加密的位元組都不同（隨機 IV）', () => {
    // 這條是**安全性質**：GCM 用固定 IV 會直接洩漏金鑰流。
    // 它同時解釋了為什麼重複檢查不能建在密文上，只能靠 blind index。
    const cipher = cipherFrom()
    expect(cipher.encrypt('A123456789').equals(cipher.encrypt('A123456789'))).toBe(false)
  })

  test('額外開銷不超過宣告的上限（資料表欄位寬度就是照這個數字開的）', () => {
    const cipher = cipherFrom()
    const plaintext = 'A123456789'
    const overhead = cipher.encrypt(plaintext).byteLength - Buffer.byteLength(plaintext, 'utf8')
    expect(overhead).toBeLessThanOrEqual(ENCRYPTED_OVERHEAD_MAX_BYTES)
  })

  test('密文被竄改一個位元組即解不開，而不是解出一段亂碼', () => {
    // auth tag 的用途就是這個。少了驗證，被竄改的密文會解出一段看起來很正常的垃圾明文。
    const cipher = cipherFrom()
    const encrypted = cipher.encrypt('A123456789')
    const tampered = Buffer.from(encrypted)
    const lastIndex = tampered.byteLength - 1
    tampered.writeUInt8(tampered.readUInt8(lastIndex) ^ 0xff, lastIndex)

    expect(() => cipher.decrypt(tampered)).toThrow()
  })
})

describe('多把金鑰與金鑰輪替的前提', () => {
  test('用甲金鑰加密的值，只有乙金鑰的金鑰環解不開', () => {
    const encrypted = cipherFrom({ keys: `v1:${KEY_A}` }).encrypt('A123456789')
    const otherCipher = cipherFrom({ keys: `v1:${KEY_B}` })

    expect(() => otherCipher.decrypt(encrypted)).toThrow()
  })

  test('舊金鑰留在金鑰環內時，舊資料仍解得開，而新資料改用 active 金鑰加密', () => {
    // 這一條就是「日後可以輪替金鑰」的全部前提：密文自帶金鑰代號。
    const legacy = cipherFrom({ keys: `v0:${KEY_A}`, activeKeyId: 'v0' })
    const legacyEncrypted = legacy.encrypt('A123456789')

    const rotated = cipherFrom({ keys: `v1:${KEY_B},v0:${KEY_A}`, activeKeyId: 'v1' })
    expect(rotated.decrypt(legacyEncrypted)).toBe('A123456789')

    // 新寫入的資料用 v1；把 v0 單獨拿出來的金鑰環就解不開它。
    const freshEncrypted = rotated.encrypt('A123456789')
    expect(() => legacy.decrypt(freshEncrypted)).toThrow()
  })

  test('密文使用的金鑰代號不在金鑰環內時拋出，而不是靜靜回一個空值', () => {
    const encrypted = cipherFrom({ keys: `v0:${KEY_A}`, activeKeyId: 'v0' }).encrypt('A123456789')
    expect(() => cipherFrom({ keys: `v1:${KEY_B}`, activeKeyId: 'v1' }).decrypt(encrypted)).toThrow()
  })
})

describe('blind index', () => {
  test('同一個值算出同一個雜湊（重複檢查就是靠這個性質）', () => {
    const cipher = cipherFrom()
    expect(cipher.blindIndex('A123456789').equals(cipher.blindIndex('A123456789'))).toBe(true)
  })

  test('不同的值算出不同的雜湊', () => {
    const cipher = cipherFrom()
    expect(cipher.blindIndex('A123456789').equals(cipher.blindIndex('A123456780'))).toBe(false)
  })

  test('長度固定為 32 位元組（DB 端是 BINARY(32)）', () => {
    const cipher = cipherFrom()
    expect(cipher.blindIndex('A123456789').byteLength).toBe(BLIND_INDEX_BYTE_LENGTH)
    expect(cipher.blindIndex('').byteLength).toBe(BLIND_INDEX_BYTE_LENGTH)
    expect(cipher.blindIndex('這是一段很長很長的中文字串，長度與雜湊長度無關').byteLength).toBe(BLIND_INDEX_BYTE_LENGTH)
  })

  test('換一把索引金鑰就算出不同的雜湊（索引金鑰確實有進到計算裡）', () => {
    const a = cipherFrom({ blindIndexKey: INDEX_KEY })
    const b = cipherFrom({ blindIndexKey: OTHER_INDEX_KEY })
    expect(a.blindIndex('A123456789').equals(b.blindIndex('A123456789'))).toBe(false)
  })

  test('雜湊不因加密金鑰而改變：兩者是分開的兩把金鑰', () => {
    const a = cipherFrom({ keys: `v1:${KEY_A}` })
    const b = cipherFrom({ keys: `v1:${KEY_B}` })
    expect(a.blindIndex('A123456789').equals(b.blindIndex('A123456789'))).toBe(true)
  })
})

describe('金鑰環的啟動驗證', () => {
  test('索引金鑰與任何一把加密金鑰相同時拒絕建立', () => {
    // 共用一把金鑰不會有任何症狀，因此只能靠這道檢查擋（見 field-encryption.ts 檔頭）。
    expect(() => createKeyRing(material({ blindIndexKey: KEY_A }))).toThrow()
    expect(() => createKeyRing(material({ keys: `v1:${KEY_A},v0:${INDEX_KEY}` }))).toThrow()
  })

  test('active 代號不在金鑰清單內時拒絕建立', () => {
    expect(() => createKeyRing(material({ activeKeyId: 'v9' }))).toThrow()
  })

  test('金鑰長度不是 32 位元組時拒絕建立', () => {
    expect(() => createKeyRing(material({ keys: `v1:${Buffer.alloc(16, 1).toString('base64')}` }))).toThrow()
  })

  test('金鑰代號重複時拒絕建立', () => {
    expect(() => createKeyRing(material({ keys: `v1:${KEY_A},v1:${KEY_B}` }))).toThrow()
  })

  test('金鑰清單為空時拒絕建立', () => {
    expect(() => createKeyRing(material({ keys: '  ' }))).toThrow()
  })

  test('錯誤訊息不得帶出金鑰本身（訊息會進 log，§5.1）', () => {
    const shortKey = Buffer.alloc(16, 7).toString('base64')
    expect(() => createKeyRing(material({ keys: `v1:${shortKey}` }))).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(shortKey) }),
    )
  })
})
