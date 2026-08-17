import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  chooseVideo: () => ipcRenderer.invoke('choose-video'),
  resolveVideo: (filePath: string) => ipcRenderer.invoke('resolve-video', filePath),
  openProject: () => ipcRenderer.invoke('open-project'),
  openCsv: () => ipcRenderer.invoke('open-csv'),
  saveProject: (name: string, text: string) => ipcRenderer.invoke('save-project', name, text),
  saveCsv: (name: string, text: string) => ipcRenderer.invoke('save-csv', name, text),
  transcodeVideo: (filePath: string, duration: number) => ipcRenderer.invoke('transcode-video', filePath, duration),
  removeTempMedia: (filePath: string) => ipcRenderer.invoke('remove-temp-media', filePath),
  onTranscodeProgress: (listener: (progress: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: number) => listener(progress)
    ipcRenderer.on('media-transcode-progress', handler)
    return () => ipcRenderer.removeListener('media-transcode-progress', handler)
  },
})
