<script setup lang="ts">
import Icon from './Icon.vue'
import { confirmState, settleConfirm } from '../core/confirm'
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.open" class="sheet-mask cf-mask" @click.self="settleConfirm(false)">
      <div class="scrim" @click="settleConfirm(false)" />
      <div class="sheet cf-sheet" role="alertdialog" :aria-label="confirmState.title">
        <div class="grab" />
        <div class="cf-body">
          <div class="cf-ico" :class="{ danger: confirmState.danger }">
            <Icon :name="confirmState.danger ? 'trash' : 'info'" :size="20" />
          </div>
          <div class="cf-text">
            <div class="cf-title">{{ confirmState.title }}</div>
            <div v-if="confirmState.body" class="cf-sub">{{ confirmState.body }}</div>
          </div>
        </div>
        <div class="cf-actions">
          <button class="btn btn-ghost f1" @click="settleConfirm(false)">
            {{ confirmState.cancelText }}
          </button>
          <button
            class="btn f1"
            :class="confirmState.danger ? 'cf-danger' : 'btn-primary'"
            @click="settleConfirm(true)"
          >
            {{ confirmState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cf-sheet {
  padding-bottom: calc(16px + var(--safe-bottom));
}
.cf-body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px var(--pad) 4px;
}
.cf-ico {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tint-softer);
  color: var(--tint);
}
.cf-ico.danger {
  background: rgb(189 83 71 / 0.1);
  color: var(--cinnabar);
}
.cf-text {
  min-width: 0;
  padding-top: 1px;
}
.cf-title {
  font-family: var(--serif);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
  letter-spacing: 0.01em;
}
.cf-sub {
  margin-top: 5px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ink-3);
}
.cf-actions {
  display: flex;
  gap: 10px;
  padding: 16px var(--pad) 0;
}
.cf-actions .btn {
  height: 46px;
}
.cf-actions .cf-danger {
  background: var(--cinnabar);
  color: #fff;
  box-shadow: 0 6px 18px rgb(189 83 71 / 0.28);
}
.cf-actions .cf-danger:active {
  transform: scale(0.985);
}
</style>
