import { computed, inject, provide, shallowRef, type InjectionKey, type Ref } from "vue";

type ActivityItemStates = Map<string, Ref<unknown>>;
const activityItemStatesKey: InjectionKey<Ref<ActivityItemStates>> = Symbol("activityItemStates");

export function provideActivityItemStates() {
  const states = shallowRef<ActivityItemStates>(new Map());
  provide(activityItemStatesKey, states);
  return () => {
    states.value = new Map();
  };
}

export function useActivityItemState<Value>(key: () => string, initial: () => Value) {
  const states = inject(activityItemStatesKey, null);
  const fallback = shallowRef(initial());
  function state() {
    if (!states) return fallback;
    const stateKey = key();
    let value = states.value.get(stateKey) as Ref<Value> | undefined;
    if (!value) {
      value = shallowRef(initial());
      states.value.set(stateKey, value);
    }
    return value;
  }
  return computed({ get: () => state().value, set: (value: Value) => (state().value = value) });
}
