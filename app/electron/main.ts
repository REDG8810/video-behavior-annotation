import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, unlink, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow | null = null

function toMediaSelection(filePath: string) {
  return { filePath, fileName: basename(filePath), url: pathToFileURL(filePath).href }
}

async function chooseVideo() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '動画を選択',
    properties: ['openFile'],
    filters: [{ name: '動画', extensions: ['mov', 'mp4', 'm4v'] }],
  })
  return result.canceled || !result.filePaths[0] ? null : toMediaSelection(result.filePaths[0])
}

async function openProject() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'プロジェクトを開く',
    properties: ['openFile'],
    filters: [{ name: 'Behavior Annotation Project', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return { filePath: result.filePaths[0], text: await readFile(result.filePaths[0], 'utf8') }
}

async function openCsv() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'CSV進捗を読み込む',
    properties: ['openFile'],
    filters: [{ name: 'CSV Progress', extensions: ['csv'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return { filePath: result.filePaths[0], text: await readFile(result.filePaths[0], 'utf8') }
}

async function saveText(defaultName: string, text: string, filters: Electron.FileFilter[]) {
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: defaultName, filters })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, text, 'utf8')
  return result.filePath
}

function timecodeToSeconds(value: string): number {
  const match = value.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

async function transcodeVideo(filePath: string, duration: number) {
  const tempDir = join(app.getPath('temp'), 'behavior-annotation-media')
  await mkdir(tempDir, { recursive: true })
  const fileStat = await stat(filePath)
  const hash = createHash('sha1').update(`${filePath}:${fileStat.size}:${fileStat.mtimeMs}`).digest('hex').slice(0, 16)
  const outputPath = join(tempDir, `${hash}.mp4`)
  if (existsSync(outputPath)) return { ...toMediaSelection(outputPath), temporary: true }
  const executable = ffmpegPath ? ffmpegPath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`) : 'ffmpeg'
  await new Promise<void>((resolve, reject) => {
    const process = spawn(executable, [
      '-y', '-i', filePath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-movflags', '+faststart', outputPath,
    ])
    let stderr = ''
    process.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      const seconds = timecodeToSeconds(stderr.slice(-500))
      const progress = duration > 0 ? Math.min(99, Math.round(seconds / duration * 100)) : 0
      mainWindow?.webContents.send('media-transcode-progress', progress)
    })
    process.on('error', reject)
    process.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${stderr.slice(-500)}`)))
  })
  mainWindow?.webContents.send('media-transcode-progress', 100)
  return { ...toMediaSelection(outputPath), temporary: true }
}

function registerIpc(): void {
  ipcMain.handle('choose-video', chooseVideo)
  ipcMain.handle('resolve-video', (_event, filePath: string) => existsSync(filePath) ? toMediaSelection(filePath) : null)
  ipcMain.handle('open-project', openProject)
  ipcMain.handle('open-csv', openCsv)
  ipcMain.handle('save-project', (_event, name: string, text: string) => saveText(name, text, [{ name: 'JSON Project', extensions: ['json'] }]))
  ipcMain.handle('save-csv', (_event, name: string, text: string) => saveText(name, text, [{ name: 'CSV', extensions: ['csv'] }]))
  ipcMain.handle('transcode-video', (_event, filePath: string, duration: number) => transcodeVideo(filePath, duration))
  ipcMain.handle('remove-temp-media', async (_event, filePath: string) => { if (filePath.includes('behavior-annotation-media')) await unlink(filePath).catch(() => undefined) })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#e9e7df',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
