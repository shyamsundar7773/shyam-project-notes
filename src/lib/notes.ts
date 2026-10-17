import type { SupabaseClient } from '@supabase/supabase-js'
import { createFile, type NoteFile } from './phase1'

export type NoteType = 'text' | 'sql' | 'markdown'
export type NoteColor = 'lavender' | 'mint' | 'peach' | 'blue' | 'yellow'

export type Note = {
  id: string
  owner_id: string
  file_id: string
  note_type: NoteType
  title: string
  source_content: string
  sql_output: string | null
  sql_evaluation: string | null
  sql_evaluated_source: string | null
  markdown_output: string | null
  markdown_converted_source: string | null
  personal_notes: string
  note_color: NoteColor
  is_pinned: boolean
  created_at: string
  updated_at: string
}

export type EditableNote = Pick<
  Note,
  | 'title'
  | 'source_content'
  | 'sql_output'
  | 'sql_evaluation'
  | 'sql_evaluated_source'
  | 'markdown_output'
  | 'markdown_converted_source'
  | 'personal_notes'
  | 'note_color'
  | 'is_pinned'
>

export type NotePatch = Partial<EditableNote>

const noteCreateFlights = new Map<string, Promise<{ note: Note; file: NoteFile }>>()
const noteColors: NoteColor[] = ['lavender', 'mint', 'peach', 'blue', 'yellow']

export function noteColorForId(id: string): NoteColor {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return noteColors[hash % noteColors.length]
}

export async function createNoteForSubtopic(
  client: SupabaseClient,
  ownerId: string,
  path: Pick<NoteFile, 'category_id' | 'topic_id' | 'subtopic_id'>,
  preferredFileId = '',
): Promise<{ note: Note; file: NoteFile }> {
  const flightKey = `${ownerId}:${path.subtopic_id}:${preferredFileId}`
  const pending = noteCreateFlights.get(flightKey)
  if (pending) return pending

  const flight = (async () => {
    const { data, error } = await client
      .from('files')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('category_id', path.category_id)
      .eq('topic_id', path.topic_id)
      .eq('subtopic_id', path.subtopic_id)
      .order('created_at', { ascending: true })
    if (error) throw safeDatabaseError(error)
    const currentFiles = (data ?? []) as NoteFile[]
    const matchingFiles = currentFiles.filter(
      (file) =>
        file.category_id === path.category_id &&
        file.topic_id === path.topic_id &&
        file.subtopic_id === path.subtopic_id,
    )
    const file =
      matchingFiles.find((item) => item.id === preferredFileId) ??
      matchingFiles.slice().sort((left, right) => left.id.localeCompare(right.id))[0] ??
      (await createFile(client, 'Notes', path))
    const note = await createNote(client, file.id, ownerId, 'text')
    return { note, file }
  })()
  noteCreateFlights.set(flightKey, flight)
  try {
    return await flight
  } finally {
    if (noteCreateFlights.get(flightKey) === flight) {
      noteCreateFlights.delete(flightKey)
    }
  }
}

export function appendSqlPracticeToNote(
  existingContent: string,
  practice: {
    question: string
    sql: string
    output: string
    evaluation: string
  },
): string {
  const block = [
    '<!-- SQL-PRACTICE:START -->',
    'SQL practice',
    `Question: ${practice.question}`,
    `SQL:\n${practice.sql}`,
    `Output:\n${practice.output}`,
    `Evaluation:\n${practice.evaluation}`,
    '<!-- SQL-PRACTICE:END -->',
  ].join('\n\n')
  const previousContent = existingContent.trimEnd()
  return previousContent ? `${previousContent}\n\n${block}` : block
}

export function removeMarkedSqlPracticeFromNote(
  content: string,
  legacyPractice?: {
    sql: string | null
    output: string | null
    evaluation: string | null
  },
): string {
  const marker = '<!-- SQL-PRACTICE:START -->'
  const hasMarkedPractice = content.includes(marker)
  let result = hasMarkedPractice
    ? content.replace(
        /<!-- SQL-PRACTICE:START -->[\s\S]*?<!-- SQL-PRACTICE:END -->/g,
        '',
      )
    : content
  const { sql, output, evaluation } = legacyPractice ?? {
    sql: null,
    output: null,
    evaluation: null,
  }
  if (sql && output && evaluation) {
    const formattedOutput = (() => {
      try {
        return JSON.stringify(JSON.parse(output), null, 2)
      } catch {
        return output
      }
    })()
    const escapeRegExp = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const legacyBlock = new RegExp(
      `(?:^|\\n\\n)SQL practice\\n\\nQuestion: [^\\n]*\\n\\nSQL:\\n${escapeRegExp(sql)}\\n\\nOutput:\\n${escapeRegExp(formattedOutput)}\\n\\nEvaluation:\\n${escapeRegExp(evaluation)}(?=\\n\\n|$)`,
    )
    result = result.replace(legacyBlock, '')
  }
  if (result === content) return content
  result = result.replace(/\n{4,}/g, '\n\n')
  if (content.startsWith(marker) || content.startsWith('SQL practice\n\nQuestion:')) {
    result = result.replace(/^\n{2,}/, '')
  }
  if (
    content.endsWith('<!-- SQL-PRACTICE:END -->') ||
    (sql && content.includes(`\n\nSQL:\n${sql}`))
  ) {
    result = result.replace(/\n{2,}$/, '')
  }
  return result
}

export function notesForFile(
  notes: Note[],
  fileId: string | null,
): Note[] {
  return fileId ? notes.filter((note) => note.file_id === fileId) : []
}

export class NoteSaveConflictError extends Error {
  constructor() {
    super('This note changed elsewhere. Reload it before saving your edits.')
    this.name = 'NoteSaveConflictError'
  }
}

function safeDatabaseError(error: unknown): Error {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return new Error(
        'Notes are not available yet. The Phase 1 and Phase 2 migrations must be reviewed and applied by an authorized operator.',
      )
    }
    if (error.code === '23503') {
      return new Error(
        'The parent file is unavailable. Refresh the workspace and try again.',
      )
    }
    if (error.code === '42501' || error.code === 'PGRST301') {
      return new Error('Your session expired or cannot access this note. Sign in again.')
    }
  }
  return new Error(
    'The note could not be saved. Check your connection and retry.',
  )
}

export async function listNotes(
  client: SupabaseClient,
  fileId: string,
): Promise<Note[]> {
  const { data, error } = await client
    .from('notes')
    .select('*')
    .eq('file_id', fileId)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error) {
    throw safeDatabaseError(error)
  }
  return data ?? []
}

export async function listNotesForFiles(
  client: SupabaseClient,
  fileIds: string[],
  ownerId: string,
): Promise<Note[]> {
  if (fileIds.length === 0) return []
  const { data, error } = await client
    .from('notes')
    .select('*')
    .eq('owner_id', ownerId)
    .in('file_id', fileIds)
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error) throw safeDatabaseError(error)
  return (data ?? []).filter(
    (note) => note.owner_id === ownerId && fileIds.includes(note.file_id),
  )
}

export async function getNote(
  client: SupabaseClient,
  noteId: string,
  ownerId: string,
): Promise<Note> {
  const { data, error } = await client
    .from('notes')
    .select('*')
    .eq('id', noteId)
    .eq('owner_id', ownerId)
    .maybeSingle()
  if (error) throw safeDatabaseError(error)
  if (!data || data.owner_id !== ownerId) {
    throw new Error('This note is no longer available in your account.')
  }
  return data
}

export async function createNote(
  client: SupabaseClient,
  fileId: string,
  ownerId: string,
  noteType: NoteType,
): Promise<Note> {
  const initialTitle =
    noteType === 'sql'
      ? 'SQL working note'
      : noteType === 'markdown'
        ? 'Markdown note'
        : 'Untitled note'
  const { data, error } = await client
    .from('notes')
    .insert({
      file_id: fileId,
      note_type: noteType,
      title: initialTitle,
      source_content: '',
    })
    .select('*')
    .single()
  if (error) {
    throw safeDatabaseError(error)
  }
  if (!data || data.owner_id !== ownerId || data.file_id !== fileId) {
    throw new Error('The created note could not be verified. Refresh the file.')
  }
  return data
}

export async function copyNote(
  client: SupabaseClient,
  source: Note,
  ownerId: string,
): Promise<Note> {
  return copyNoteToFile(client, source, source.file_id, ownerId)
}

export async function copyNoteToFile(
  client: SupabaseClient,
  source: Note,
  destinationFileId: string,
  ownerId: string,
): Promise<Note> {
  if (source.owner_id !== ownerId || !destinationFileId) {
    throw new Error('Choose a valid note and destination in your account.')
  }
  const { data: existing, error: listError } = await client
    .from('notes')
    .select('title')
    .eq('owner_id', ownerId)
    .eq('file_id', destinationFileId)
  if (listError) throw safeDatabaseError(listError)
  const title = uniqueCopyTitle(
    source.title,
    new Set((existing ?? []).map((note) => note.title)),
  )
  const { data, error } = await client
    .from('notes')
    .insert({
      file_id: destinationFileId,
      note_type: source.note_type,
      title,
      source_content: source.source_content,
      sql_output: source.sql_output,
      sql_evaluation: source.sql_evaluation,
      sql_evaluated_source: source.sql_evaluated_source,
      markdown_output: source.markdown_output,
      markdown_converted_source: source.markdown_converted_source,
      personal_notes: source.personal_notes,
      note_color: source.note_color,
      is_pinned: source.is_pinned,
    })
    .select('*')
    .single()
  if (error) {
    throw safeDatabaseError(error)
  }
  if (
    !data ||
    data.id === source.id ||
    data.owner_id !== ownerId ||
    data.file_id !== destinationFileId
  ) {
    throw new Error('The copy could not be verified. Refresh the file.')
  }
  return data
}

export async function saveNote(
  client: SupabaseClient,
  noteId: string,
  expectedUpdatedAt: string,
  patch: NotePatch,
  ownerId?: string,
): Promise<Note> {
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) throw new Error('Enter a note title before saving.')
    if (title.length > 200) {
      throw new Error('Note titles must be 200 characters or fewer.')
    }
    patch = { ...patch, title }
  }
  let query = client
    .from('notes')
    .update(patch)
    .eq('id', noteId)
    .eq('updated_at', expectedUpdatedAt)
  if (ownerId) query = query.eq('owner_id', ownerId)
  const { data, error } = await query
    .select('*')
    .maybeSingle()
  if (error) {
    throw safeDatabaseError(error)
  }
  if (!data) {
    throw new NoteSaveConflictError()
  }
  if (data.id !== noteId || (ownerId && data.owner_id !== ownerId)) {
    throw new Error('The saved note could not be verified. Refresh and retry.')
  }
  return data
}

export async function deleteNote(
  client: SupabaseClient,
  noteId: string,
  ownerId?: string,
): Promise<void> {
  let query = client
    .from('notes')
    .delete()
    .eq('id', noteId)
  if (ownerId) query = query.eq('owner_id', ownerId)
  const { data, error } = await query
    .select('id')
    .maybeSingle()
  if (error) {
    throw safeDatabaseError(error)
  }
  if (!data) {
    throw new Error('This note is no longer available. Refresh the file.')
  }
}

const DRAFT_PREFIX = 'shyam-notes-draft:'

export function getDraftStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export type CachedDraft = {
  baseUpdatedAt: string
  value: EditableNote
}

export function serializeCachedDraft(draft: CachedDraft): string {
  return JSON.stringify(draft)
}

export function parseCachedDraft(stored: string | null): CachedDraft | null {
  if (!stored) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('baseUpdatedAt' in parsed) ||
      typeof parsed.baseUpdatedAt !== 'string' ||
      !('value' in parsed) ||
      typeof parsed.value !== 'object' ||
      parsed.value === null
    ) return null
    const value = parsed.value
    const isNullableString = (item: unknown): item is string | null =>
      item === null || typeof item === 'string'
    const isColor = (item: unknown): item is NoteColor =>
      item === 'lavender' || item === 'mint' || item === 'peach' ||
      item === 'blue' || item === 'yellow'
    if (
      !('title' in value) || typeof value.title !== 'string' ||
      !('source_content' in value) || typeof value.source_content !== 'string' ||
      !('personal_notes' in value) || typeof value.personal_notes !== 'string' ||
      !('note_color' in value) || !isColor(value.note_color) ||
      !('is_pinned' in value) || typeof value.is_pinned !== 'boolean' ||
      !('sql_output' in value) || !isNullableString(value.sql_output) ||
      !('sql_evaluation' in value) || !isNullableString(value.sql_evaluation) ||
      !('sql_evaluated_source' in value) || !isNullableString(value.sql_evaluated_source) ||
      !('markdown_output' in value) || !isNullableString(value.markdown_output) ||
      !('markdown_converted_source' in value) ||
      !isNullableString(value.markdown_converted_source)
    ) return null
    return {
      baseUpdatedAt: parsed.baseUpdatedAt,
      value: {
        title: value.title,
        source_content: value.source_content,
        sql_output: value.sql_output,
        sql_evaluation: value.sql_evaluation,
        sql_evaluated_source: value.sql_evaluated_source,
        markdown_output: value.markdown_output,
        markdown_converted_source: value.markdown_converted_source,
        personal_notes: value.personal_notes,
        note_color: value.note_color,
        is_pinned: value.is_pinned,
      },
    }
  } catch {
    return null
  }
}

export function draftStorageKey(userId: string, noteId: string): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(noteId)}`
}

export function readCachedDraft(
  storage: Pick<Storage, 'getItem'> | null,
  userId: string,
  noteId: string,
): CachedDraft | null {
  try {
    return parseCachedDraft(
      storage?.getItem(draftStorageKey(userId, noteId)) ?? null,
    )
  } catch {
    return null
  }
}

export function writeCachedDraft(
  storage: Pick<Storage, 'setItem'> | null,
  userId: string,
  noteId: string,
  draft: CachedDraft,
): void {
  try {
    storage?.setItem(
      draftStorageKey(userId, noteId),
      serializeCachedDraft(draft),
    )
  } catch {
    // Keep the in-memory draft; storage may be unavailable or full.
  }
}

export function removeCachedDraft(
  storage: Pick<Storage, 'removeItem'> | null,
  userId: string,
  noteId: string,
): void {
  try {
    storage?.removeItem(draftStorageKey(userId, noteId))
  } catch {
    // Cloud persistence is independent of recovery-cache cleanup.
  }
}

export function editableFields(note: Note): EditableNote {
  return {
    title: note.title,
    source_content: note.source_content,
    sql_output: note.sql_output,
    sql_evaluation: note.sql_evaluation,
    sql_evaluated_source: note.sql_evaluated_source,
    markdown_output: note.markdown_output,
    markdown_converted_source: note.markdown_converted_source,
    personal_notes: note.personal_notes,
    note_color: note.note_color,
    is_pinned: note.is_pinned,
  }
}

export function makeCopyTitle(title: string): string {
  return `${title} (Copy)`.slice(0, 200)
}

export function uniqueCopyTitle(title: string, existingTitles: Set<string>): string {
  const base = title.trim().slice(0, 190)
  let suffix = 1
  let candidate = makeCopyTitle(base)
  while (existingTitles.has(candidate)) {
    suffix += 1
    candidate = `${base} (Copy ${suffix})`.slice(0, 200)
  }
  return candidate
}
