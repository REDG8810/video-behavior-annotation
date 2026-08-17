import { z } from 'zod'
import type { ProjectFile } from './types'

const eventSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  participantId: z.string(),
  categoryId: z.string(),
  tagId: z.string(),
  type: z.enum(['Point', 'State']),
  start: z.number().nonnegative(),
  stop: z.number().nullable(),
  createdAt: z.string(),
})

export const projectFileSchema = z.object({
  schemaVersion: z.literal(2),
  project: z.object({
    id: z.string(), name: z.string(), videoId: z.string(), conditionId: z.string(),
    participants: z.array(z.object({ id: z.string(), name: z.string() })),
    categories: z.array(z.object({ id: z.string(), name: z.string() })),
    tags: z.array(z.object({ id: z.string(), categoryId: z.string(), name: z.string(), type: z.enum(['Point', 'State']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6b8f52') })),
    events: z.array(eventSchema),
  }),
  video: z.object({ id: z.string(), filePath: z.string(), fileName: z.string(), duration: z.number().nonnegative(), width: z.number().nonnegative(), height: z.number().nonnegative(), fps: z.number().positive() }),
  conditions: z.array(z.object({ id: z.string(), name: z.string() })),
})

export function parseProjectFile(text: string): ProjectFile {
  return projectFileSchema.parse(JSON.parse(text)) as ProjectFile
}

export function validateProjectFile(file: ProjectFile): string[] {
  const errors: string[] = []
  const { project, video, conditions } = file
  const participantIds = new Set(project.participants.map((item) => item.id))
  const categoryIds = new Set(project.categories.map((item) => item.id))
  const tagMap = new Map(project.tags.map((item) => [item.id, item]))
  const conditionIds = new Set(conditions.map((item) => item.id))
  if (!conditionIds.has(project.conditionId)) errors.push('Conditionの参照先が存在しません')
  if (project.videoId !== video.id) errors.push('Videoの参照先が一致しません')
  for (const event of project.events) {
    const tag = tagMap.get(event.tagId)
    if (!participantIds.has(event.participantId)) errors.push(`Participantが存在しません: ${event.participantId}`)
    if (!categoryIds.has(event.categoryId)) errors.push(`Categoryが存在しません: ${event.categoryId}`)
    if (!tag) errors.push(`Tagが存在しません: ${event.tagId}`)
    if (tag && (tag.categoryId !== event.categoryId || tag.type !== event.type)) errors.push(`TagとEventの整合性がありません: ${event.id}`)
    if (event.videoId !== project.videoId) errors.push(`EventのVideo参照が不正です: ${event.id}`)
    if (event.start > video.duration) errors.push(`Eventの開始時刻が動画長を超えています: ${event.id}`)
    if (event.type === 'Point' && event.stop !== null) errors.push(`Point Eventのstopはnullである必要があります: ${event.id}`)
    if (event.type === 'State' && (event.stop === null || event.stop < event.start)) errors.push(`State Eventの時間範囲が不正です: ${event.id}`)
  }
  return errors
}
