// ABOUTME: Add-server dialog. The spec it builds is what `pi mcp add` receives.
// ABOUTME: Arguments stay a list; a value is never split on spaces.

import { t } from "../../i18n/i18n.js";
import { confirmDialog, openDialog } from "../../ui/dialog.js";
import { el } from "../../ui/dom.js";
import { enhanceSelect } from "../../ui/select-menu.js";
import { clashingName, looksLikeToken, validServerName } from "./mcp-model.js";

/** The hints show Pi's literal `${NAME}` syntax; t() would blank an unfilled `{NAME}`. */
const LITERAL_NAME = { NAME: "{NAME}" };

/**
 * @param {{
 *   control?: { addMcpServer?: Function },
 *   workspaceId?: string,
 *   servers?: Array<{ name?: string, scope?: string }>,
 *   onAdded?: (server: { name?: string, state?: string }) => void,
 *   notify?: (notice: { type?: string, title?: string, message?: string, action?: { label: string, run: () => void } }) => void,
 * }} deps
 */
export function openAddServerDialog(deps) {
  const name = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const scope = /** @type {HTMLSelectElement} */ (el("select", { class: "ui-select" }));
  scope.append(
    el("option", { value: "global", text: t("settings.mcp.scopeGlobal") }),
    el("option", { value: "project", text: t("settings.mcp.scopeProject") }),
  );
  const kind = /** @type {HTMLSelectElement} */ (el("select", { class: "ui-select" }));
  kind.append(
    el("option", { value: "stdio", text: t("settings.mcp.kindCommand") }),
    el("option", { value: "http", text: t("settings.mcp.kindUrl") }),
  );
  const command = /** @type {HTMLInputElement} */ (
    el("input", { class: "ui-input", placeholder: "npx" })
  );
  const argsBox = /** @type {HTMLElement} */ (el("div", { class: "mcp-arg-list" }));
  const envBox = /** @type {HTMLElement} */ (el("div", { class: "mcp-arg-list" }));
  const cwd = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const url = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const auth = /** @type {HTMLSelectElement} */ (el("select", { class: "ui-select" }));
  for (const [value, key] of [
    ["none", "settings.mcp.authNone"],
    ["oauth", "settings.mcp.authOauth"],
    ["bearer", "settings.mcp.authBearer"],
    ["headers", "settings.mcp.authHeaders"],
  ]) {
    auth.append(el("option", { value, text: t(key) }));
  }
  const bearer = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const headersBox = /** @type {HTMLElement} */ (el("div", { class: "mcp-arg-list" }));
  const clientId = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const clientSecret = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const callbackPort = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const clientName = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const exposure = /** @type {HTMLSelectElement} */ (el("select", { class: "ui-select" }));
  for (const [value, key] of [
    ["codemode", "settings.mcp.exposureCodemode"],
    ["deferred", "settings.mcp.exposureDeferred"],
    ["direct", "settings.mcp.exposureDirect"],
    ["hidden", "settings.mcp.exposureHidden"],
  ]) {
    exposure.append(el("option", { value, text: `${value}: ${t(key)}` }));
  }
  const description = /** @type {HTMLInputElement} */ (el("input", { class: "ui-input" }));
  const error = el("p", { class: "mcp-form-error" });
  const warning = el("p", { class: "mcp-form-warning" });
  const projectHint = /** @type {HTMLElement} */ (
    el("p", { class: "settings-help", text: t("settings.mcp.keepGlobal") })
  );

  /** @type {HTMLInputElement[]} */
  const argInputs = [];
  /** @type {Array<[HTMLInputElement, HTMLInputElement]>} */
  const envInputs = [];
  /** @type {Array<[HTMLInputElement, HTMLInputElement]>} */
  const headerInputs = [];

  /**
   * @param {HTMLElement} box
   * @param {Array<[HTMLInputElement, HTMLInputElement]>} list
   */
  const addPair = (box, list) => {
    const key = /** @type {HTMLInputElement} */ (
      el("input", { class: "ui-input", placeholder: t("settings.mcp.name") })
    );
    const value = /** @type {HTMLInputElement} */ (
      el("input", { class: "ui-input", placeholder: t("settings.mcp.value") })
    );
    value.addEventListener("input", refresh);
    list.push([key, value]);
    box.append(el("div", { class: "mcp-pair" }, [key, value]));
  };
  const addArg = () => {
    const input = /** @type {HTMLInputElement} */ (
      el("input", { class: "ui-input", placeholder: t("settings.mcp.argument") })
    );
    argInputs.push(input);
    argsBox.append(input);
  };
  addArg();

  const body = el("div", { class: "mcp-add-form" }, [
    labeled("settings.mcp.name", name),
    labeled("settings.mcp.scope", scope),
    projectHint,
    labeled("settings.mcp.type", kind),
    el("div", { class: "mcp-stdio" }, [
      labeled("settings.mcp.command", command),
      el("p", { class: "settings-help", text: t("settings.mcp.envHint", LITERAL_NAME) }),
      argsBox,
      el("button", {
        type: "button",
        class: "ui-button",
        text: t("settings.mcp.addArgument"),
        onClick: addArg,
      }),
      envBox,
      el("button", {
        type: "button",
        class: "ui-button",
        text: t("settings.mcp.addEnv"),
        onClick: () => addPair(envBox, envInputs),
      }),
      labeled("settings.mcp.cwd", cwd),
    ]),
    el("div", { class: "mcp-http" }, [
      labeled("settings.mcp.url", url),
      labeled("settings.mcp.signInMode", auth),
      labeled("settings.mcp.bearerEnv", bearer),
      headersBox,
      el("button", {
        type: "button",
        class: "ui-button",
        text: t("settings.mcp.addHeader"),
        onClick: () => addPair(headersBox, headerInputs),
      }),
      el("details", {}, [
        el("summary", { text: t("settings.mcp.advancedOauth") }),
        labeled("settings.mcp.clientId", clientId),
        labeled("settings.mcp.clientSecret", clientSecret),
        labeled("settings.mcp.callbackPort", callbackPort),
        labeled("settings.mcp.clientName", clientName),
      ]),
    ]),
    labeled("settings.mcp.exposure", exposure),
    labeled("settings.mcp.description", description),
    el("p", { class: "settings-help", text: t("settings.mcp.descriptionHint") }),
    warning,
    error,
  ]);

  const sameScopeNames = () =>
    (deps.servers ?? [])
      .filter((server) => server.scope === scope.value)
      .map((server) => String(server.name ?? ""));

  const handle = openDialog({
    title: t("settings.mcp.add"),
    body,
    actions: [
      {
        label: t("actions.cancel"),
        className: "ui-button ui-button--secondary",
        onClick: () => handle.close(),
      },
      {
        label: t("settings.mcp.add"),
        className: "ui-button ui-button--primary",
        onClick: () => void submitForm(),
      },
    ],
  });
  const submit = /** @type {HTMLButtonElement} */ (
    handle.element.querySelector(".dialog-actions .ui-button--primary")
  );
  for (const select of [scope, kind, exposure]) enhanceSelect(select);
  const authMenu = enhanceSelect(auth);

  function refresh() {
    const http = kind.value === "http";
    body.querySelector(".mcp-stdio")?.toggleAttribute("hidden", http);
    body.querySelector(".mcp-http")?.toggleAttribute("hidden", !http);
    projectHint.hidden = scope.value !== "project";
    bearer.disabled = scope.value === "project";
    if (http && url.value.startsWith("https://") && auth.value === "none") {
      auth.value = "oauth";
      authMenu?.sync();
    }
    const names = sameScopeNames();
    const clash = clashingName(name.value.trim(), names);
    const replace = names.includes(name.value.trim());
    submit.textContent = replace ? t("settings.mcp.replace") : t("settings.mcp.add");
    const ready = http
      ? url.value.trim().startsWith("http://") || url.value.trim().startsWith("https://")
      : Boolean(command.value.trim());
    submit.disabled = !validServerName(name.value.trim()) || Boolean(clash) || !ready;
    warning.textContent = clash
      ? t("settings.mcp.clash", { name: clash })
      : secretText()
        ? t("settings.mcp.secretWarning", LITERAL_NAME)
        : "";
  }

  function secretText() {
    const values = [
      ...envInputs.map((pair) => pair[1].value),
      ...headerInputs.map((pair) => pair[1].value),
      clientSecret.value,
    ];
    return values.some(looksLikeToken);
  }

  for (const input of [name, scope, kind, command, url, auth, description, clientSecret]) {
    input.addEventListener("input", refresh);
    input.addEventListener("change", refresh);
  }
  refresh();

  async function submitForm() {
    refresh();
    if (submit.disabled) return;
    if (sameScopeNames().includes(name.value.trim())) {
      const ok = await confirmDialog({
        title: t("settings.mcp.replace"),
        message: t("settings.mcp.replaceConfirm", { name: name.value.trim() }),
      });
      if (!ok) return;
    }
    error.textContent = "";
    try {
      await deps.control?.addMcpServer?.(specFromForm(), { workspaceId: deps.workspaceId });
      handle.close();
      deps.onAdded?.({ name: name.value.trim() });
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : String(failure);
    }
  }

  function specFromForm() {
    const http = kind.value === "http";
    /** @type {Record<string, unknown>} */
    const spec = {
      name: name.value.trim(),
      scope: scope.value,
      kind: kind.value,
      exposure: exposure.value,
      description: description.value.trim(),
    };
    if (!http) {
      spec.command = command.value.trim();
      spec.args = argInputs.map((input) => input.value).filter((value) => value !== "");
      spec.env = envInputs
        .filter((pair) => pair[0].value.trim())
        .map((pair) => [pair[0].value.trim(), pair[1].value]);
      spec.cwd = cwd.value.trim();
    } else {
      spec.url = url.value.trim();
      if (auth.value === "bearer") spec.bearerTokenEnvVar = bearer.value.trim();
      if (auth.value === "headers") {
        spec.headers = headerInputs
          .filter((pair) => pair[0].value.trim())
          .map((pair) => [pair[0].value.trim(), pair[1].value]);
      }
      if (clientId.value.trim()) spec.oauthClientId = clientId.value.trim();
      if (clientSecret.value.trim()) spec.oauthClientSecret = clientSecret.value.trim();
      if (callbackPort.value.trim()) spec.oauthCallbackPort = Number(callbackPort.value);
      if (clientName.value.trim()) spec.oauthClientName = clientName.value.trim();
    }
    return spec;
  }
}

/** @param {string} key @param {HTMLElement} control */
function labeled(key, control) {
  return el("label", { class: "mcp-field" }, [el("span", { text: t(key) }), control]);
}
