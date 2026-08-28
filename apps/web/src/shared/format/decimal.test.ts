import { describe, expect, test } from 'bun:test'
import { formatAmount, formatRate } from './decimal.ts'
import { EMPTY_DISPLAY } from './empty-display.ts'

describe('金額格式化', () => {
  test('千分位從右邊每三位一刀，位數不足時不補零', () => {
    expect(formatAmount('45800')).toBe('45,800')
    expect(formatAmount('1000')).toBe('1,000')
    expect(formatAmount('999')).toBe('999')
    expect(formatAmount('1234567')).toBe('1,234,567')
  })

  test('小數位原樣保留，不四捨五入也不去尾零', () => {
    // §9.2 說金額無小數，那是資料的性質；輸入真的帶了小數就代表後端送來的東西跟預期不同，
    // 截掉它等於把那個訊號抹掉。
    expect(formatAmount('1234.5')).toBe('1,234.5')
    expect(formatAmount('1234.50')).toBe('1,234.50')
    expect(formatAmount('1234.56789')).toBe('1,234.56789')
  })

  test('負數的逗號只加在數字上，負號留在最前面', () => {
    expect(formatAmount('-1234567')).toBe('-1,234,567')
    expect(formatAmount('-1234.50')).toBe('-1,234.50')
  })

  test('零與負零：負零一律顯示成零，小數位仍然保留', () => {
    // 畫面上出現 `-0` 元只會讓讀的人停下來想「這是什麼意思」，而它跟 0 是同一個值。
    expect(formatAmount('0')).toBe('0')
    expect(formatAmount('-0')).toBe('0')
    expect(formatAmount('-0.00')).toBe('0.00')
    expect(formatAmount('-0.01')).toBe('-0.01')
  })

  test('沒有值：null、undefined、空字串、只有空白，一律是空值符號', () => {
    expect(formatAmount(null)).toBe(EMPTY_DISPLAY)
    expect(formatAmount(undefined)).toBe(EMPTY_DISPLAY)
    expect(formatAmount('')).toBe(EMPTY_DISPLAY)
    expect(formatAmount('   ')).toBe(EMPTY_DISPLAY)
  })

  test('讀不懂的字串原樣輸出，不回空值符號也不拋錯', () => {
    // 回空值符號會把「格式變了」偽裝成「這一筆沒有資料」，而空白是這個系統裡的合法狀態，
    // 於是沒有人會去查。原樣輸出至少是看得見的壞。
    expect(formatAmount('1e5')).toBe('1e5')
    expect(formatAmount('abc')).toBe('abc')
    expect(formatAmount('.5')).toBe('.5')
    expect(formatAmount('5.')).toBe('5.')
    expect(formatAmount('+5')).toBe('+5')
    // 已經帶逗號代表某一層格式化過一次，再格式化一次會得到什麼取決於實作細節。
    expect(formatAmount('1,000')).toBe('1,000')
  })

  test('前後空白去掉，但不改寫數字本身的寫法', () => {
    expect(formatAmount('  45800  ')).toBe('45,800')
    // 前導零是後端送來的寫法，這裡不替它做決定。
    expect(formatAmount('007')).toBe('007')
  })
})

describe('費率格式化', () => {
  test('小數點右移兩位並加百分號', () => {
    expect(formatRate('0.115')).toBe('11.5%')
    expect(formatRate('0.0211')).toBe('2.11%')
    expect(formatRate('0.09')).toBe('9%')
    expect(formatRate('0.001')).toBe('0.1%')
  })

  test('尾零保留：政府用幾位小數表達一個費率，本身就是公告的一部分', () => {
    expect(formatRate('0.1150')).toBe('11.50%')
    expect(formatRate('0.10')).toBe('10%')
  })

  test('整數位不足兩位時往右補零，補的是小數位的空缺而不是改精度', () => {
    expect(formatRate('0.5')).toBe('50%')
    expect(formatRate('1')).toBe('100%')
    expect(formatRate('0')).toBe('0%')
    expect(formatRate('12')).toBe('1200%')
  })

  test('負費率的負號留在最前面，負零一律顯示成零', () => {
    expect(formatRate('-0.05')).toBe('-5%')
    expect(formatRate('-0')).toBe('0%')
  })

  test('沒有值與讀不懂的字串，處置與金額一致', () => {
    expect(formatRate(null)).toBe(EMPTY_DISPLAY)
    expect(formatRate(undefined)).toBe(EMPTY_DISPLAY)
    expect(formatRate('')).toBe(EMPTY_DISPLAY)
    expect(formatRate('11.5%')).toBe('11.5%') // 已經是百分比字串：原樣輸出，不再位移一次
    expect(formatRate('abc')).toBe('abc')
  })
})

describe('邊界值不會因為經過 number 而位移（這一組是本模組存在的理由）', () => {
  test('大於 2^53 的金額：字串運算逐位正確，Number() 會把最後一位吃掉', () => {
    const wage = '9007199254740993' // 2^53 + 1，IEEE 754 double 表示不出來的第一個整數

    expect(formatAmount(wage)).toBe('9,007,199,254,740,993')

    // 並列斷言：同一個值走 Number() 會變成另一個數字，而它不會拋錯、不會有 log，
    // 型別也完全合法——唯一的症狀是畫面上的最後一位數不對。
    expect(Number(wage).toLocaleString('en-US')).toBe('9,007,199,254,740,992')
    expect(Number(wage).toLocaleString('en-US')).not.toBe(formatAmount(wage))
  })

  test('BigInt 級距的長度也只是多切幾刀，沒有位數上限', () => {
    expect(formatAmount('123456789012345678901234567890')).toBe('123,456,789,012,345,678,901,234,567,890')
    expect(String(Number('123456789012345678901234567890'))).toBe('1.2345678901234568e+29')
  })

  test('費率位移：字串位移得到 29%，浮點乘法得到 28.999999999999996', () => {
    const rate = '0.29' // 後端 regulatory-amount.ts 檔頭逐字舉的例子（方向相反、同一個失真）

    expect(formatRate(rate)).toBe('29%')

    // 並列斷言：`Number(rate) * 100` 不是 29，而這個值會直接被 toLocaleString / 字串串接印出去。
    expect(Number(rate) * 100).not.toBe(29)
    expect(`${String(Number(rate) * 100)}%`).toBe('28.999999999999996%')
  })

  test('最危險的不是看得出來的那種：toFixed 會把失真藏起來，字串位移則從一開始就沒有失真', () => {
    const rate = '0.07'

    expect(formatRate(rate)).toBe('7%')

    // 7.000000000000001 —— 配上 toFixed(2) 會顯示成 `7.00%`，看起來完全正常。
    // 位移過的那一位在別的值上就不一定被四捨五入吃掉，而那時已經沒有人在懷疑這條路徑。
    expect(Number(rate) * 100).not.toBe(7)
    expect((Number(rate) * 100).toFixed(2)).toBe('7.00')
  })
})
