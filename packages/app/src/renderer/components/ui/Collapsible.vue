<template>
  <div class="ui-collapsible" :class="{ 'is-open': isOpen, 'is-disabled': disabled }">
    <slot name="trigger" :open="isOpen" :disabled="disabled" :toggle="toggle" :triggerProps="triggerProps" />
    <Transition v-if="motion === 'fade'" name="ui-collapsible-fade">
      <div
        v-if="shouldMountFadeContent"
        v-show="isOpen"
        :id="contentId"
        class="ui-collapsible-fade-content"
        :aria-hidden="isOpen ? 'false' : 'true'"
      >
        <slot />
      </div>
    </Transition>
    <div
      v-else
      :id="contentId"
      class="ui-collapsible-content"
      :class="{ 'is-open': isOpen }"
      :aria-hidden="isOpen ? 'false' : 'true'"
      @transitionend="onHeightTransitionEnd"
    >
      <div class="ui-collapsible-inner">
        <slot v-if="shouldMountHeightContent" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 可折叠组件：通用折叠/展开逻辑与键盘/可访问性属性。
import { computed, onBeforeUnmount, ref, watch } from "vue";

type TriggerProps = {
  role: "button";
  tabindex: number;
  "aria-expanded": "true" | "false";
  "aria-controls": string;
  onClick: (event: MouseEvent) => void;
  onKeydown: (event: KeyboardEvent) => void;
};

let nextCollapsibleId = 0;

const props = withDefaults(
  defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    disabled?: boolean;
    contentId?: string;
    motion?: "height" | "fade";
    keepMounted?: boolean;
    lazy?: boolean;
  }>(),
  {
    defaultOpen: false,
    disabled: false,
    motion: "height",
    keepMounted: false,
    lazy: false,
  }
);

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
}>();

const internalOpen = ref(Boolean(props.defaultOpen));
const instanceId = nextCollapsibleId++;

const isControlled = computed(() => typeof props.open === "boolean");
const isOpen = computed(() => (isControlled.value ? Boolean(props.open) : internalOpen.value));
const disabled = computed(() => Boolean(props.disabled));
const contentId = computed(() => props.contentId ?? `ui-collapsible-${instanceId}`);
const motion = computed(() => (props.motion === "fade" ? "fade" : "height"));
const keepMounted = computed(() => Boolean(props.keepMounted));

const hasEverOpened = ref(isOpen.value);
const heightContentMounted = ref(isOpen.value);
let heightUnmountTimer: ReturnType<typeof setTimeout> | null = null;

function clearHeightUnmountTimer() {
  if (heightUnmountTimer == null) return;
  clearTimeout(heightUnmountTimer);
  heightUnmountTimer = null;
}

function unmountHeightContent() {
  clearHeightUnmountTimer();
  if (!isOpen.value) heightContentMounted.value = false;
}

function onHeightTransitionEnd(event: TransitionEvent) {
  if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows") return;
  unmountHeightContent();
}

watch(
  isOpen,
  (next) => {
    clearHeightUnmountTimer();
    if (next) hasEverOpened.value = true;
    if (next) heightContentMounted.value = true;
    else if (props.lazy && heightContentMounted.value) {
      heightUnmountTimer = setTimeout(unmountHeightContent, 260);
    }
  },
  { immediate: true, flush: "sync" }
);

const shouldMountHeightContent = computed(
  () => !props.lazy || heightContentMounted.value || (keepMounted.value && hasEverOpened.value)
);
onBeforeUnmount(clearHeightUnmountTimer);

// fade 模式下可按需保留 DOM，避免频繁卸载导致内容重算。
const shouldMountFadeContent = computed(() => {
  if (motion.value !== "fade") return false;
  if (isOpen.value) return true;
  return keepMounted.value && hasEverOpened.value;
});

// 支持受控/非受控两种模式：受控时仅派发事件。
const setOpen = (next: boolean) => {
  if (disabled.value) return;
  if (!isControlled.value) internalOpen.value = next;
  emit("update:open", next);
};

const toggle = () => {
  setOpen(!isOpen.value);
};

const onTriggerClick = (event: MouseEvent) => {
  if (disabled.value) return;
  event.preventDefault();
  toggle();
};

const onTriggerKeydown = (event: KeyboardEvent) => {
  if (disabled.value) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggle();
  }
};

// 把触发器交互属性集中打包，供具名插槽直接透传。
const triggerProps = computed<TriggerProps>(() => {
  return {
    role: "button",
    tabindex: disabled.value ? -1 : 0,
    "aria-expanded": isOpen.value ? "true" : "false",
    "aria-controls": contentId.value,
    onClick: onTriggerClick,
    onKeydown: onTriggerKeydown,
  };
});
</script>
