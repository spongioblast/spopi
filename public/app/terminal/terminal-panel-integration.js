// ABOUTME: Wires the native Host terminal protocol to the reusable terminal UI modules.
// ABOUTME: Keeps PTY transport and panel lifecycle out of the native app composition root.

import { setDockTerminalTheme } from "../dock/dock.js";
import { TerminalPanel } from "../dock/terminal-panel.js";
import { mountTerminalProfileMenu } from "../dock/terminal-profile-menu.js";
import { onLocaleChange, t } from "../i18n/i18n.js";
import {
  defaultWebglRenderer,
  loadAppearanceCookie,
  migrateTerminalThemeCookie,
  normalizeTerminalProfile,
  TERMINAL_FONT_SIZE_PX,
} from "../settings/appearance-preferences.js";
import { headerChromeRefs } from "../shell/chrome/chat.js";
import { onThemeChange } from "../theme/themes.js";
import { ensureXterm } from "../utils/load-vendor.js";
import { TerminalClient } from "./terminal-client.js";
import { dispatchTerminalToChat, terminalTextForChat } from "./terminal-context.js";
import { loadTerminalFont, TERMINAL_FONT_FAMILY, TERMINAL_FONT_STACK } from "./terminal-font.js";
import { emitTerminalInput } from "./terminal-input-action.js";
import { encodeBase64, resolveTerminalTheme, TerminalTab } from "./terminal-tab.js";

/**
 * Slice of the vendored xterm bundle used here (untyped global).
 * Matches terminal-tab's XtermTerminal plus key-handler / selection hooks.
 * @typedef {{
 *   options?: {
 *     theme?: unknown,
 *     fontSize?: number,
 *     scrollback?: number,
 *     smoothScrollDuration?: number,
 *   },
 *   rows?: number,
 *   element?: { querySelector?: (sel: string) => unknown },
 *   loadAddon: (addon: unknown) => void,
 *   open: (parent: unknown) => void,
 *   onData: (cb: (data: string) => void) => { dispose: () => void },
 *   onResize: (cb: (size: { cols: number, rows: number }) => void) => { dispose: () => void },
 *   write: (data: string | Uint8Array, callback?: () => void) => void,
 *   reset: () => void,
 *   focus: () => void,
 *   refresh: (start: number, end: number) => void,
 *   dispose: () => void,
 *   attachCustomKeyEventHandler?: (handler: (event: KeyboardEvent) => boolean) => void,
 *   getSelection?: () => string,
 * }} IntegrationXtermTerminal
 *
 * @typedef {{ fit: () => void }} IntegrationFitAddon
 *
 * @typedef {{ serialize: (opts?: { scrollback?: number }) => string }} IntegrationSerializeAddon
 *
 * @typedef {{
 *   Terminal: new (options?: Record<string, unknown>) => IntegrationXtermTerminal,
 *   FitAddon: new () => IntegrationFitAddon,
 *   SerializeAddon: new () => IntegrationSerializeAddon,
 *   WebglAddon?: new () => unknown,
 * }} SpopiXtermApi
 *
 * @typedef {typeof globalThis & { SpopiXterm?: SpopiXtermApi }} SpopiGlobal
 *
 * Live tab surface beyond TerminalClient's TerminalTabHandle.
 * @typedef {{
 *   setTheme?: (theme: unknown) => void,
 *   applyPreferences?: (prefs: {
 *     fontSize?: number,
 *     scrollback?: number,
 *     smoothScrollDuration?: number,
 *   }) => void,
 *   enableWebgl?: (factory: () => unknown) => void,
 *   disableWebgl?: () => void,
 *   focus?: () => void,
 *   refit?: () => unknown,
 *   serializeForCheckpoint?: (maxLines?: number) => string,
 *   terminal?: IntegrationXtermTerminal,
 *   writeSnapshot: (checkpoint: string) => void,
 *   writeOutput: (dataBase64: string, opts?: { replay?: boolean }) => void,
 *   ack: (sequence: number) => void,
 *   destroy?: () => void,
 * }} IntegrationLiveTab
 *
 * @typedef {{
 *   fontSize: number,
 *   themeMode: string,
 *   scrollbackLimit: number,
 *   smoothScrollDuration: number,
 *   webglRenderer: boolean,
 * }} TerminalDisplayPreferences
 *
 * @typedef {{
 *   fontSize?: number,
 *   themeMode?: string,
 *   scrollbackLimit?: number,
 *   smoothScrollDuration?: number,
 *   webglRenderer?: boolean,
 * }} TerminalPreferencesPatch
 *
 * @typedef {{
 *   send: (envelope: Record<string, unknown>) => unknown,
 *   setReceiver: (receiver: (frame: unknown) => void) => void,
 *   setConnectionListener: (listener: (connected: boolean) => void) => void,
 * }} TerminalHostAdapter
 *
 * @typedef {{
 *   terminalId: string,
 *   generation?: number,
 *   label?: string,
 *   profileId?: string,
 *   status?: string,
 *   historyGap?: unknown,
 *   failReason?: unknown,
 *   running?: boolean,
 * }} TerminalListedTab
 *
 * @typedef {{
 *   type?: string,
 *   terminalId?: string,
 *   generation?: number,
 *   firstSequence?: number | string,
 *   lastSequence?: number | string,
 *   dataBase64?: string,
 * }} TerminalEventPayload
 *
 * @typedef {{
 *   type?: string,
 *   error?: { code?: string, message?: unknown },
 *   payload?: TerminalEventPayload,
 *   tabs?: TerminalListedTab[],
 *   panelHeightPx?: number,
 * }} TerminalProtocolFrame
 *
 * @typedef {{
 *   create: (profileId?: string) => unknown,
 *   close: (terminalId: string, generation: number) => unknown,
 *   restart: (terminalId: string, generation: number, profileId?: string) => unknown,
 *   focusTab: (id: string) => void,
 *   refitTab: (id: string) => void,
 *   refitAll: () => void,
 *   setPanelHeight: (heightPx: number) => unknown,
 *   checkpointAll: () => Promise<void>,
 *   closeAll: () => Promise<void>,
 * }} TerminalPanelClient
 *
 * @typedef {{
 *   adapter: TerminalHostAdapter,
 *   getWorkspaceId: () => (string | null | undefined),
 * }} MountTerminalPanelOptions
 *
 * @typedef {{
 *   client: TerminalClient,
 *   panel: TerminalPanel,
 *   applyPreferences: (patch?: TerminalPreferencesPatch) => void,
 *   unsubscribeTheme: () => void,
 *   listProfiles: () => Promise<unknown>,
 * }} MountTerminalPanelResult
 */

/**
 * @param {unknown} tab
 * @returns {IntegrationLiveTab}
 */
function asLiveTab(tab) {
  return /** @type {IntegrationLiveTab} */ (tab);
}

/**
 * Terminal display preferences live in the global appearance store
 * (cookie first-paint cache + host preference DB).
 * @returns {TerminalDisplayPreferences}
 */
function currentTerminalPreferences() {
  migrateTerminalThemeCookie();
  const cookie = loadAppearanceCookie();
  const fontSizeKey = /** @type {keyof typeof TERMINAL_FONT_SIZE_PX} */ (cookie.terminalFontSize);
  return {
    fontSize: TERMINAL_FONT_SIZE_PX[fontSizeKey],
    themeMode: /** @type {string} */ (cookie.terminalThemeMode),
    scrollbackLimit: /** @type {number} */ (cookie.terminalScrollbackLimit),
    smoothScrollDuration: /** @type {number} */ (cookie.terminalSmoothScrollDuration),
    webglRenderer:
      typeof cookie.terminalWebglRenderer === "boolean"
        ? cookie.terminalWebglRenderer
        : defaultWebglRenderer(),
  };
}

/**
 * @param {MountTerminalPanelOptions} opts
 * @returns {MountTerminalPanelResult | null}
 */
export function mountTerminalPanel({ adapter, getWorkspaceId }) {
  /** @type {TerminalDisplayPreferences} */
  let prefs = currentTerminalPreferences();
  /** @type {TerminalPanel | undefined} */
  let panel;
  const xtermGlobal = /** @type {SpopiGlobal} */ (globalThis);
  const client = new TerminalClient({
    send: (envelope) => {
      adapter.send({ ...envelope, workspaceId: getWorkspaceId() });
      return /** @type {string | null | undefined} */ (envelope.requestId);
    },
    createTab: (terminalId, generation) => {
      const activePanel = /** @type {TerminalPanel} */ (panel);
      const xtermApi = /** @type {SpopiXtermApi} */ (xtermGlobal.SpopiXterm);
      const tab = new TerminalTab({
        terminalId,
        generation,
        container: activePanel.getTabContainer(terminalId),
        terminalFactory: () =>
          new xtermApi.Terminal({
            fontFamily: TERMINAL_FONT_STACK,
            fontSize: prefs.fontSize,
            fontWeight: 400,
            scrollback: prefs.scrollbackLimit,
            smoothScrollDuration: prefs.smoothScrollDuration,
          }),
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: prefs.fontSize,
        initialTheme: resolveTerminalTheme(prefs.themeMode),
        loadFont: () =>
          loadTerminalFont({ family: TERMINAL_FONT_FAMILY, fontSize: prefs.fontSize }),
        fitAddonFactory: () => new xtermApi.FitAddon(),
        serializeAddonFactory: () => new xtermApi.SerializeAddon(),
        /**
         * @param {string} id
         * @param {number} gen
         * @param {string} dataBase64
         */
        sendInput: (id, gen, dataBase64) => {
          client.command({
            type: "terminal_input",
            terminalId: id,
            generation: gen,
            dataBase64,
          });
          emitTerminalInput({ dataBase64, terminalId: id });
        },
        /**
         * @param {string} id
         * @param {number} gen
         * @param {number} cols
         * @param {number} rows
         */
        sendResize: (id, gen, cols, rows) =>
          client.command({ type: "terminal_resize", terminalId: id, generation: gen, cols, rows }),
      });
      const webglAddon = xtermGlobal.SpopiXterm?.WebglAddon;
      if (prefs.webglRenderer && webglAddon) {
        const WebglAddon = webglAddon;
        tab.enableWebgl(() => new WebglAddon());
      }
      const live = asLiveTab(tab);
      live.terminal?.attachCustomKeyEventHandler?.(
        /** @param {KeyboardEvent} event */
        (event) => {
          const chord =
            event.type === "keydown" &&
            (event.ctrlKey || event.metaKey) &&
            !event.shiftKey &&
            event.key.toLowerCase() === "l";
          if (!chord) return true;
          sendTerminalToChat(terminalId);
          return false;
        },
      );
      return tab;
    },
  });

  /**
   * @param {string} id
   */
  const sendTerminalToChat = (id) => {
    const entry = client.tabs.get(id);
    if (!entry) return;
    const activePanel = /** @type {TerminalPanel} */ (panel);
    const label =
      activePanel.tabs.find(
        /** @param {{ terminalId?: string, label?: string }} tab */ (tab) => tab.terminalId === id,
      )?.label || id;
    dispatchTerminalToChat({ label, ...terminalTextForChat(asLiveTab(entry.tab)) });
  };
  panel = new TerminalPanel(
    /** @type {{ docked?: boolean, fullscreenScope?: string }} */ ({
      enabled: true,
      docked: true,
      subscribeLocale: onLocaleChange,
      onSendToChat: sendTerminalToChat,
      getAvailableHeight: () => document.querySelector(".workspace")?.clientHeight || 600,
      getFullscreenBounds: getChatPanelFullscreenBounds,
      getDefaultProfile: () =>
        normalizeTerminalProfile(loadAppearanceCookie().terminalDefaultProfile),
      client: createPanelClient(client, () => /** @type {TerminalPanel} */ (panel)),
    }),
  );
  const workspace = document.querySelector(".workspace");
  const toolbar = document.querySelector(".workspace .header-right");
  if (!workspace || !toolbar) return null;
  panel.mount({ toggleContainer: toolbar, panelContainer: workspace });
  mountTerminalProfileMenu(
    /** @type {{ button?: Element | null, create?: (profileId: string) => unknown, listProfiles?: () => Promise<unknown>, locked?: () => false }} */ ({
      button: panel.root?.querySelector("[data-terminal-new-tab]"),
      /** @param {string} profileId */
      create: (profileId) => client.command({ type: "terminal_create", profileId }),
      listProfiles: () => listTerminalProfiles(client),
      locked: () => panel.locked,
    }),
  );
  const fileToggle = headerChromeRefs().fileSidebarToggle;
  if (fileToggle && panel.toggleEl) toolbar.insertBefore(panel.toggleEl, fileToggle);

  client.setWorkspaceGeneration(0);
  let terminalOpened = false;
  const originalExpand = panel.expand.bind(panel);
  panel.expand = async () => {
    terminalOpened = true;
    try {
      await ensureXterm();
    } catch {
      return;
    }
    try {
      client.requestList();
    } catch {
      /* socket not open yet; the connection listener lists on connect */
    }
    return originalExpand();
  };
  adapter.setReceiver((frame) => {
    handleTerminalFrame(frame, client, panel);
    const typedFrame = /** @type {TerminalProtocolFrame} */ (frame);
    if (typedFrame?.type !== "terminal_listed") return;
    const theme = resolveTerminalTheme(prefs.themeMode);
    for (const entry of client.tabs.values()) {
      asLiveTab(entry.tab).setTheme?.(theme);
    }
  });
  adapter.setConnectionListener((connected) => {
    if (connected && terminalOpened) client.requestList();
  });
  // xterm paints its own viewport, so it cannot inherit the theme from CSS.
  // Re-derive the xterm theme for every open tab whenever the app theme
  // changes, honoring a forced terminal theme mode; otherwise a terminal keeps
  // the background of the theme it was created under.
  const unsubscribeTheme = onThemeChange(() => {
    const theme = resolveTerminalTheme(prefs.themeMode);
    for (const entry of client.tabs.values()) {
      asLiveTab(entry.tab).setTheme?.(theme);
    }
  });
  const onCssReload = () => {
    const theme = resolveTerminalTheme(prefs.themeMode);
    for (const entry of client.tabs.values()) {
      asLiveTab(entry.tab).setTheme?.(theme);
    }
  };
  document.addEventListener("spopi-css-reload", onCssReload);
  setDockTerminalTheme(prefs.themeMode);

  /**
   * Apply appearance-driven display preferences to every live tab and to all
   * future tabs. Only the fields present in the patch are touched.
   * @param {TerminalPreferencesPatch} [patch]
   */
  function applyPreferences(patch = {}) {
    const fontSize = patch.fontSize;
    if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
      prefs = { ...prefs, fontSize };
    }
    if (patch.themeMode) prefs = { ...prefs, themeMode: patch.themeMode };
    const scrollbackLimit = patch.scrollbackLimit;
    if (typeof scrollbackLimit === "number" && Number.isFinite(scrollbackLimit)) {
      prefs = { ...prefs, scrollbackLimit };
    }
    const smoothScrollDuration = patch.smoothScrollDuration;
    if (typeof smoothScrollDuration === "number" && Number.isFinite(smoothScrollDuration)) {
      prefs = { ...prefs, smoothScrollDuration };
    }
    if (typeof patch.webglRenderer === "boolean") {
      prefs = { ...prefs, webglRenderer: patch.webglRenderer };
    }
    const theme = resolveTerminalTheme(prefs.themeMode);
    setDockTerminalTheme(prefs.themeMode);
    for (const entry of client.tabs.values()) {
      const live = asLiveTab(entry.tab);
      live.applyPreferences?.({
        fontSize: prefs.fontSize,
        scrollback: prefs.scrollbackLimit,
        smoothScrollDuration: prefs.smoothScrollDuration,
      });
      live.setTheme?.(theme);
      const webglAddon = xtermGlobal.SpopiXterm?.WebglAddon;
      if (prefs.webglRenderer && webglAddon) {
        const WebglAddon = webglAddon;
        live.enableWebgl?.(() => new WebglAddon());
      } else {
        live.disableWebgl?.();
      }
    }
  }

  return {
    client,
    panel,
    applyPreferences,
    unsubscribeTheme: () => {
      unsubscribeTheme();
      document.removeEventListener("spopi-css-reload", onCssReload);
    },
    listProfiles: () => listTerminalProfiles(client),
  };
}

/**
 * @param {TerminalClient} client
 * @returns {Promise<unknown>}
 */
function listTerminalProfiles(client) {
  return client.sendAndAwait({ type: "terminal_profiles" }, (message) => {
    const msg = /** @type {{ type?: string }} */ (message);
    return msg.type === "terminal_profiles";
  });
}

/**
 * @returns {{ left: number, top: number, right: number } | null}
 */
function getChatPanelFullscreenBounds() {
  const workspace = document.querySelector(".workspace");
  const workspaceContent = document.querySelector(".workspace-content");
  const main = document.querySelector(".workspace .main");
  if (!workspace || !workspaceContent || !main) return null;

  const workspaceRect = workspace.getBoundingClientRect();
  const contentRect = workspaceContent.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  return {
    left: mainRect.left - workspaceRect.left,
    top: contentRect.top - workspaceRect.top,
    right: workspaceRect.right - mainRect.right,
  };
}

/**
 * @param {TerminalClient} client
 * @param {() => TerminalPanel} getPanel
 * @returns {TerminalPanelClient}
 */
function createPanelClient(client, getPanel) {
  return {
    /** @param {string} [profileId] */
    create: (profileId) => client.command({ type: "terminal_create", profileId }),
    /**
     * @param {string} terminalId
     * @param {number} generation
     */
    close: (terminalId, generation) =>
      client.command({ type: "terminal_close", terminalId, generation }),
    /**
     * @param {string} terminalId
     * @param {number} generation
     * @param {string} [profileId]
     */
    restart: (terminalId, generation, profileId) =>
      client.command({ type: "terminal_restart", terminalId, generation, profileId }),
    /** @param {string} id */
    focusTab: (id) => {
      const entry = client.tabs.get(id);
      if (!entry) return;
      asLiveTab(entry.tab).focus?.();
    },
    /** @param {string} id */
    refitTab: (id) => {
      const entry = client.tabs.get(id);
      if (!entry) return;
      asLiveTab(entry.tab).refit?.();
    },
    refitAll: () => {
      for (const entry of client.tabs.values()) {
        asLiveTab(entry.tab).refit?.();
      }
    },
    /** @param {number} heightPx */
    setPanelHeight: (heightPx) => client.command({ type: "terminal_set_panel_height", heightPx }),
    checkpointAll: async () => {
      const pending = [];
      for (const [terminalId, entry] of client.tabs) {
        const live = asLiveTab(entry.tab);
        const snapshot = live.serializeForCheckpoint?.(2000);
        if (!snapshot) continue;
        pending.push(
          client.sendAndAwait(
            {
              type: "terminal_checkpoint",
              terminalId,
              generation: entry.generation,
              watermark: entry.lastAppliedSequence,
              snapshotBase64: encodeBase64(new TextEncoder().encode(snapshot)),
            },
            (message) => {
              const msg = /** @type {{ type?: string, terminalId?: string }} */ (message);
              return msg.type === "terminal_checkpoint_acked" && msg.terminalId === terminalId;
            },
          ),
        );
      }
      await Promise.all(pending);
    },
    closeAll: async () => {
      for (const [terminalId, entry] of client.tabs) {
        client.command({ type: "terminal_close", terminalId, generation: entry.generation });
      }
      client.reset();
      getPanel().setTabs([]);
    },
  };
}

/**
 * @param {unknown} message
 * @returns {unknown}
 */
export function formatTerminalStartError(message) {
  if (typeof message === "string" && message.includes("Git for Windows")) {
    return t("terminal.gitBashMissing");
  }
  return message || t("terminal.statusFailed");
}

/**
 * @param {unknown} frame
 * @param {TerminalClient} client
 * @param {TerminalPanel} panel
 */
export function handleTerminalFrame(frame, client, panel) {
  const msg = /** @type {TerminalProtocolFrame | null | undefined} */ (frame);
  if (msg?.type === "error") {
    if (msg.error?.code === "terminal_command_failed") {
      panel.showStartError?.(formatTerminalStartError(msg.error.message));
      client.requestList();
    }
    return;
  }
  if (msg?.type === "terminal_event") {
    const payload = msg.payload || {};
    if (payload.type === "terminal_output") {
      client.applyOutput(/** @type {Parameters<TerminalClient["applyOutput"]>[0]} */ (payload));
      panel.markActivity(/** @type {string} */ (payload.terminalId));
    } else if (payload.type === "terminal_exited" || payload.type === "terminal_failed") {
      client.removeTab(/** @type {string} */ (payload.terminalId), payload.generation ?? null);
      client.requestList();
    }
    return;
  }
  if (typeof msg?.type !== "string" || !msg.type.startsWith("terminal_")) return;
  client.resolveResponse(msg);
  if (msg.type === "terminal_listed") {
    client.applyListed(/** @type {Parameters<TerminalClient["applyListed"]>[0]} */ (msg));
    const listedTabs = /** @type {TerminalListedTab[]} */ (msg.tabs || []);
    panel.setTabs(
      listedTabs.map(
        ({
          terminalId,
          generation,
          label,
          profileId,
          status,
          historyGap,
          failReason,
          running,
        }) => ({
          terminalId,
          generation,
          label,
          profileId,
          status,
          historyGap,
          running,
          failReason: failReason ? formatTerminalStartError(failReason) : undefined,
        }),
      ),
    );
    const panelHeightPx = msg.panelHeightPx;
    if (typeof panelHeightPx === "number" && Number.isFinite(panelHeightPx)) {
      panel.setHeight(panelHeightPx);
    }
    const listed = msg.tabs || [];
    if (
      panel.docked &&
      (listed.length === 0 ||
        listed.every(
          /** @param {TerminalListedTab} tab */ (tab) => tab.status === "restoredMetadata",
        ))
    ) {
      void panel.expand();
    }
  } else if (["terminal_created", "terminal_restarted", "terminal_closed"].includes(msg.type)) {
    if (msg.type === "terminal_created") {
      panel.activateWhenListed?.(/** @type {{ terminalId?: string }} */ (msg).terminalId);
    }
    client.requestList();
  }
}
