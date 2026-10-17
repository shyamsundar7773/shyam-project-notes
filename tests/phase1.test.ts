import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  addTaxonomyRecordToWorkspace,
  createTaxonomyRecord,
  createFile,
  createFileRouteForSelection,
  deleteTaxonomyRecord,
  fileRouteForFile,
  filesForSubtopic,
  inlineRenameActionForKey,
  isDoubleActivation,
  loadWorkspaceData,
  normalizeTaxonomySelection,
  notesRouteForSelection,
  renameTaxonomyRecord,
  subtopicsForTopic,
  taxonomyDeleteWarning,
  topicsForCategory,
  validateCreateFileInput,
  validateTaxonomyName,
  type TaxonomySelection,
  renameFile,
  selectCategory,
  selectTopic,
} from '../src/lib/phase1.js'
import {
  getAuthErrorMessage,
  isValidTaxonomyPath,
  validateFileName,
  type WorkspaceData,
} from '../src/lib/phase1.js'

const workspace: WorkspaceData = {
  categories: [{ id: 'category-a', name: 'Category A' }],
  topics: [{ id: 'topic-a', category_id: 'category-a', name: 'Topic A' }],
  subtopics: [
    {
      id: 'subtopic-a',
      category_id: 'category-a',
      topic_id: 'topic-a',
      name: 'Subtopic A',
    },
  ],
  files: [],
}

function createTestClient(
  fetcher: typeof fetch,
): SupabaseClient {
  return createClient(
    'https://example.supabase.co',
    'sb_publishable_test-key',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetcher },
    },
  )
}

test('validates required, trimmed, and bounded file names', () => {
  assert.match(validateFileName('  ') ?? '', /file name/i)
  assert.equal(validateFileName('  Reading notes  '), null)
  assert.match(validateFileName('x'.repeat(121)) ?? '', /120 characters/i)
})

test('accepts only complete taxonomy paths with matching stable IDs', () => {
  assert.equal(
    isValidTaxonomyPath(
      {
        category_id: 'category-a',
        topic_id: 'topic-a',
        subtopic_id: 'subtopic-a',
      },
      workspace,
    ),
    true,
  )

  assert.equal(
    isValidTaxonomyPath(
      {
        category_id: 'category-b',
        topic_id: 'topic-a',
        subtopic_id: 'subtopic-a',
      },
      workspace,
    ),
    false,
  )
  assert.equal(
    isValidTaxonomyPath(
      {
        category_id: 'category-a',
        topic_id: 'topic-a',
        subtopic_id: '',
      },
      workspace,
    ),
    false,
  )
})

test('filters dependent records by canonical parent IDs and clears stale selections', () => {
  const data: WorkspaceData = {
    categories: [
      { id: 'category-a', name: 'A' },
      { id: 'category-b', name: 'B' },
    ],
    topics: [
      { id: 'topic-a', category_id: 'category-a', name: 'Topic A' },
      { id: 'topic-b', category_id: 'category-b', name: 'Topic B' },
    ],
    subtopics: [
      {
        id: 'subtopic-a',
        category_id: 'category-a',
        topic_id: 'topic-a',
        name: 'Subtopic A',
      },
      {
        id: 'subtopic-b',
        category_id: 'category-b',
        topic_id: 'topic-b',
        name: 'Subtopic B',
      },
    ],
    files: [
      {
        id: 'file-a',
        category_id: 'category-a',
        topic_id: 'topic-a',
        subtopic_id: 'subtopic-a',
        name: 'A file',
        created_at: '',
        updated_at: '',
      },
      {
        id: 'file-b',
        category_id: 'category-b',
        topic_id: 'topic-b',
        subtopic_id: 'subtopic-b',
        name: 'B file',
        created_at: '',
        updated_at: '',
      },
    ],
  }
  assert.deepEqual(topicsForCategory(data, 'category-a').map(({ id }) => id), [
    'topic-a',
  ])
  assert.deepEqual(
    subtopicsForTopic(data, 'category-b', 'topic-b').map(({ id }) => id),
    ['subtopic-b'],
  )
  assert.deepEqual(
    filesForSubtopic(data, 'category-a', 'topic-a', 'subtopic-a').map(
      ({ id }) => id,
    ),
    ['file-a'],
  )

  const selected: TaxonomySelection = {
    categoryId: 'category-a',
    topicId: 'topic-a',
    subtopicId: 'subtopic-a',
  }
  assert.deepEqual(
    normalizeTaxonomySelection(data, {
      ...selected,
      categoryId: 'category-b',
    }),
    { categoryId: 'category-b', topicId: '', subtopicId: '' },
  )
  assert.deepEqual(
    normalizeTaxonomySelection(data, {
      ...selected,
      topicId: 'topic-b',
    }),
    { ...selected, topicId: '', subtopicId: '' },
  )
  assert.deepEqual(
    normalizeTaxonomySelection(data, {
      ...selected,
      subtopicId: 'subtopic-b',
    }),
    { ...selected, subtopicId: '' },
  )
})

test('dependent selectors preserve descendants only while they remain under the selected parent', () => {
  const data: WorkspaceData = {
    categories: [
      { id: 'category-a', name: 'A' },
      { id: 'category-b', name: 'B' },
    ],
    topics: [
      { id: 'topic-a', category_id: 'category-a', name: 'Topic A' },
      { id: 'topic-b', category_id: 'category-b', name: 'Topic B' },
    ],
    subtopics: [
      { id: 'subtopic-a', category_id: 'category-a', topic_id: 'topic-a', name: 'Subtopic A' },
      { id: 'subtopic-b', category_id: 'category-b', topic_id: 'topic-b', name: 'Subtopic B' },
    ],
    files: [],
  }
  const selected: TaxonomySelection = {
    categoryId: 'category-a',
    topicId: 'topic-a',
    subtopicId: 'subtopic-a',
  }
  assert.deepEqual(selectCategory(data, selected, 'category-a'), selected)
  assert.deepEqual(selectCategory(data, selected, 'category-b'), {
    categoryId: 'category-b',
    topicId: '',
    subtopicId: '',
  })
  assert.deepEqual(selectTopic(data, selected, 'topic-a'), selected)
  assert.deepEqual(selectTopic(data, selected, 'topic-b'), {
    ...selected,
    topicId: 'topic-b',
    subtopicId: '',
  })
})

test('Create File route carries the selected Category, Topic, and Subtopic IDs', () => {
  assert.equal(
    createFileRouteForSelection({
      categoryId: 'category-a',
      topicId: 'topic-a',
      subtopicId: 'subtopic-a',
    }),
    '/create-file?categoryId=category-a&topicId=topic-a&subtopicId=subtopic-a',
  )
})

test('validates file fields and preserves exact selected route identifiers', () => {
  const selection: TaxonomySelection = {
    categoryId: 'category-a',
    topicId: 'topic-a',
    subtopicId: 'subtopic-a',
  }
  assert.match(
    validateCreateFileInput('  ', selection, workspace) ?? '',
    /file name/i,
  )
  assert.match(
    validateCreateFileInput('A file', { ...selection, topicId: '' }, workspace) ??
      '',
    /valid category, topic, and subtopic/i,
  )
  assert.equal(validateCreateFileInput('A file', selection, workspace), null)
  const notesUrl = new URL(
    notesRouteForSelection({
      ...selection,
      subtopicId: 'subtopic & one',
    }),
    'https://example.test',
  )
  assert.equal(notesUrl.pathname, '/notes')
  assert.equal(notesUrl.searchParams.get('categoryId'), 'category-a')
  assert.equal(notesUrl.searchParams.get('topicId'), 'topic-a')
  assert.equal(notesUrl.searchParams.get('subtopicId'), 'subtopic & one')

  const fileUrl = new URL(
    fileRouteForFile({
      id: 'file-a',
      category_id: 'category-a',
      topic_id: 'topic-a',
      subtopic_id: 'subtopic-a',
      name: 'A file',
      created_at: '',
      updated_at: '',
    }),
    'https://example.test',
  )
  assert.equal(fileUrl.pathname, '/file')
  assert.equal(fileUrl.searchParams.get('fileId'), 'file-a')
  assert.equal(fileUrl.searchParams.get('subtopicId'), 'subtopic-a')
})

test('supports taxonomy rename validation and inline keyboard/double activation', () => {
  assert.match(validateTaxonomyName('  ') ?? '', /enter a name/i)
  assert.match(validateTaxonomyName('x'.repeat(121)) ?? '', /120 characters/i)
  assert.equal(validateTaxonomyName('  New name  '), null)
  assert.equal(inlineRenameActionForKey('Enter'), 'save')
  assert.equal(inlineRenameActionForKey('Escape'), 'cancel')
  assert.equal(inlineRenameActionForKey('a'), null)
  assert.equal(isDoubleActivation(1000, 1300), true)
  assert.equal(isDoubleActivation(1000, 1400), false)
  assert.equal(isDoubleActivation(1000, 900), false)
})

test('taxonomy delete confirmations describe descendants and preserve files', () => {
  assert.match(taxonomyDeleteWarning('categories'), /cascades to its Topics and Subtopics/i)
  assert.match(taxonomyDeleteWarning('topics'), /cascades to its Subtopics/i)
  assert.match(taxonomyDeleteWarning('subtopics'), /Only this Subtopic/i)
  for (const table of ['categories', 'topics', 'subtopics'] as const) {
    assert.match(taxonomyDeleteWarning(table), /Files and their notes are never cascade-deleted/i)
    assert.match(taxonomyDeleteWarning(table), /database rejects/i)
  }
})

test('loads only real cloud workspace records and reports unapplied-schema errors', async () => {
  const rows: Record<string, unknown[]> = {
    categories: [{ id: 'category-a', name: 'Category A' }],
    topics: [{ id: 'topic-a', category_id: 'category-a', name: 'Topic A' }],
    subtopics: [
      {
        id: 'subtopic-a',
        category_id: 'category-a',
        topic_id: 'topic-a',
        name: 'Subtopic A',
      },
    ],
    files: [
      {
        id: 'file-a',
        category_id: 'category-a',
        topic_id: 'topic-a',
        subtopic_id: 'subtopic-a',
        name: 'Cloud file',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
    ],
  }
  const client = createTestClient(async (input) => {
    const table = new URL(input.toString()).pathname.split('/').at(-1) ?? ''
    return Response.json(rows[table] ?? [])
  })

  const workspaceData = await loadWorkspaceData(client)
  assert.deepEqual(workspaceData.files.map(({ name }) => name), ['Cloud file'])
  assert.deepEqual(workspaceData.categories.map(({ name }) => name), ['Category A'])

  const unavailableClient = createTestClient(async (input) => {
    const table = new URL(input.toString()).pathname.split('/').at(-1)
    if (table === 'categories') {
      return Response.json(
        { code: '42P01', message: 'private missing-table detail' },
        { status: 404 },
      )
    }
    return Response.json([])
  })
  await assert.rejects(
    loadWorkspaceData(unavailableClient),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Phase 1 migration 20261016133000/i)
      assert.doesNotMatch(error.message, /private missing-table detail/)
      return true
    },
  )
})

test('creates taxonomy rows with only canonical parent IDs and no client owner field', async () => {
  const requests: Array<{ table: string; payload: Record<string, unknown> }> = []
  const client = createTestClient(async (input, init) => {
    const table = new URL(input.toString()).pathname.split('/').at(-1) ?? ''
    const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    requests.push({ table, payload })
    const row =
      table === 'categories'
        ? { id: 'category-new', name: payload.name }
        : table === 'topics'
          ? { id: 'topic-new', name: payload.name, category_id: payload.category_id }
          : {
              id: 'subtopic-new',
              name: payload.name,
              category_id: payload.category_id,
              topic_id: payload.topic_id,
            }
    return Response.json(row, { status: 201 })
  })

  const category = await createTaxonomyRecord(client, 'categories', 'New category', {
    categoryId: '',
    topicId: '',
    subtopicId: '',
  })
  const topic = await createTaxonomyRecord(client, 'topics', 'New topic', {
    categoryId: 'category-a',
    topicId: '',
    subtopicId: '',
  })
  const subtopic = await createTaxonomyRecord(client, 'subtopics', 'New subtopic', {
    categoryId: 'category-a',
    topicId: 'topic-a',
    subtopicId: '',
  })

  assert.equal(category.id, 'category-new')
  assert.equal(topic.id, 'topic-new')
  assert.equal(subtopic.id, 'subtopic-new')
  assert.deepEqual(requests, [
    { table: 'categories', payload: { name: 'New category' } },
    {
      table: 'topics',
      payload: { name: 'New topic', category_id: 'category-a' },
    },
    {
      table: 'subtopics',
      payload: {
        name: 'New subtopic',
        category_id: 'category-a',
        topic_id: 'topic-a',
      },
    },
  ])
})

test('rejects taxonomy child creation without its selected parents', async () => {
  let called = false
  const client = createTestClient(async () => {
    called = true
    return Response.json({})
  })
  await assert.rejects(
    createTaxonomyRecord(client, 'topics', 'Topic', {
      categoryId: '',
      topicId: '',
      subtopicId: '',
    }),
    /Select a Category/i,
  )
  await assert.rejects(
    createTaxonomyRecord(client, 'subtopics', 'Subtopic', {
      categoryId: 'category-a',
      topicId: '',
      subtopicId: '',
    }),
    /Select a Topic/i,
  )
  assert.equal(called, false)
})

test('keeps a committed taxonomy creation visible without a follow-up read', () => {
  const category = { id: 'category-new', name: 'New Category' }
  const topic = {
    id: 'topic-new',
    category_id: 'category-a',
    name: 'New Topic',
  }
  const subtopic = {
    id: 'subtopic-new',
    category_id: 'category-a',
    topic_id: 'topic-a',
    name: 'New Subtopic',
  }
  const afterCategory = addTaxonomyRecordToWorkspace(
    workspace,
    'categories',
    category,
  )
  const afterTopic = addTaxonomyRecordToWorkspace(
    afterCategory,
    'topics',
    topic,
  )
  const afterSubtopic = addTaxonomyRecordToWorkspace(
    afterTopic,
    'subtopics',
    subtopic,
  )

  assert.deepEqual(
    afterSubtopic.categories.find(({ id }) => id === category.id),
    category,
  )
  assert.deepEqual(
    afterSubtopic.topics.find(({ id }) => id === topic.id),
    topic,
  )
  assert.deepEqual(
    afterSubtopic.subtopics.find(({ id }) => id === subtopic.id),
    subtopic,
  )
})

test('keeps taxonomy response-verification errors actionable', async () => {
  const client = createTestClient(async () =>
    Response.json({ id: 'category-new', name: 'Different name' }, { status: 201 }),
  )
  await assert.rejects(
    createTaxonomyRecord(client, 'categories', 'New Category', {
      categoryId: '',
      topicId: '',
      subtopicId: '',
    }),
    /new item could not be verified/i,
  )
})

test('workspace errors distinguish missing tables from API cache, schema, auth and permission failures', async () => {
  const cases = [
    {
      code: '42P01',
      status: 404,
      expected: /required workspace table was not found/i,
    },
    {
      code: 'PGRST205',
      status: 404,
      expected: /API schema cache cannot find/i,
    },
    {
      code: '42703',
      status: 400,
      expected: /schema does not match/i,
    },
    {
      code: 'PGRST204',
      status: 400,
      expected: /schema does not match/i,
    },
    {
      code: 'PGRST301',
      status: 401,
      expected: /session is missing or expired/i,
    },
    {
      code: '42501',
      status: 403,
      expected: /does not have permission/i,
    },
  ] as const

  for (const { code, status, expected } of cases) {
    const client = createTestClient(async () =>
      Response.json(
        {
          code,
          message: `private diagnostic detail: ${code}`,
          details: 'private policy or schema detail',
        },
        { status },
      ),
    )
    await assert.rejects(loadWorkspaceData(client), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, expected)
      assert.doesNotMatch(error.message, /private diagnostic|private policy/i)
      return true
    })
  }
})

test('workspace request failures distinguish network errors and hide raw service details', async () => {
  const networkClient = createTestClient(async () => {
    throw new TypeError('private network endpoint details')
  })
  await assert.rejects(loadWorkspaceData(networkClient), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /Could not reach the Supabase service/i)
    assert.doesNotMatch(error.message, /private network endpoint/i)
    return true
  })

  const unknownClient = createTestClient(async () =>
    Response.json(
      { code: 'XX001', message: 'private database failure detail' },
      { status: 500 },
    ),
  )
  await assert.rejects(loadWorkspaceData(unknownClient), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /database or service error/i)
    assert.doesNotMatch(error.message, /private database failure/i)
    return true
  })
})

test('maps common Supabase sign-in failures without exposing provider details', () => {
  assert.match(
    getAuthErrorMessage({ code: 'invalid_credentials' }),
    /email or password is incorrect/i,
  )
  assert.match(
    getAuthErrorMessage({ code: 'invalid_credentials' }),
    /forgot password/i,
  )
  assert.match(
    getAuthErrorMessage({ code: 'email_not_confirmed' }),
    /confirm your email/i,
  )
  assert.match(
    getAuthErrorMessage({ status: 429 }),
    /too many authentication requests/i,
  )
  assert.match(
    getAuthErrorMessage({ name: 'AuthRetryableFetchError' }),
    /could not reach the authentication service/i,
  )
  assert.match(
    getAuthErrorMessage({ status: 503 }),
    /could not reach the authentication service/i,
  )
  assert.match(
    getAuthErrorMessage(new Error('private provider detail')),
    /could not be completed/i,
  )
  assert.doesNotMatch(
    getAuthErrorMessage(new Error('private provider detail')),
    /private provider detail/i,
  )
})

test('creates a file with canonical IDs and leaves ownership to auth.uid()', async () => {
  let requestPath = ''
  let requestBody = ''
  const client = createTestClient(async (input, init) => {
    requestPath = new URL(input.toString()).pathname
    requestBody = String(init?.body ?? '')
    return Response.json(
      {
        id: 'file-new',
        category_id: 'category-a',
        topic_id: 'topic-a',
        subtopic_id: 'subtopic-a',
        name: 'Reading notes',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
      },
      { status: 201 },
    )
  })

  const created = await createFile(client, '  Reading notes  ', {
    category_id: 'category-a',
    topic_id: 'topic-a',
    subtopic_id: 'subtopic-a',
  })

  assert.equal(created.id, 'file-new')
  const body = JSON.parse(requestBody) as Record<string, unknown>
  assert.equal(requestPath, '/rest/v1/files')
  assert.equal(body.name, 'Reading notes')
  assert.equal(body.category_id, 'category-a')
  assert.equal(body.topic_id, 'topic-a')
  assert.equal(body.subtopic_id, 'subtopic-a')
  assert.equal('owner_id' in body, false)
})

test('keeps create failures safe and does not send invalid file names', async () => {
  let called = false
  const client = createTestClient(async () => {
    called = true
    return Response.json(
      { code: '42501', message: 'private RLS policy detail' },
      { status: 403 },
    )
  })
  await assert.rejects(
    createFile(client, '   ', {
      category_id: 'category-a',
      topic_id: 'topic-a',
      subtopic_id: 'subtopic-a',
    }),
    /Enter a file name/i,
  )
  assert.equal(called, false)
  await assert.rejects(
    createFile(client, 'File', {
      category_id: 'category-a',
      topic_id: 'topic-a',
      subtopic_id: 'subtopic-a',
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /permission/i)
      assert.doesNotMatch(error.message, /private RLS policy detail/i)
      return true
    },
  )
})

test('reports restrictive taxonomy deletion without exposing database details', async () => {
  const client = createTestClient(async () =>
    new Response(
      JSON.stringify({
        code: '23503',
        message: 'sensitive constraint detail',
        details: 'private database detail',
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ),
  )

  await assert.rejects(
    deleteTaxonomyRecord(client, 'categories', 'category-a'),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Category has Files in one or more descendant Subtopics/i)
      assert.match(error.message, /No records were partially deleted/i)
      assert.doesNotMatch(error.message, /sensitive|private/i)
      return true
    },
  )
})

test('does not report taxonomy rename success when the database rejects it', async () => {
  const client = createTestClient(async () =>
    Response.json(
      {
        code: '42501',
        message: 'private taxonomy update policy detail',
      },
      { status: 403 },
    ),
  )
  await assert.rejects(
    renameTaxonomyRecord(client, 'categories', 'category-a', 'Renamed'),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /permission/i)
      assert.doesNotMatch(error.message, /private taxonomy update policy detail/i)
      return true
    },
  )
})

test('renames one taxonomy row by its stable ID without changing its parent', async () => {
  let requestPath = ''
  let requestBody = ''
  const client = createTestClient(async (input, init) => {
    requestPath = new URL(input.toString()).pathname
    requestBody = String(init?.body ?? '')
    return Response.json([{ id: 'topic-a' }])
  })

  await renameTaxonomyRecord(client, 'topics', 'topic-a', '  Renamed  ')
  assert.equal(requestPath, '/rest/v1/topics')
  assert.deepEqual(JSON.parse(requestBody), { name: 'Renamed' })
})

test('deletes only the chosen taxonomy table row and safely rejects referenced records', async () => {
  const paths: string[] = []
  const client = createTestClient(async (input, init) => {
    paths.push(`${init?.method} ${new URL(input.toString()).pathname}`)
    return Response.json([{ id: 'selected-id' }])
  })

  for (const table of ['categories', 'topics', 'subtopics'] as const) {
    await deleteTaxonomyRecord(client, table, 'selected-id')
  }
  assert.deepEqual(paths, [
    'DELETE /rest/v1/categories',
    'DELETE /rest/v1/topics',
    'DELETE /rest/v1/subtopics',
  ])
})

test('renames a file without changing its taxonomy path', async () => {
  let requestBody = ''
  const client = createTestClient(async (_input, init) => {
    requestBody = String(init?.body ?? '')
    return new Response(JSON.stringify([{ id: 'file-a' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  await renameFile(client, 'file-a', '  Updated name  ')
  const body = JSON.parse(requestBody) as Record<string, unknown>
  assert.equal(body.name, 'Updated name')
  assert.equal('category_id' in body, false)
  assert.equal('topic_id' in body, false)
  assert.equal('subtopic_id' in body, false)
})
