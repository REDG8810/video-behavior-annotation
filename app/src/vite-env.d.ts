/// <reference types="vite/client" />

interface Window {
  electronAPI: import('./lib/ipc').ElectronApi
}
