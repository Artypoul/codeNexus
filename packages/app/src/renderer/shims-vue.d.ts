// Vue 单文件组件类型声明：让 TypeScript 识别 `*.vue` 模块。
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>;
  export default component;
}

declare module "@codenexus/feature-imagegen/renderer/components/*" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>;
  export default component;
}
