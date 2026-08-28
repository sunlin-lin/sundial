import { describe, expect, test } from 'bun:test'
import { syncStatusPresentation, type SyncStatusCode } from './sync-status.ts'

const ALL_CODES: readonly SyncStatusCode[] = [1, 2, 3, 4]

describe('同步狀態的呈現', () => {
  test.each([
    [1, 'regulatory.sync-status.running', 'warning'],
    [2, 'regulatory.sync-status.succeeded', 'success'],
    [3, 'regulatory.sync-status.failed', 'danger'],
    [4, 'regulatory.sync-status.no-change', 'info'],
  ] as const)('status_code=%s 對到固定的文字與色彩', (code, labelKey, tone) => {
    const presentation = syncStatusPresentation(code)
    expect(presentation.labelKey).toBe(labelKey)
    expect(presentation.tone).toBe(tone)
  })

  test('四種狀態各有自己的文字，沒有兩種狀態顯示同一句話', () => {
    const labels = ALL_CODES.map((code) => syncStatusPresentation(code).labelKey)
    expect(new Set(labels).size).toBe(labels.length)
  })

  test('每一種狀態都同時有文字與色彩——§9.1 禁止只用顏色表達狀態', () => {
    for (const code of ALL_CODES) {
      const presentation = syncStatusPresentation(code)
      expect(presentation.labelKey.length).toBeGreaterThan(0)
      expect(presentation.tone.length).toBeGreaterThan(0)
    }
  })

  test('只有「失敗」用實心底色，一眼就能在整張表裡找到出事的那一列', () => {
    expect(syncStatusPresentation(3).effect).toBe('dark')
    for (const code of ALL_CODES.filter((value) => value !== 3)) {
      expect(syncStatusPresentation(code).effect).toBe('light')
    }
  })
})
