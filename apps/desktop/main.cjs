const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  session,
  desktopCapturer,
  Menu,
} = require("electron");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
let window,
  server = "",
  settingsPath;
function trusted(url) {
  try {
    return server && new URL(url).origin === new URL(server).origin;
  } catch {
    return false;
  }
}
function validServer(value) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash)
    throw new Error(
      "Use a plain HTTPS server address without credentials, a query or a fragment.",
    );
  if (
    u.protocol !== "https:" &&
    !(
      process.env.CHATFINITY_ALLOW_LOCAL_HTTP === "true" &&
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(u.hostname)
    )
  )
    throw new Error("Your server address must use HTTPS.");
  if (u.pathname !== "/")
    throw new Error(
      "Use the server’s root address, such as https://chat.innaware.net.",
    );
  return u.origin;
}
async function loadServer(url) {
  server = validServer(url);
  await writeFile(settingsPath, JSON.stringify({ server }), { mode: 0o600 });
  await window.loadURL(server);
}
function setup() {
  server = "";
  window.loadFile(path.join(__dirname, "setup.html"));
}
function isSetupSender(event) {
  return (
    event.sender === window.webContents &&
    event.senderFrame?.url ===
      require("node:url").pathToFileURL(path.join(__dirname, "setup.html")).href
  );
}
app.whenReady().then(async () => {
  settingsPath = path.join(app.getPath("userData"), "server.json");
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 500,
    title: "ChatFinity",
    icon: path.join(__dirname, "assets/icon.png"),
    backgroundColor: "#f4f6f1",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "ChatFinity",
        submenu: [
          {
            label: "Connect to a different server…",
            click: async () => {
              const result = await dialog.showMessageBox(window, {
                type: "question",
                message: "Connect to a different ChatFinity server?",
                detail:
                  "This signs you out of the current server on this device and clears its local drafts and preferences.",
                buttons: ["Cancel", "Change server"],
                cancelId: 0,
              });
              if (result.response === 1) {
                await session.defaultSession.clearStorageData();
                await session.defaultSession.clearCache();
                setup();
              }
            },
          },
          { label: "Reload", role: "reload" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );
  ipcMain.handle("connect-server", async (event, value) => {
    if (!isSetupSender(event)) throw new Error("Unauthorized");
    try {
      if (typeof value !== "string" || value.length > 2048)
        throw new Error("Invalid address.");
      await loadServer(value);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (trusted(url) && new URL(url).pathname.startsWith("/api/files/")) {
      window.webContents.downloadURL(url);
    } else if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  session.defaultSession.setPermissionRequestHandler(
    async (contents, permission, callback, details) => {
      const origin = details.requestingUrl || contents.getURL();
      if (contents !== window.webContents || !trusted(origin)) {
        callback(false);
        return;
      }
      if (
        ![
          "media",
          "display-capture",
          "notifications",
          "speaker-selection",
        ].includes(permission)
      ) {
        callback(false);
        return;
      }
      const names = {
        media: "use your camera or microphone",
        "display-capture": "share your screen",
        notifications: "show desktop notifications",
        "speaker-selection": "select an audio output device",
      };
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        message: `Allow ChatFinity to ${names[permission]}?`,
        detail: `Requested by ${server}`,
        buttons: ["Deny", "Allow"],
        defaultId: 0,
        cancelId: 0,
      });
      callback(choice.response === 1);
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin) =>
      contents === window.webContents &&
      trusted(origin) &&
      [
        "media",
        "display-capture",
        "notifications",
        "speaker-selection",
      ].includes(permission),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!trusted(request.securityOrigin)) {
        callback({});
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        const choices = sources.slice(0, 20);
        if (!choices.length) {
          callback({});
          return;
        }
        const selection = await dialog.showMessageBox(window, {
          type: "question",
          message: "Choose what to share",
          detail:
            "Only share a screen or window you intend other meeting participants to see.",
          buttons: ["Cancel", ...choices.map((s) => s.name)],
          cancelId: 0,
          defaultId: 0,
        });
        if (selection.response === 0) {
          callback({});
          return;
        }
        callback({ video: choices[selection.response - 1] });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
  session.defaultSession.on("will-download", async (event, item) => {
    if (!trusted(item.getURL())) {
      event.preventDefault();
      return;
    }
    // Chromium’s native save dialog is used; server-supplied filenames are never opened automatically.
    item.setSaveDialogOptions({ title: "Save ChatFinity attachment" });
  });
  window.webContents.on("page-title-updated", (_event, title) => {
    if (process.platform === "darwin")
      app.dock.setBadge(title.startsWith("●") ? "•" : "");
    if (title.startsWith("●") && !window.isFocused()) window.flashFrame(true);
  });
  window.on("focus", () => window.flashFrame(false));
  window.webContents.on("did-fail-load", (_event, code) => {
    if (code !== -3 && server)
      void dialog.showMessageBox(window, {
        type: "warning",
        message: "Could not reach your ChatFinity server.",
        detail:
          "Check your connection, then use ChatFinity → Reload. You can change the server from the ChatFinity menu.",
      });
  });
  try {
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));
    await loadServer(process.env.CHATFINITY_SERVER_URL || saved.server);
  } catch {
    if (process.env.CHATFINITY_SERVER_URL) {
      try {
        await loadServer(process.env.CHATFINITY_SERVER_URL);
      } catch {
        setup();
      }
    } else setup();
  }
  app.on("activate", () => {
    if (window && !window.isDestroyed()) window.show();
  });
});
app.on("window-all-closed", () => app.quit());
