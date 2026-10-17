import type { SupabaseClient } from '@supabase/supabase-js'

export type Category = {
  id: string
  name: string
}

export type Topic = {
  id: string
  category_id: string
  name: string
}

export type Subtopic = {
  id: string
  category_id: string
  topic_id: string
  name: string
}

export type NoteFile = {
  id: string
  category_id: string
  topic_id: string
  subtopic_id: string
  name: string
  created_at: string
  updated_at: string
}

export type WorkspaceData = {
  categories: Category[]
  topics: Topic[]
  subtopics: Subtopic[]
  files: NoteFile[]
}

export type TaxonomyTable = 'categories' | 'topics' | 'subtopics'
export type TaxonomyRecord = Category | Topic | Subtopic

export type TaxonomyQueryPath = {
  categoryId: string
  topicId: string
  subtopicId: string
}

export type TaxonomySelection = {
  categoryId: string
  topicId: string
  subtopicId: string
}

export function topicsForCategory(
  data: Pick<WorkspaceData, 'topics'>,
  categoryId: string,
): Topic[] {
  return data.topics.filter((topic) => topic.category_id === categoryId)
}

export function subtopicsForTopic(
  data: Pick<WorkspaceData, 'subtopics'>,
  categoryId: string,
  topicId: string,
): Subtopic[] {
  return data.subtopics.filter(
    (subtopic) =>
      subtopic.category_id === categoryId && subtopic.topic_id === topicId,
  )
}

export function selectCategory(
  data: Pick<WorkspaceData, 'topics' | 'subtopics'>,
  selection: TaxonomySelection,
  categoryId: string,
): TaxonomySelection {
  const topicId = topicsForCategory(data, categoryId).some(
    (topic) => topic.id === selection.topicId,
  )
    ? selection.topicId
    : ''
  const subtopicId = subtopicsForTopic(data, categoryId, topicId).some(
    (subtopic) => subtopic.id === selection.subtopicId,
  )
    ? selection.subtopicId
    : ''
  return { categoryId, topicId, subtopicId }
}

export function selectTopic(
  data: Pick<WorkspaceData, 'subtopics'>,
  selection: TaxonomySelection,
  topicId: string,
): TaxonomySelection {
  const subtopicId = subtopicsForTopic(
    data,
    selection.categoryId,
    topicId,
  ).some((subtopic) => subtopic.id === selection.subtopicId)
    ? selection.subtopicId
    : ''
  return { ...selection, topicId, subtopicId }
}

export function filesForSubtopic(
  data: Pick<WorkspaceData, 'files'>,
  categoryId: string,
  topicId: string,
  subtopicId: string,
): NoteFile[] {
  return data.files.filter(
    (file) =>
      file.category_id === categoryId &&
      file.topic_id === topicId &&
      file.subtopic_id === subtopicId,
  )
}

export function normalizeTaxonomySelection(
  data: Pick<WorkspaceData, 'categories' | 'topics' | 'subtopics'>,
  selection: TaxonomySelection,
): TaxonomySelection {
  const categoryExists = data.categories.some(
    (category) => category.id === selection.categoryId,
  )
  if (!categoryExists) {
    return { categoryId: '', topicId: '', subtopicId: '' }
  }

  const topicExists = data.topics.some(
    (topic) =>
      topic.id === selection.topicId &&
      topic.category_id === selection.categoryId,
  )
  if (!topicExists) {
    return { ...selection, topicId: '', subtopicId: '' }
  }

  const subtopicExists = data.subtopics.some(
    (subtopic) =>
      subtopic.id === selection.subtopicId &&
      subtopic.category_id === selection.categoryId &&
      subtopic.topic_id === selection.topicId,
  )
  return subtopicExists
    ? selection
    : { ...selection, subtopicId: '' }
}

export function validateCreateFileInput(
  name: string,
  selection: TaxonomySelection,
  data: Pick<WorkspaceData, 'categories' | 'topics' | 'subtopics'>,
): string | null {
  return (
    validateFileName(name) ??
    (!isValidTaxonomyPath(
      {
        category_id: selection.categoryId,
        topic_id: selection.topicId,
        subtopic_id: selection.subtopicId,
      },
      data,
    )
      ? 'Select a valid Category, Topic, and Subtopic.'
      : null)
  )
}

export function notesRouteForSelection(
  selection: TaxonomySelection,
): string {
  const params = new URLSearchParams({
    categoryId: selection.categoryId,
    topicId: selection.topicId,
    subtopicId: selection.subtopicId,
  })
  return `/notes?${params.toString()}`
}

export function noteRouteForSelection(
  noteId: string,
  selection: TaxonomySelection,
): string {
  const params = new URLSearchParams({
    noteId,
    categoryId: selection.categoryId,
    topicId: selection.topicId,
    subtopicId: selection.subtopicId,
  })
  return `/note?${params.toString()}`
}

export function fileRouteForFile(file: NoteFile): string {
  const params = new URLSearchParams({
    fileId: file.id,
    categoryId: file.category_id,
    topicId: file.topic_id,
    subtopicId: file.subtopic_id,
  })
  return `/file?${params.toString()}`
}

export function createFileRouteForSelection(
  selection: TaxonomySelection,
): string {
  const params = new URLSearchParams({
    categoryId: selection.categoryId,
    topicId: selection.topicId,
    subtopicId: selection.subtopicId,
  })
  return `/create-file?${params.toString()}`
}

export function inlineRenameActionForKey(
  key: string,
): 'save' | 'cancel' | null {
  if (key === 'Enter') return 'save'
  if (key === 'Escape') return 'cancel'
  return null
}

export function isDoubleActivation(
  previousAt: number,
  currentAt: number,
  windowMs = 350,
): boolean {
  return previousAt > 0 && currentAt - previousAt >= 0 && currentAt - previousAt < windowMs
}

export function taxonomyDeleteWarning(table: TaxonomyTable): string {
  if (table === 'categories') {
    return 'Confirming deletes this Category and cascades to its Topics and Subtopics. The database rejects the entire deletion if any descendant Subtopic still has a File. Files and their notes are never cascade-deleted.'
  }
  if (table === 'topics') {
    return 'Confirming deletes this Topic and cascades to its Subtopics. The database rejects the entire deletion if any descendant Subtopic still has a File. Files and their notes are never cascade-deleted.'
  }
  return 'Only this Subtopic is removed. The database rejects deletion if it still has a File. Files and their notes are never cascade-deleted.'
}

export function parseTaxonomyQuery(search: string): TaxonomyQueryPath | null {
  const params = new URLSearchParams(search)
  const categoryId = params.get('categoryId') ?? ''
  const topicId = params.get('topicId') ?? ''
  const subtopicId = params.get('subtopicId') ?? ''
  const isUuid = (value: string) =>
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)

  if (!isUuid(categoryId) || !isUuid(topicId) || !isUuid(subtopicId)) {
    return null
  }
  return { categoryId, topicId, subtopicId }
}

export function validateFileName(value: string): string | null {
  const name = value.trim()
  if (!name) {
    return 'Enter a file name.'
  }
  if (name.length > 120) {
    return 'File names must be 120 characters or fewer.'
  }
  return null
}

export function validateTaxonomyName(value: string): string | null {
  const name = value.trim()
  if (!name) return 'Enter a name.'
  if (name.length > 120) {
    return 'Names must be 120 characters or fewer.'
  }
  return null
}

export async function createTaxonomyRecord(
  client: SupabaseClient,
  table: TaxonomyTable,
  name: string,
  selection: TaxonomySelection,
): Promise<TaxonomyRecord> {
  const validationError = validateTaxonomyName(name)
  if (validationError) throw new Error(validationError)
  if (table !== 'categories' && !selection.categoryId) {
    throw new Error('Select a Category before creating a child item.')
  }
  if (table === 'subtopics' && !selection.topicId) {
    throw new Error('Select a Topic before creating a Subtopic.')
  }

  try {
    if (table === 'categories') {
      const { data, error } = await client
        .from('categories')
        .insert({ name: name.trim() })
        .select('id,name')
        .single()
      throwOnError(error)
      if (!data || typeof data.id !== 'string' || data.name !== name.trim()) {
        throw new Error('The new item could not be verified. Refresh and retry.')
      }
      return data
    }

    if (table === 'topics') {
      const { data, error } = await client
        .from('topics')
        .insert({ name: name.trim(), category_id: selection.categoryId })
        .select('id,category_id,name')
        .single()
      throwOnError(error)
      if (
        !data ||
        typeof data.id !== 'string' ||
        data.name !== name.trim() ||
        data.category_id !== selection.categoryId
      ) {
        throw new Error('The new item could not be verified. Refresh and retry.')
      }
      return data
    }

    const { data, error } = await client
      .from('subtopics')
      .insert({
        name: name.trim(),
        category_id: selection.categoryId,
        topic_id: selection.topicId,
      })
      .select('id,category_id,topic_id,name')
      .single()
    throwOnError(error)
    if (
      !data ||
      typeof data.id !== 'string' ||
      data.name !== name.trim() ||
      data.category_id !== selection.categoryId ||
      data.topic_id !== selection.topicId
    ) {
      throw new Error('The new item could not be verified. Refresh and retry.')
    }
    return data
  } catch (error) {
    if (isSafeDataError(error)) throw error
    throw toSafeDataError(error)
  }
}

export function addTaxonomyRecordToWorkspace(
  data: WorkspaceData,
  table: TaxonomyTable,
  record: TaxonomyRecord,
): WorkspaceData {
  const withRecord = <T extends { id: string; name: string }>(
    records: T[],
    item: T,
  ) =>
    [...records.filter((existing) => existing.id !== item.id), item].sort(
      (left, right) => left.name.localeCompare(right.name),
    )

  if (table === 'categories') {
    if ('category_id' in record) {
      throw new Error('The created Category response was invalid.')
    }
    return { ...data, categories: withRecord(data.categories, record) }
  }
  if (table === 'topics') {
    if (!('category_id' in record) || 'topic_id' in record) {
      throw new Error('The created Topic response was invalid.')
    }
    return { ...data, topics: withRecord(data.topics, record) }
  }
  if (!('category_id' in record) || !('topic_id' in record)) {
    throw new Error('The created Subtopic response was invalid.')
  }
  return { ...data, subtopics: withRecord(data.subtopics, record) }
}

export function isValidTaxonomyPath(
  path: Pick<NoteFile, 'category_id' | 'topic_id' | 'subtopic_id'>,
  data: Pick<WorkspaceData, 'categories' | 'topics' | 'subtopics'>,
): boolean {
  const categoryExists = data.categories.some(
    (category) => category.id === path.category_id,
  )
  const topicExists = data.topics.some(
    (topic) =>
      topic.id === path.topic_id && topic.category_id === path.category_id,
  )
  const subtopicExists = data.subtopics.some(
    (subtopic) =>
      subtopic.id === path.subtopic_id &&
      subtopic.topic_id === path.topic_id &&
      subtopic.category_id === path.category_id,
  )

  return categoryExists && topicExists && subtopicExists
}

function errorField(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null && field in error
    ? error[field as keyof typeof error]
    : undefined
}

export function toSafeDataError(error: unknown): Error {
  const code = errorField(error, 'code')
  const status = errorField(error, 'status')
  const name = errorField(error, 'name')
  const message = errorField(error, 'message')

  if (code === '42P01') {
    return new Error(
      'A required workspace table was not found in the connected database. Verify the Supabase project/schema and whether Phase 1 migration 20261016133000 was applied; this error alone does not prove which is wrong.',
    )
  }
  if (code === 'PGRST205') {
    return new Error(
      'The Supabase API schema cache cannot find a required workspace table. Verify the connected project/schema and Phase 1 migration 20261016133000; if the table exists, an authorized operator should refresh the API schema cache.',
    )
  }
  if (code === 'PGRST204' || code === 'PGRST200' || code === '42703') {
    return new Error(
      'The workspace database schema does not match what this app expects. An authorized operator should compare the table columns and relationships with the reviewed migrations.',
    )
  }
  if (code === 'PGRST301' || code === 'PGRST302' || status === 401) {
    return new Error(
      'Your Supabase session is missing or expired. Sign in again, then retry loading the workspace.',
    )
  }
  if (code === '42501' || status === 403) {
    return new Error(
      'The signed-in account does not have permission to read the workspace. An authorized operator should verify authenticated grants and owner-scoped RLS policies.',
    )
  }
  if (
    name === 'TypeError' ||
    name === 'AbortError' ||
    name === 'FetchError' ||
    status === 0 ||
    (typeof message === 'string' &&
      /typeerror|fetch failed|network request failed|failed to fetch|load failed|aborted|timed out/i.test(
        message,
      ))
  ) {
    return new Error(
      'Could not reach the Supabase service. Check the connection and configured project URL, then retry.',
    )
  }
  if (code === '23503') {
    return new Error(
      'This item has child records or is referenced by files. Files and their notes are preserved; remove or move those references before deleting this item.',
    )
  }
  return new Error(
    'The workspace request failed because of a database or service error. Retry, and ask an authorized operator to review the project schema and service status if it continues.',
  )
}

function ensureRecordWasAffected(data: unknown): void {
  if (!data) {
    throw new Error(
      'This record is no longer available. Refresh the workspace and try again.',
    )
  }
}

function throwOnError(error: unknown): void {
  if (error) {
    throw toSafeDataError(error)
  }
}

function isSafeDataError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    [
      'Workspace tables are not available',
      'A required workspace table was not found',
      'The Supabase API schema cache',
      'The workspace database schema',
      'Your Supabase session is missing',
      'The signed-in account does not have permission',
      'Could not reach the Supabase service',
      'The workspace request failed',
      'This item has child records',
      'This Category has Files in one or more descendant Subtopics',
      'This Topic has Files in one or more descendant Subtopics',
      'This Subtopic still has a File',
      'Your session does not have permission',
      'The request could not be completed',
      'Could not reach the authentication service',
      'This record is no longer available',
      'The new item could not be verified',
      'The created Category response was invalid',
      'The created Topic response was invalid',
      'The created Subtopic response was invalid',
    ].some((prefix) => error.message.startsWith(prefix))
  )
}

export function getAuthErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.toLowerCase() === 'invalid login credentials'
  ) {
    return 'Email or password is incorrect. If you have not set a password or do not remember it, use Forgot password.'
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'invalid_credentials') {
      return 'Email or password is incorrect. If you have not set a password or do not remember it, use Forgot password.'
    }
    if (error.code === 'email_not_confirmed') {
      return 'Confirm your email using the link we sent, then sign in.'
    }
    if (error.code === 'user_already_exists') {
      return 'An account already exists for this email. Try signing in.'
    }
    if (error.code === 'weak_password') {
      return 'Choose a stronger password that meets the project password requirements.'
    }
    if (
      error.code === 'over_email_send_rate_limit' ||
      error.code === 'email_rate_limit_exceeded' ||
      error.code === 'over_request_rate_limit' ||
      error.code === 'too_many_requests'
    ) {
      return 'Too many authentication requests. Wait a little while, then try again.'
    }
    if (error.code === 'signup_disabled') {
      return 'New account registration is currently unavailable.'
    }
  }
  if (typeof error === 'object' && error !== null) {
    const name = 'name' in error ? error.name : undefined
    const status = 'status' in error ? error.status : undefined
    if (status === 429) {
      return 'Too many authentication requests. Wait a little while, then try again.'
    }
    if (
      name === 'AuthRetryableFetchError' ||
      name === 'TypeError' ||
      (typeof status === 'number' && status >= 500)
    ) {
      return 'Could not reach the authentication service. Check your connection and try again.'
    }
  }
  return 'Authentication could not be completed. Check your details and try again.'
}

export async function loadWorkspaceData(
  client: SupabaseClient,
): Promise<WorkspaceData> {
  try {
    const [categories, topics, subtopics, files] = await Promise.all([
      client.from('categories').select('id,name').order('name'),
      client.from('topics').select('id,category_id,name').order('name'),
      client
        .from('subtopics')
        .select('id,category_id,topic_id,name')
        .order('name'),
      client
        .from('files')
        .select(
          'id,category_id,topic_id,subtopic_id,name,created_at,updated_at',
        )
        .order('name'),
    ])

    throwOnError(categories.error)
    throwOnError(topics.error)
    throwOnError(subtopics.error)
    throwOnError(files.error)

    return {
      categories: categories.data ?? [],
      topics: topics.data ?? [],
      subtopics: subtopics.data ?? [],
      files: files.data ?? [],
    }
  } catch (error) {
    if (isSafeDataError(error)) throw error
    throw toSafeDataError(error)
  }
}

export async function createFile(
  client: SupabaseClient,
  name: string,
  path: Pick<NoteFile, 'category_id' | 'topic_id' | 'subtopic_id'>,
): Promise<NoteFile> {
  const validationError = validateFileName(name)
  if (validationError) {
    throw new Error(validationError)
  }

  try {
    const { data, error } = await client
      .from('files')
      .insert({
        name: name.trim(),
        category_id: path.category_id,
        topic_id: path.topic_id,
        subtopic_id: path.subtopic_id,
      })
      .select('*')
      .single()
    throwOnError(error)
    if (
      !data ||
      data.name !== name.trim() ||
      data.category_id !== path.category_id ||
      data.topic_id !== path.topic_id ||
      data.subtopic_id !== path.subtopic_id
    ) {
      throw new Error('The created file could not be verified. Refresh and retry.')
    }
    return data
  } catch (error) {
    if (isSafeDataError(error)) {
      throw error
    }
    throw toSafeDataError(error)
  }
}

export async function renameTaxonomyRecord(
  client: SupabaseClient,
  table: TaxonomyTable,
  id: string,
  name: string,
): Promise<void> {
  const validationError = validateTaxonomyName(name)
  if (validationError) throw new Error(validationError)

  try {
    const { data, error } = await client
      .from(table)
      .update({ name: name.trim() })
      .eq('id', id)
      .select('id')
      .maybeSingle()
    throwOnError(error)
    ensureRecordWasAffected(data)
  } catch (error) {
    if (
      isSafeDataError(error) ||
      (error instanceof Error &&
        /^(Enter a name|Names must be)/.test(error.message))
    ) {
      throw error
    }
    throw toSafeDataError(error)
  }
}

export async function renameFile(
  client: SupabaseClient,
  id: string,
  name: string,
): Promise<void> {
  const validationError = validateFileName(name)
  if (validationError) {
    throw new Error(validationError)
  }

  const { data, error } = await client
    .from('files')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  throwOnError(error)
  ensureRecordWasAffected(data)
}

export async function deleteFile(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { data, error } = await client
    .from('files')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()
  throwOnError(error)
  ensureRecordWasAffected(data)
}

export async function deleteTaxonomyRecord(
  client: SupabaseClient,
  table: TaxonomyTable,
  id: string,
): Promise<void> {
  try {
    const { data, error } = await client
      .from(table)
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error && errorField(error, 'code') === '23503') {
      const blocker =
        table === 'categories'
          ? 'This Category has Files in one or more descendant Subtopics. The Category, Topics, and Subtopics were not deleted. Remove notes from those Files, delete the Files, then retry. No records were partially deleted.'
          : table === 'topics'
            ? 'This Topic has Files in one or more descendant Subtopics. The Topic and Subtopics were not deleted. Remove notes from those Files, delete the Files, then retry. No records were partially deleted.'
            : 'This Subtopic still has a File. Remove its notes, delete the File, then retry. The Subtopic was not deleted.'
      throw new Error(blocker)
    }
    throwOnError(error)
    ensureRecordWasAffected(data)
  } catch (error) {
    if (isSafeDataError(error)) throw error
    throw toSafeDataError(error)
  }
}
