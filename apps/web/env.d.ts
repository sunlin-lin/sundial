/// <reference types="vite/client" />

/**
 * 這裡刻意**沒有** `declare module '*.vue'` 的萬用宣告。
 *
 * 型別檢查一律走 `vue-tsc`，它會真的去讀 `.vue` 的 `<script setup>` 並推導出精確的
 * props／emits 型別。加上萬用宣告的話，那個宣告會蓋掉推導結果，`.vue` 元件的 props
 * 全部退化成任意形狀——**傳錯 prop 不再是編譯錯誤**（前端規範 §1.1 要擋的正是這件事），
 * 而且退化是靜默的：檔案照樣編譯得過，只是不再檢查任何東西。
 *
 * 本檔刻意不含 `export`：它必須是全域宣告檔，加上 `export` 之後就變成模組，
 * 上面那行 `reference` 帶進來的環境型別會被關進模組作用域。
 */
