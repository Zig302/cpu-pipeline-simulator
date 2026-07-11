declare module "/wasm/cpu_core.js" {
  const factory: (options: { locateFile: (path: string) => string }) => Promise<unknown>;
  export default factory;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
