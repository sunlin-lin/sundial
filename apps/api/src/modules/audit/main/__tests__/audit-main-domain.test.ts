/**
 * `audit/main` 的純函式測試（§7.1、計畫 §7 Stage 1）。
 *
 * 這些是**不需要資料庫**的規則：三個級別各自的行為、未分類欄位的處置，以及
 * 「只改姓名時身分證不得出現在 `changes` 裡」那一條——它們是規則本身，不該綁在環境上
 * （寫入行為另有一支要連 MariaDB 的 `audit-main.record.test.ts`）。
 *
 * 兩種呼叫方式都測到，因為它們的保證不同：
 * - `buildChangeSet`（`domain/`，政策由參數傳入）——三個級別各自的行為，包含真實政策裡
 *   目前沒有的 `excluded`。
 * - `buildAuditChanges`（入口，查真實政策）——`employees` 的政策內容本身對不對。
 */
import { Buffer } from 'node:buffer'
import { describe, expect, test } from 'bun:test'
import { createFieldCipher, createKeyRing, ENCRYPTION_KEY_BYTE_LENGTH } from '../../../../db/field-encryption.ts'
import { buildAuditChanges } from '../audit-main.service.ts'
import { buildChangeSet, type AuditSnapshot } from '../domain/audit-change-set.ts'
import { AuditFieldLevel, AUDIT_FIELD_POLICY, type AuditTablePolicy } from '../domain/audit-field-policy.ts'

/**
 * 三個級別齊備的政策。
 *
 * **刻意是測試自己的政策，不是 `AUDIT_FIELD_POLICY.employees`**：真實政策裡目前沒有任何
 * `excluded` 欄位（那一級的定義域是 `EmployeeProfileInput`，而它裡面沒有 `id`／`createdAt`
 * 這類欄位可以排除），拿它去測「`excluded` 不會出現」會是一條永遠成立、什麼都沒驗到的測試。
 */
const samplePolicy: AuditTablePolicy = {
  source: '__tests__/audit-main-domain.test.ts#samplePolicy',
  fields: {
    plainField: AuditFieldLevel.Value,
    secretField: AuditFieldLevel.Presence,
    ignoredField: AuditFieldLevel.Excluded,
  },
}

const snapshot = (overrides: Record<string, string | null> = {}): AuditSnapshot => ({
  plainField: 'A',
  secretField: 'S',
  ignoredField: 'I',
  ...overrides,
})

describe('欄位政策：value 級', () => {
  test('記前後值', () => {
    const changes = buildChangeSet(samplePolicy, snapshot(), snapshot({ plainField: 'B' }))

    expect(changes).toEqual([{ field: 'plainField', before: 'A', after: 'B' }])
  })

  test('沒有變更的欄位不出現', () => {
    // 這一條撐著整個結構的選擇（計畫 §4.2）：存「前後兩包整筆」的話，沒改到的欄位會跟著複製兩份，
    // 而 `employees` 沒改到的欄位裡就有身分證。
    expect(buildChangeSet(samplePolicy, snapshot(), snapshot())).toEqual([])
  })

  test('新增（before 為 null）時 before 是 null，不是省略欄位', () => {
    const changes = buildChangeSet(samplePolicy, null, snapshot())

    // 新增與刪除走同一個結構，讀稽核的人不必先判斷這是哪一種事件才知道怎麼解讀 `changes`。
    expect(changes).toContainEqual({ field: 'plainField', before: null, after: 'A' })
  })

  test('刪除（after 為 null）時 after 是 null', () => {
    const changes = buildChangeSet(samplePolicy, snapshot(), null)

    expect(changes).toContainEqual({ field: 'plainField', before: 'A', after: null })
  })
})

describe('欄位政策：presence 級', () => {
  test('只記「這一欄變更了」，且刻意不帶 before／after', () => {
    const changes = buildChangeSet(samplePolicy, snapshot(), snapshot({ secretField: 'S2' }))

    expect(changes).toEqual([{ field: 'secretField', changed: true }])
    // 逐 key 檢查而不是只比對整個物件：塞 `'***'` 這種遮罩字串的寫法也會通過上面那條
    //（`toEqual` 不看多出來的 undefined），但它會讓讀的程式必須判斷「這個值是真的還是遮罩」。
    expect(Object.keys(changes[0] ?? {})).toEqual(['field', 'changed'])
  })

  test('值沒變時同樣不出現——不是每次都標 changed', () => {
    expect(buildChangeSet(samplePolicy, snapshot(), snapshot({ plainField: 'B' }))).not.toContainEqual({
      field: 'secretField',
      changed: true,
    })
  })
})

describe('欄位政策：excluded 級', () => {
  test('即使值真的變了也完全不出現', () => {
    const changes = buildChangeSet(samplePolicy, snapshot(), snapshot({ ignoredField: 'I2', plainField: 'B' }))

    expect(changes).toEqual([{ field: 'plainField', before: 'A', after: 'B' }])
  })
})

describe('未分類的欄位', () => {
  test('拋例外，不靜默丟棄', () => {
    // 靜默丟棄的話，稽核會少一欄而沒有任何人知道（計畫 §4.3）。
    expect(() => buildChangeSet(samplePolicy, snapshot(), { ...snapshot(), passportNumber: 'X1234' })).toThrow(
      /passportNumber/,
    )
  })

  test('例外訊息不含欄位的值', () => {
    // §3.2 末條：例外訊息禁止含個資明文——訊息一定會進 log，log 的保存期會跟著變成個資保存期。
    // 未分類的欄位**最有可能**正是剛加上去、還沒有人想過敏感度的那一種。
    try {
      buildChangeSet(samplePolicy, snapshot(), { ...snapshot(), passportNumber: 'X1234' })
      throw new Error('應該要拋例外才對')
    } catch (error) {
      expect(String(error)).not.toContain('X1234')
      expect(String(error)).toContain('audit-main-domain.test.ts#samplePolicy')
    }
  })
})

describe('employees 的政策內容', () => {
  const profile = (overrides: Record<string, string | null> = {}): AuditSnapshot => ({
    employeeCode: 'E001',
    name: '王小明',
    gender: 'MALE',
    identityNumber: 'A123456789',
    birthday: '1990-05-21',
    phone: '0912345678',
    email: 'someone@example.com',
    address: '台北市信義區信義路五段7號',
    ...overrides,
  })

  test('員工編號記前後值（資料字典明文要求）', () => {
    expect(buildAuditChanges('employees', profile(), profile({ employeeCode: 'E002' }))).toEqual([
      { field: 'employeeCode', before: 'E001', after: 'E002' },
    ])
  })

  test('身分證只記 changed，值不進稽核', () => {
    expect(buildAuditChanges('employees', profile(), profile({ identityNumber: 'B234567890' }))).toEqual([
      { field: 'identityNumber', changed: true },
    ])
  })

  test('加密欄位（生日、電話、Email、地址）一律只記 changed', () => {
    const changes = buildAuditChanges(
      'employees',
      profile(),
      profile({
        birthday: '1991-01-01',
        phone: '0987654321',
        email: null,
        address: '新北市板橋區文化路一段1號',
      }),
    )

    expect(changes).toEqual([
      { field: 'birthday', changed: true },
      { field: 'phone', changed: true },
      { field: 'email', changed: true },
      { field: 'address', changed: true },
    ])
  })

  test('傳整包 UpdateEmployeeInput（含 id）會被當成未分類欄位擋下來', () => {
    // 政策的內層 key 定義域是 `EmployeeProfileInput`，`id` 不在裡面（見 audit-field-policy.ts）。
    // 這是要的結果：稽核的主體識別碼走 `subjectId` 欄位，不該混進 `changes`。
    expect(() => buildAuditChanges('employees', profile(), { ...profile(), id: 'employee-uuid' })).toThrow(/id/)
  })
})

describe('★ 只改姓名時，身分證不得出現在 changes 裡（計畫 §4.4）', () => {
  /**
   * **真的加密器，不是確定性的 mock cipher。**
   *
   * 這一條測試的意義就在於密文每次都不同：用固定 IV 的假加密器寫的測試，密文相同就相同，
   * 完全看不出這個問題，CI 全綠。金鑰是測試自己產的常數，不讀 `.env`——測試驗的是
   * 「變更判定基於明文」，不是某一把特定金鑰。
   */
  const testKey = (seed: number): string => Buffer.alloc(ENCRYPTION_KEY_BYTE_LENGTH, seed).toString('base64')
  const cipher = createFieldCipher(
    createKeyRing({ keys: `v1:${testKey(31)}`, activeKeyId: 'v1', blindIndexKey: testKey(32) }),
  )

  const identityNumber = 'A123456789'

  test('前提：同一個身分證加密兩次會得到不同的密文', () => {
    // 這不是在測 `field-encryption.ts`，是在把下一條測試的前提釘住：AES-256-GCM 每次的 IV 都不同，
    // 因此「拿密文比對」在員工全量提交時**每一次更新**都會誤判身分證被改過。
    // 哪天加密改成確定性的，這一條會先紅，下一條的意義也就要重新檢視。
    expect(cipher.encrypt(identityNumber).equals(cipher.encrypt(identityNumber))).toBe(false)
  })

  test('全量提交、只有姓名不同 → changes 裡只有 name', () => {
    // 員工更新是全量提交：身分證明文原封不動送回來、再被重新加密一次，於是密文一定不同。
    // 變更判定若基於密文，這裡會多出一筆 `{ field: 'identityNumber', changed: true }`
    // ——身分證根本沒被動過，而 `presence` 這一級存在的唯一理由就此失效。
    const before = {
      employeeCode: 'E001',
      name: '王小明',
      gender: 'MALE',
      identityNumber,
      birthday: '1990-05-21',
      phone: '0912345678',
      email: 'someone@example.com',
      address: '台北市信義區信義路五段7號',
    }
    const after = { ...before, name: '王大明' }

    // 明文一模一樣，密文卻不同——比對必須發生在加密之前。
    expect(cipher.encrypt(before.identityNumber).equals(cipher.encrypt(after.identityNumber))).toBe(false)

    const changes = buildAuditChanges('employees', before, after)

    expect(changes).toEqual([{ field: 'name', before: '王小明', after: '王大明' }])
    expect(changes.map((change) => change.field)).not.toContain('identityNumber')
  })
})

describe('政策本身的形狀', () => {
  test('每一張表都有非空的 source 與至少一個欄位', () => {
    // 自我檢查（通用規範 §7.2）：政策整個空掉的時候，上面所有測試都會「通過」
    // ——空政策下沒有任何欄位被分類，而所有斷言比對的都是空結果。
    const tables = Object.entries(AUDIT_FIELD_POLICY)

    expect(tables.length).toBeGreaterThan(0)
    for (const [table, policy] of tables) {
      expect(policy.source).not.toBe('')
      expect(Object.keys(policy.fields).length).toBeGreaterThan(0)
      // 外層 key 是資料表名（snake_case），也就是 `subject_table` 的合法值（計畫 §4.5）。
      expect(table).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})
