import { writable } from 'svelte/store'
import { createProjectFile } from './domain/defaults'
import type { AnnotationEvent, PendingState, ProjectFile, Tag, Video } from './domain/types'

const HISTORY_LIMIT = 100

export interface AppState {
  file: ProjectFile
  history: ProjectFile[]
  future: ProjectFile[]
  selectedEventId: string | null
  currentTime: number
  pendingStates: Record<string, PendingState>
  zoom: number
  autoFollow: boolean
  categoryFilter: string[]
  participantFilter: string[]
  dirty: boolean
}

export const appStore = writable<AppState>(createState(createProjectFile()))

function clone<T>(value: T): T {
  return structuredClone(value)
}

function createState(file: ProjectFile): AppState {
  return {
    file: clone(file), history: [], future: [], selectedEventId: null, currentTime: 0,
    pendingStates: {}, zoom: 1, autoFollow: true,
    categoryFilter: file.project.categories.map((item) => item.id),
    participantFilter: file.project.participants.map((item) => item.id), dirty: false,
  }
}

export function replaceFile(file: ProjectFile): void {
  appStore.set(createState(file))
}

export function updateFile(mutator: (file: ProjectFile) => ProjectFile): void {
  appStore.update((state) => ({
    ...state,
    file: mutator(clone(state.file)),
    history: [...state.history, clone(state.file)].slice(-HISTORY_LIMIT),
    future: [],
    dirty: true,
  }))
}

export function setSelectedEvent(id: string | null): void {
  appStore.update((state) => ({ ...state, selectedEventId: id }))
}

export function setCurrentTime(time: number): void {
  appStore.update((state) => ({ ...state, currentTime: Math.max(0, time) }))
}

export function setVideo(video: Video): void {
  updateFile((file) => ({
    ...file,
    video,
    project: {
      ...file.project,
      videoId: video.id,
      events: file.project.events.map((event) => ({ ...event, videoId: video.id })),
    },
  }))
}

export function setPendingState(key: string, pending: PendingState | null): void {
  appStore.update((state) => {
    const pendingStates = { ...state.pendingStates }
    if (pending) pendingStates[key] = pending
    else delete pendingStates[key]
    return { ...state, pendingStates }
  })
}

export function eventKey(participantId: string, tagId: string): string {
  return `${participantId}:${tagId}`
}

export function recordTag(participantId: string, tag: Tag, currentTime: number): 'started' | 'created' | 'invalid' {
  let result: 'started' | 'created' | 'invalid' = 'invalid'
  appStore.update((state) => {
    const key = eventKey(participantId, tag.id)
    const pending = state.pendingStates[key]
    if (tag.type === 'State' && !pending) {
      result = 'started'
      return { ...state, pendingStates: { ...state.pendingStates, [key]: { participantId, tagId: tag.id, start: currentTime } } }
    }
    if (tag.type === 'State' && pending && currentTime <= pending.start) return state
    const event: AnnotationEvent = {
      id: crypto.randomUUID(), videoId: state.file.project.videoId, participantId,
      categoryId: tag.categoryId, tagId: tag.id, type: tag.type,
      start: tag.type === 'State' ? pending!.start : currentTime,
      stop: tag.type === 'State' ? currentTime : null,
      createdAt: new Date().toISOString(),
    }
    const pendingStates = { ...state.pendingStates }
    delete pendingStates[key]
    result = 'created'
    return {
      ...state,
      file: { ...state.file, project: { ...state.file.project, events: [...state.file.project.events, event] } },
      history: [...state.history, clone(state.file)].slice(-HISTORY_LIMIT), future: [], pendingStates, selectedEventId: event.id, dirty: true,
    }
  })
  return result
}

export function undo(): void {
  appStore.update((state) => {
    const previous = state.history.at(-1)
    if (!previous) return state
    return { ...state, file: previous, history: state.history.slice(0, -1), future: [clone(state.file), ...state.future].slice(0, HISTORY_LIMIT), dirty: true }
  })
}

export function redo(): void {
  appStore.update((state) => {
    const next = state.future[0]
    if (!next) return state
    return { ...state, file: next, history: [...state.history, clone(state.file)].slice(-HISTORY_LIMIT), future: state.future.slice(1), dirty: true }
  })
}

export function setSaved(): void {
  appStore.update((state) => ({ ...state, dirty: false }))
}
