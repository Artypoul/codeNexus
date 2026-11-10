<template>
  <aside class="sidebar sidebar-left">
    <div class="lsb-shell lsb-shell--threads-only">
      <section class="lsb-pane-frame" data-pane="threads">
        <ThreadHistoryPane @open-search="emit('open-search')" />
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
const emit = defineEmits<{ "open-search": [] }>();

import ThreadHistoryPane from "./left-sidebar/ThreadHistoryPane.vue";
</script>
