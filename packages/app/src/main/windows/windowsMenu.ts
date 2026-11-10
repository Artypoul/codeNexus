import { app, dialog, Menu, type BrowserWindow, type Input, type MenuItemConstructorOptions } from "electron";

type MenuInput = Pick<Input, "key" | "type" | "isAutoRepeat" | "isComposing" | "shift" | "control" | "alt" | "meta">;

export function createMenuKeyHandler(): (input: MenuInput) => boolean {
  let bareAlt = false;
  return (input) => {
    const unmodified = !input.control && !input.shift && !input.meta && !input.isComposing;
    if (input.key === "Alt") {
      if (input.type === "keyDown") {
        if (!input.isAutoRepeat) bareAlt = unmodified;
        return false;
      }
      const open = bareAlt && unmodified && !input.isAutoRepeat;
      bareAlt = false;
      return open;
    }
    if (input.type === "keyDown") bareAlt = false;
    return input.key === "F10" && input.type === "keyDown" && unmodified && !input.alt && !input.isAutoRepeat;
  };
}

export function installWindowsMenu(win: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    { label: "File", submenu: [{ label: "Close Window", click: () => win.close() }] },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Developer Tools", click: () => win.webContents.toggleDevTools() },
        { type: "separator" },
        { label: "Toggle Full Screen", click: () => win.setFullScreen(!win.isFullScreen()) },
      ],
    },
    {
      label: "Window",
      submenu: [
        { label: "Minimize", click: () => win.minimize() },
        { label: "Maximize / Restore", click: () => (win.isMaximized() ? win.unmaximize() : win.maximize()) },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About CodeNexus",
          click: () => {
            void dialog.showMessageBox(win, {
              title: "About CodeNexus",
              message: `CodeNexus ${app.getVersion()}`,
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  let handleKey = createMenuKeyHandler();
  win.on("blur", () => {
    handleKey = createMenuKeyHandler();
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (!handleKey(input)) return;
    event.preventDefault();
    menu.popup({ window: win, x: 0, y: 0 });
  });
}
