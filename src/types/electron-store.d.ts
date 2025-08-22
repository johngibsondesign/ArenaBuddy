declare module 'electron-store' {
  interface Options<T> { name?: string; defaults?: Partial<T>; }
  class Store<T extends Record<string, any>> {
    constructor(options?: Options<T>);
    get<K extends keyof T>(key: K): T[K] | undefined;
    set<K extends keyof T>(key: K, value: T[K]): void;
    has(key: keyof T): boolean;
    delete(key: keyof T): void;
    clear(): void;
    readonly store: T;
  }
  export = Store;
}