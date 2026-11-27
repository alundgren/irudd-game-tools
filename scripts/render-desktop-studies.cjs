const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const [page, output, profile] = process.argv.slice(2);
app.setPath("userData", profile);
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(page);
    const studies = await win.webContents.executeJavaScript("readStudyForms()");
    writeFileSync(output, JSON.stringify(studies));
  } catch (error) {
    console.error(error);
    app.exit(1);
    return;
  }
  app.quit();
});
