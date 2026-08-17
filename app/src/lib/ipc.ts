import type { MediaSelection, TranscodeResult } from './domain/types'

export interface ElectronApi {
  chooseVideo: () => Promise<MediaSelection | null>
  resolveVideo: (filePath: string) => Promise<MediaSelection | null>
  openProject: () => Promise<{ filePath: string; text: string } | null>
  openCsv: () => Promise<{ filePath: string; text: string } | null>
  saveProject: (name: string, text: string) => Promise<string | null>
  saveCsv: (name: string, text: string) => Promise<string | null>
  transcodeVideo: (filePath: string, duration: number) => Promise<TranscodeResult>
  removeTempMedia: (filePath: string) => Promise<void>
  onTranscodeProgress: (listener: (progress: number) => void) => () => void
}
