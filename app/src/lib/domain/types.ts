export type EventType = 'Point' | 'State'

export interface Video {
  id: string
  filePath: string
  fileName: string
  duration: number
  width: number
  height: number
  fps: number
}

export interface Condition {
  id: string
  name: string
}

export interface Participant {
  id: string
  name: string
}

export interface Category {
  id: string
  name: string
}

export interface Tag {
  id: string
  categoryId: string
  name: string
  type: EventType
  color: string
}

export interface AnnotationEvent {
  id: string
  videoId: string
  participantId: string
  categoryId: string
  tagId: string
  type: EventType
  start: number
  stop: number | null
  createdAt: string
}

export interface Project {
  id: string
  name: string
  videoId: string
  conditionId: string
  participants: Participant[]
  categories: Category[]
  tags: Tag[]
  events: AnnotationEvent[]
}

export interface ProjectFile {
  schemaVersion: 2
  project: Project
  video: Video
  conditions: Condition[]
}

export interface PendingState {
  participantId: string
  tagId: string
  start: number
}

export interface MediaSelection {
  filePath: string
  fileName: string
  url: string
}

export interface TranscodeResult extends MediaSelection {
  temporary: boolean
}
