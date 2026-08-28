<script setup lang="ts">
/**
 * 應用程式根元件。
 *
 * 這裡刻意只有一個 `RouterView`：頁首、側欄這些外框屬於**已登入頁面**的 layout，
 * 而登入頁沒有它們。把外框放在這一層的話，登入頁就得反過來想辦法把它藏起來，
 * 那正是「一個 `v-if` 開始長出第二個、第三個」的起點。
 *
 * Element Plus 的全域設定（語系）不在這裡而在 `main.ts`，理由寫在那裡。
 */
import { RouterView } from 'vue-router'
</script>

<template>
  <RouterView />
</template>
