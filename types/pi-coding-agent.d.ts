// 本地类型声明存根：@oh-my-pi/pi-coding-agent 的扩展 API 表面
// 仅声明本扩展实际使用的部分；真实类型由宿主在运行时提供
// 真实定义见 oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts
declare module "@oh-my-pi/pi-coding-agent" {
  export type NotifyLevel = "info" | "warning" | "error";
  export type WidgetPlacement = "aboveEditor" | "belowEditor";

  export interface ExtensionWidgetOptions {
    placement?: WidgetPlacement;
  }

  export type ExtensionWidgetContent = string[] | undefined;

  export interface ScrollToEntryOptions {
    align?: "start" | "center" | "end" | "nearest";
    highlight?: boolean;
  }

  export interface ExtensionUI {
    setWidget(
      key: string,
      content: ExtensionWidgetContent,
      options?: ExtensionWidgetOptions,
    ): void;
    scrollToEntryId?(
      entryId: string,
      options?: ScrollToEntryOptions,
    ): boolean | Promise<boolean>;
    onTerminalInput?(
      handler: (data: string) => { consume?: boolean } | undefined,
    ): () => void;
    notify(message: string, type?: NotifyLevel): void;
  }

  export interface MessageLike {
    id?: string;
    role?: string;
    content?: unknown;
    text?: string;
  }

  export interface SessionEntry {
    type: "message" | "user" | "assistant" | string;
    id: string;
    parentId?: string | null;
    timestamp?: string;
    message?: MessageLike;
    role?: string;
    content?: unknown;
    text?: string;
  }

  export interface ReadonlySessionManager {
    getBranch?(): SessionEntry[];
    getEntries?(): SessionEntry[];
  }

  export interface ExtensionContext {
    ui: ExtensionUI;
    sessionManager: ReadonlySessionManager;
    navigateTree?(id: string, opts?: { summarize?: boolean }): Promise<unknown>;
  }

  export interface ExtensionLogger {
    error(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
  }

  export interface ShortcutOptions {
    description?: string;
    handler: (ctx: ExtensionContext) => void | Promise<void>;
  }

  export interface ExtensionAPI {
    setLabel(label: string): void;
    on(
      event: string,
      handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>
    ): void;
    registerShortcut(shortcut: string, options: ShortcutOptions): void;
    readonly logger?: ExtensionLogger;
  }
}
