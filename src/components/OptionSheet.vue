<script setup lang="ts">
import Icon from './Icon.vue'

type Option = {
  value: string | number
  label: string
  desc?: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    sub?: string
    options: Option[]
    value: string | number
    layout?: 'list' | 'chips'
  }>(),
  { layout: 'list', sub: '' }
)

const emit = defineEmits<{ close: []; pick: [value: string | number] }>()

function isOn(option: Option): boolean {
  return String(option.value) === String(props.value)
}

function choose(option: Option): void {
  emit('pick', option.value)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sheet-mask" @click.self="emit('close')">
      <div class="scrim" @click="emit('close')" />
      <div class="sheet opt-sheet" role="dialog" :aria-label="title">
        <div class="grab" />
        <div class="sh-head">
          <div class="hdtext">
            <div class="sh-title">{{ title }}</div>
            <div v-if="sub" class="sh-sub">{{ sub }}</div>
          </div>
          <button class="iconbtn quiet" aria-label="关闭" @click="emit('close')">
            <Icon name="close" :size="18" />
          </button>
        </div>

        <div v-if="layout === 'chips'" class="opt-chips">
          <button
            v-for="option in options"
            :key="String(option.value)"
            class="chip"
            :class="{ active: isOn(option) }"
            @click="choose(option)"
          >
            {{ option.label }}
          </button>
        </div>

        <div v-else class="opt-list">
          <button
            v-for="option in options"
            :key="String(option.value)"
            class="opt"
            :class="{ on: isOn(option) }"
            :aria-pressed="isOn(option)"
            @click="choose(option)"
          >
            <span class="otext">
              <span class="olab">{{ option.label }}</span>
              <span v-if="option.desc" class="osub">{{ option.desc }}</span>
            </span>
            <span class="oradio" :class="{ on: isOn(option) }">
              <Icon v-if="isOn(option)" name="check" :size="12" />
            </span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.opt-sheet {
  padding-bottom: calc(14px + var(--safe-bottom));
}
.hdtext {
  min-width: 0;
}
.sh-sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ink-4);
}
.opt-list {
  max-height: min(58vh, 460px);
  overflow-y: auto;
  padding-bottom: 4px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px var(--pad);
  text-align: left;
  border-bottom: 1px solid var(--line);
}
.opt:last-child {
  border-bottom: 0;
}
.opt:active {
  background: var(--tint-softer);
}
.otext {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.olab {
  font-size: 14.5px;
  color: var(--ink);
  letter-spacing: 0.005em;
}
.opt.on .olab {
  color: var(--tint);
  font-weight: 600;
}
.osub {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--ink-4);
}
.oradio {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--line-2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  transition: background 0.18s var(--e-out), border-color 0.18s var(--e-out);
}
.oradio.on {
  background: var(--tint);
  border-color: var(--tint);
}
.opt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px var(--pad) 8px;
}
.opt-chips .chip {
  height: 36px;
  padding: 0 14px;
  font-variant-numeric: tabular-nums;
}
</style>
