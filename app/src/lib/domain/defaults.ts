import type { Category, Condition, Participant, Project, ProjectFile, Tag, Video } from './types'

export const defaultConditions: Condition[] = [
  { id: 'condition-suit', name: 'スーツ' },
  { id: 'condition-coolbiz', name: 'クールビズ' },
  { id: 'condition-casual', name: '私服' },
]

export const defaultParticipants: Participant[] = [
  { id: 'participant-a', name: 'A' },
  { id: 'participant-b', name: 'B' },
  { id: 'participant-c', name: 'C' },
]

export const defaultCategories: Category[] = [
  { id: 'category-speech', name: '発話' },
  { id: 'category-interruption', name: '割り込み' },
  { id: 'category-reaction', name: 'リアクション' },
  { id: 'category-posture', name: '姿勢' },
  { id: 'category-gesture', name: 'ジェスチャー' },
]

export const tagColorPalette = ['#3d7896', '#d66d42', '#6b8f52', '#87679f', '#c28b3c', '#a85d73', '#4d8f86', '#7a6c54', '#5774ad', '#a66b45', '#65875f', '#9a638b']

export const defaultTags: Tag[] = [
  { id: 'tag-speech', categoryId: 'category-speech', name: '発話', type: 'State', color: tagColorPalette[0] },
  { id: 'tag-interruption', categoryId: 'category-interruption', name: '割り込み', type: 'Point', color: tagColorPalette[1] },
  { id: 'tag-nod', categoryId: 'category-reaction', name: 'うなずき', type: 'Point', color: tagColorPalette[2] },
  { id: 'tag-gesture-reaction', categoryId: 'category-reaction', name: '身振り', type: 'Point', color: tagColorPalette[3] },
  { id: 'tag-backchannel', categoryId: 'category-reaction', name: '発話相槌', type: 'Point', color: tagColorPalette[4] },
  { id: 'tag-gesture', categoryId: 'category-gesture', name: 'ジェスチャー', type: 'Point', color: tagColorPalette[5] },
]

export function nextTagColor(tags: Pick<Tag, 'color'>[]): string {
  const used = new Set(tags.map((tag) => tag.color.toLowerCase()))
  return tagColorPalette.find((color) => !used.has(color.toLowerCase())) ?? tagColorPalette[tags.length % tagColorPalette.length]
}

export function createProjectFile(): ProjectFile {
  const condition = defaultConditions[0]
  return {
    schemaVersion: 2,
    project: {
      id: crypto.randomUUID(),
      name: '新規プロジェクト',
      videoId: '',
      conditionId: condition.id,
      participants: structuredClone(defaultParticipants),
      categories: structuredClone(defaultCategories),
      tags: structuredClone(defaultTags),
      events: [],
    },
    video: emptyVideo(),
    conditions: structuredClone(defaultConditions),
  }
}

export function emptyVideo(): Video {
  return { id: '', filePath: '', fileName: '', duration: 0, width: 0, height: 0, fps: 59.94 }
}
