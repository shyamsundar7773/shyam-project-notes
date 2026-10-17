import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownPreview } from '../src/components/MarkdownPreview'
import { resolveAppTheme } from '../src/components/ThemeContext'
import { resolveAppTheme } from '../src/components/ThemeContext'
import { AutosaveQueue, type SaveState } from '../src/lib/autosave'
import { RequestSequence } from '../src/lib/request-sequence'
import {
  appendSqlPracticeToNote,
  removeMarkedSqlPracticeFromNote,
  removeMarkedSqlPracticeFromNote,
  draftStorageKey,
  copyNote,
  copyNoteToFile,
  createNote,
  createNoteForSubtopic,
  deleteNote,
  getNote,
  listNotesForFiles,
  NoteSaveConflictError,
  notesForFile,
  parseCachedDraft,
  readCachedDraft,
  saveNote,
  serializeCachedDraft,
  uniqueCopyTitle,
  noteColorForId,
  writeCachedDraft,
  type Note,
  type EditableNote,
} from '../src/lib/notes'
import {
  executePracticeSql,
  fetchPracticeSqlQuestion,
  requestNoteAi,
  resolveBackendBaseUrl,
  resolveExpoBackendBaseUrl,
} from '../src/lib/note-ai'
import {
  noteRouteForSelection,
  notesRouteForSelection,
  parseTaxonomyQuery,
} from '../src/lib/phase1'

const draft: EditableNote = {
  title: 'SQL review',
  source_content: 'SELECT 1;',
  sql_output: 'Illustrative only',
  sql_evaluation: 'Looks plausible',
  sql_evaluated_source: 'SELECT 1;',
  markdown_output: null,
  markdown_converted_source: null,
  personal_notes: 'Check the real schema.',
  note_color: 'lavender',
  is_pinned: false,
}
const sourceNote: Note = {
  id: '00000000-0000-0000-0000-000000000010',
  owner_id: '00000000-0000-0000-0000-000000000001',
  file_id: '00000000-0000-0000-0000-000000000020',
  note_type: 'sql',
  ...draft,
  created_at: '2026-10-16T12:00:00.000Z',
  updated_at: '2026-10-16T12:01:00.000Z',
}

test('notes route rejects missing or malformed taxonomy IDs', () => {
  assert.equal(parseTaxonomyQuery(''), null)
  assert.equal(
    parseTaxonomyQuery(
      '?categoryId=bad&topicId=00000000-0000-0000-0000-000000000002&subtopicId=00000000-0000-0000-0000-000000000003',
    ),
    null,
  )
  assert.deepEqual(
    parseTaxonomyQuery(
      '?categoryId=00000000-0000-0000-0000-000000000001&topicId=00000000-0000-0000-0000-000000000002&subtopicId=00000000-0000-0000-0000-000000000003',
    ),
    {
      categoryId: '00000000-0000-0000-0000-000000000001',
      topicId: '00000000-0000-0000-0000-000000000002',
      subtopicId: '00000000-0000-0000-0000-000000000003',
    },
  )
})

test('notes collection ignores stale workspace requests after path changes', () => {
  const requests = new RequestSequence()
  const older = requests.begin()
  const latest = requests.begin()

  assert.equal(requests.isCurrent(older), false)
  assert.equal(requests.isCurrent(latest), true)

  requests.invalidate()
  assert.equal(requests.isCurrent(latest), false)
})

test('Home no longer exposes the Create File action', () => {
  const expoHome = readFileSync(new URL('../app/(app)/home.tsx', import.meta.url), 'utf8')
  const viteApp = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(expoHome, /Create File in this Subtopic/)
  assert.doesNotMatch(viteApp, /navigate\('\/create-file'\)/)
})

test('SQL practice insertion appends its full result without replacing existing note text', () => {
  const existing = 'My original study notes\n\nKeep this paragraph.'
  const updated = appendSqlPracticeToNote(existing, {
    question: 'Find employees over the threshold.',
    sql: 'SELECT name FROM employees;',
    output: '{"rows":[{"name":"Asha"}]}',
    evaluation: 'The query answers the prompt.',
  })
  assert.ok(updated.startsWith(existing))
  assert.match(updated, /SQL practice[\s\S]*Question: Find employees/)
  assert.match(updated, /SELECT name FROM employees;/)
  assert.match(updated, /Output:\n\{"rows":\[\{"name":"Asha"\}\]\}/)
  assert.match(updated, /Evaluation:\nThe query answers the prompt\./)
})

test('clearing marked SQL content removes practice blocks but preserves other note content', () => {
  const original = 'Keep this paragraph.\n\nMore study notes.'
  const withPractice = appendSqlPracticeToNote(original, {
    question: 'List rows.',
    sql: 'SELECT 1;',
    output: '{"rows":[]}',
    evaluation: 'Valid.',
  })
  assert.equal(removeMarkedSqlPracticeFromNote(withPractice), original)
  const unmarked = 'Keep exact trailing whitespace.  \n'
  assert.equal(removeMarkedSqlPracticeFromNote(unmarked), unmarked)

  const legacy = [
    original,
    'SQL practice',
    'Question: List rows.',
    'SQL:\nSELECT 1;',
    'Output:\n{\n  "rows": []\n}',
    'Evaluation:\nValid.',
  ].join('\n\n')
  assert.equal(
    removeMarkedSqlPracticeFromNote(legacy, {
      sql: 'SELECT 1;',
      output: '{"rows":[]}',
      evaluation: 'Valid.',
    }),
    original,
  )
})

test('theme resolution honors a saved choice and otherwise follows the system theme', () => {
  assert.equal(resolveAppTheme('dark', 'light'), 'dark')
  assert.equal(resolveAppTheme('light', 'dark'), 'light')
  assert.equal(resolveAppTheme(null, 'dark'), 'dark')
  assert.equal(resolveAppTheme(null, 'light'), 'light')
  assert.equal(resolveAppTheme('unknown', null), 'light')
})

test('notes migration protects parent files with a restrictive composite foreign key', () => {
  const phase1 = readFileSync(
    new URL(
      '../supabase/migrations/20261016133000_phase1_taxonomy_files.sql',
      import.meta.url,
    ),
    'utf8',
  )
  const migration = readFileSync(
    new URL(
      '../supabase/migrations/20261016140000_phase2_notes.sql',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(phase1, /constraint files_id_owner_unique unique \(id, owner_id\)/i)
  assert.match(phase1, /foreign key \(subtopic_id, topic_id, category_id, owner_id\)/i)
  assert.match(phase1, /references public\.subtopics \(id, topic_id, category_id, owner_id\)/i)
  assert.doesNotMatch(phase1, /\band\s*;/i)
  assert.doesNotMatch(migration, /\band\s*;/i)
  assert.ok(
    '20261016133000_phase1_taxonomy_files.sql' <
      '20261016140000_phase2_notes.sql',
    'Phase 1 must sort before Phase 2 for CLI migration order',
  )
  assert.doesNotMatch(migration, /alter table public\.files/i)
  assert.match(migration, /foreign key \(file_id, owner_id\)/i)
  assert.match(migration, /references public\.files \(id, owner_id\)/i)
  assert.match(migration, /on delete restrict/i)
  assert.match(migration, /enable row level security/i)
})

test('copy persists a distinct destination note without sending system ownership fields', async () => {
  let inserted: Record<string, unknown> = {}
  const requestUrls: string[] = []
  let requestMethod = ''
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async (input, init) => {
        requestUrls.push(String(input))
        requestMethod = init?.method ?? 'GET'
        if (requestMethod === 'GET') {
          return Response.json([{ title: 'SQL review (Copy)' }])
        }
        inserted = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json(
          {
            ...inserted,
            id: '00000000-0000-0000-0000-000000000011',
            owner_id: sourceNote.owner_id,
            created_at: sourceNote.created_at,
            updated_at: sourceNote.updated_at,
          },
          { status: 201 },
        )
      },
    },
  })

  const copy = await copyNoteToFile(
    client,
    sourceNote,
    '00000000-0000-0000-0000-000000000099',
    sourceNote.owner_id,
  )
  assert.notEqual(copy.id, sourceNote.id)
  assert.equal(copy.file_id, '00000000-0000-0000-0000-000000000099')
  assert.equal(copy.title, 'SQL review (Copy 2)')
  assert.equal(copy.source_content, sourceNote.source_content)
  assert.equal(copy.sql_output, sourceNote.sql_output)
  assert.equal(copy.personal_notes, sourceNote.personal_notes)
  assert.equal(sourceNote.file_id, '00000000-0000-0000-0000-000000000020')
  assert.equal(requestMethod, 'POST')
  assert.match(requestUrls[0], /file_id=eq\.00000000-0000-0000-0000-000000000099/)
  assert.match(requestUrls[0], /owner_id=eq\.00000000-0000-0000-0000-000000000001/)
  assert.equal('owner_id' in inserted, false)
  assert.equal('id' in inserted, false)
  assert.equal('created_at' in inserted, false)
})

test('copy rejects a source owned by another user without making a request', async () => {
  let requested = false
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: { fetch: async () => { requested = true; return Response.json({}) } },
  })
  await assert.rejects(
    copyNote(client, { ...sourceNote, owner_id: 'someone-else' }, sourceNote.owner_id),
    /Choose a valid note and destination/,
  )
  assert.equal(requested, false)
})

test('create persists a text note in the selected file without client-supplied ownership', async () => {
  let requestedUrl = ''
  let inserted: Record<string, unknown> = {}
  const created = {
    ...sourceNote,
    id: '00000000-0000-0000-0000-000000000030',
    note_type: 'text' as const,
    title: 'Untitled note',
    source_content: '',
  }
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async (input, init) => {
        requestedUrl = String(input)
        inserted = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json(created, { status: 201 })
      },
    },
  })

  const result = await createNote(
    client,
    sourceNote.file_id,
    sourceNote.owner_id,
    'text',
  )

  assert.equal(result.id, created.id)
  assert.equal(result.file_id, sourceNote.file_id)
  assert.equal(result.owner_id, sourceNote.owner_id)
  assert.equal(result.title, 'Untitled note')
  assert.equal(result.source_content, '')
  assert.match(requestedUrl, /\/rest\/v1\/notes\?select=\*/)
  assert.equal(inserted.file_id, sourceNote.file_id)
  assert.equal(inserted.note_type, 'text')
  assert.equal(inserted.source_content, '')
  assert.equal('owner_id' in inserted, false)
})

test('Add Note resolves one file for a new Subtopic and shares rapid duplicate requests', async () => {
  const file = {
    id: '00000000-0000-0000-0000-000000000040',
    category_id: '00000000-0000-0000-0000-000000000001',
    topic_id: '00000000-0000-0000-0000-000000000002',
    subtopic_id: '00000000-0000-0000-0000-000000000003',
    name: 'Notes',
    created_at: '2026-10-16T12:00:00.000Z',
    updated_at: '2026-10-16T12:00:00.000Z',
  }
  const created = {
    ...sourceNote,
    id: '00000000-0000-0000-0000-000000000041',
    file_id: file.id,
    note_type: 'text' as const,
    title: 'Untitled note',
    source_content: '',
  }
  let fileInserts = 0
  let noteInserts = 0
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/files')) {
          if (init?.method !== 'POST') return Response.json([])
          fileInserts += 1
          return Response.json(file, { status: 201 })
        }
        if (url.pathname.endsWith('/notes')) {
          noteInserts += 1
          return Response.json(created, { status: 201 })
        }
        throw new Error('Unexpected persistence route')
      },
    },
  })
  const path = {
    category_id: file.category_id,
    topic_id: file.topic_id,
    subtopic_id: file.subtopic_id,
  }
  const [first, second] = await Promise.all([
    createNoteForSubtopic(client, sourceNote.owner_id, path),
    createNoteForSubtopic(client, sourceNote.owner_id, path),
  ])

  assert.equal(first.note.id, created.id)
  assert.equal(second.note.id, created.id)
  assert.equal(first.file.id, file.id)
  assert.equal(fileInserts, 1)
  assert.equal(noteInserts, 1)
})

test('note card pastel color is stable for its ID and varies across IDs', () => {
  assert.equal(noteColorForId(sourceNote.id), noteColorForId(sourceNote.id))
  assert.notEqual(noteColorForId('note-one'), noteColorForId('note-ona'))
})

test('notes query scopes to the authenticated owner and only selected files', async () => {
  let requestedUrl = ''
  const foreign = { ...sourceNote, id: 'foreign', owner_id: 'another-owner' }
  const otherFile = { ...sourceNote, id: 'other-file', file_id: 'unselected-file' }
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async (input) => {
        requestedUrl = String(input)
        return Response.json([sourceNote, foreign, otherFile])
      },
    },
  })
  const result = await listNotesForFiles(
    client,
    [sourceNote.file_id],
    sourceNote.owner_id,
  )
  assert.deepEqual(result, [sourceNote])
  assert.match(requestedUrl, /owner_id=eq\.00000000-0000-0000-0000-000000000001/)
  assert.match(requestedUrl, /file_id=in\./)
})

test('note editor route preserves the note and canonical taxonomy IDs', () => {
  assert.equal(
    noteRouteForSelection(sourceNote.id, {
      categoryId: 'category-id',
      topicId: 'topic-id',
      subtopicId: 'subtopic-id',
    }),
    `/note?noteId=${sourceNote.id}&categoryId=category-id&topicId=topic-id&subtopicId=subtopic-id`,
  )
})

test('destination collection route uses the copied note file taxonomy IDs', () => {
  assert.equal(
    notesRouteForSelection({
      categoryId: 'destination-category',
      topicId: 'destination-topic',
      subtopicId: 'destination-subtopic',
    }),
    '/notes?categoryId=destination-category&topicId=destination-topic&subtopicId=destination-subtopic',
  )
})

test('version-checked note updates include owner scope and trim title', async () => {
  let requestedUrl = ''
  let updateBody: Record<string, unknown> = {}
  const updated = { ...sourceNote, title: 'Updated title', updated_at: '2026-10-16T12:02:00Z' }
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async (input, init) => {
        requestedUrl = String(input)
        updateBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json([updated])
      },
    },
  })
  const result = await saveNote(
    client,
    sourceNote.id,
    sourceNote.updated_at,
    { title: ' Updated title ' },
    sourceNote.owner_id,
  )
  assert.equal(result.title, 'Updated title')
  assert.equal(updateBody.title, 'Updated title')
  assert.match(requestedUrl, /id=eq\.00000000-0000-0000-0000-000000000010/)
  assert.match(requestedUrl, /updated_at=eq\./)
  assert.match(requestedUrl, /owner_id=eq\.00000000-0000-0000-0000-000000000001/)
})

test('autosave persists an appended SQL practice block in the same note fields', async () => {
  const content = appendSqlPracticeToNote(sourceNote.source_content, {
    question: 'List employees.',
    sql: 'SELECT name FROM employees',
    output: '{"rows":[{"name":"Asha"}]}',
    evaluation: 'The query answers the question.',
  })
  let updateBody: Record<string, unknown> = {}
  const updated = {
    ...sourceNote,
    source_content: content,
    sql_output: '{"rows":[{"name":"Asha"}]}',
    sql_evaluation: 'The query answers the question.',
    sql_evaluated_source: 'SELECT name FROM employees',
    updated_at: '2026-10-16T12:02:00Z',
  }
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async (_input, init) => {
        updateBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json([updated])
      },
    },
  })

  const saved = await saveNote(
    client,
    sourceNote.id,
    sourceNote.updated_at,
    {
      source_content: content,
      sql_output: updated.sql_output,
      sql_evaluation: updated.sql_evaluation,
      sql_evaluated_source: updated.sql_evaluated_source,
    },
    sourceNote.owner_id,
  )

  assert.equal(updateBody.source_content, content)
  assert.match(content, /SELECT 1;/)
  assert.match(content, /SQL practice/)
  assert.equal(saved.sql_evaluated_source, 'SELECT name FROM employees')
})

test('note update rejects empty title before network persistence', async () => {
  let requested = false
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: { fetch: async () => { requested = true; return Response.json({}) } },
  })
  await assert.rejects(
    saveNote(client, sourceNote.id, sourceNote.updated_at, { title: '  ' }),
    /Enter a note title/,
  )
  assert.equal(requested, false)
})

test('note detail and delete operations include the selected owner and ID', async () => {
  const urls: string[] = []
  let method = ''
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async (input, init) => {
        urls.push(String(input))
        method = init?.method ?? 'GET'
        return method === 'DELETE'
          ? Response.json([{ id: sourceNote.id }])
          : Response.json([sourceNote])
      },
    },
  })
  const loaded = await getNote(client, sourceNote.id, sourceNote.owner_id)
  assert.equal(loaded.id, sourceNote.id)
  assert.match(urls[0], /id=eq\.00000000-0000-0000-0000-000000000010/)
  assert.match(urls[0], /owner_id=eq\.00000000-0000-0000-0000-000000000001/)
  await deleteNote(client, sourceNote.id, sourceNote.owner_id)
  assert.equal(method, 'DELETE')
  assert.match(urls[1], /id=eq\.00000000-0000-0000-0000-000000000010/)
  assert.match(urls[1], /owner_id=eq\.00000000-0000-0000-0000-000000000001/)
})

test('permission failures are safe and do not claim note deletion or copy success', async () => {
  let calls = 0
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async () => {
        calls += 1
        if (calls === 1) return Response.json([], { status: 200 })
        return Response.json(
          { code: '42501', message: 'private database policy details' },
          { status: 403 },
        )
      },
    },
  })
  await assert.rejects(
    copyNoteToFile(client, sourceNote, 'destination-file', sourceNote.owner_id),
    (error: unknown) => {
      assert.match(String(error), /session expired or cannot access this note/i)
      assert.doesNotMatch(String(error), /private database policy details/)
      return true
    },
  )

  const deniedDeleteClient = createClient(
    'https://supabase.example.test',
    'test-publishable-key',
    {
      global: {
        fetch: async () =>
          Response.json(
            { code: '42501', message: 'private database policy details' },
            { status: 403 },
          ),
      },
    },
  )
  await assert.rejects(
    deleteNote(deniedDeleteClient, sourceNote.id, sourceNote.owner_id),
    /session expired or cannot access this note/i,
  )
})

test('empty version-checked update is reported as a conflict, not saved', async () => {
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: { fetch: async () => Response.json([]) },
  })
  await assert.rejects(
    saveNote(client, sourceNote.id, sourceNote.updated_at, { source_content: 'draft' }),
    (error: unknown) => error instanceof NoteSaveConflictError,
  )
})

test('copy names avoid existing destination titles with a predictable suffix', () => {
  assert.equal(
    uniqueCopyTitle('SQL review', new Set(['SQL review (Copy)', 'SQL review (Copy 2)'])),
    'SQL review (Copy 3)',
  )
})

test('notes shown for a selected collection exclude stale notes from another file', () => {
  const otherFile = {
    ...sourceNote,
    id: '00000000-0000-0000-0000-000000000012',
    file_id: '00000000-0000-0000-0000-000000000021',
  }
  assert.deepEqual(
    notesForFile([sourceNote, otherFile], sourceNote.file_id),
    [sourceNote],
  )
  assert.deepEqual(notesForFile([sourceNote], null), [])
})

test('backend URL keeps desktop localhost behavior and resolves phone localhost to the serving host', () => {
  assert.equal(
    resolveBackendBaseUrl(
      'http://localhost:3001',
      'http://localhost:5173/notes',
    ),
    'http://localhost:3001',
  )
  assert.equal(
    resolveBackendBaseUrl(
      'http://localhost:3001',
      'http://192.168.1.20:5173/notes',
    ),
    'http://192.168.1.20:3001',
  )
  assert.equal(
    resolveBackendBaseUrl('', 'http://192.168.1.20:5173/notes'),
    'http://192.168.1.20:3001',
  )
  assert.equal(
    resolveBackendBaseUrl('', 'https://notes.example.test/notes'),
    '',
  )
  assert.equal(
    resolveBackendBaseUrl('', 'http://notes.example.test/notes'),
    '',
  )
  assert.equal(
    resolveBackendBaseUrl(
      'https://api.example.test',
      'https://notes.example.test/notes',
    ),
    'https://api.example.test',
  )
})

test('Expo backend URL supports web and LAN-native practice requests', () => {
  assert.equal(
    resolveExpoBackendBaseUrl('', 'web', 'http://localhost:8081/notes', ''),
    'http://localhost:3001',
  )
  assert.equal(
    resolveExpoBackendBaseUrl('', 'android', '', '192.168.1.20:8081'),
    'http://192.168.1.20:3001',
  )
  assert.equal(
    resolveExpoBackendBaseUrl(
      'https://api.example.test/path',
      'android',
      '',
      '192.168.1.20:8081',
    ),
    'https://api.example.test',
  )
})

test('SQL practice helpers validate question/result responses and send authenticated SQL', async () => {
  const expectedAuthorization =
    String.fromCharCode(66, 101, 97, 114, 101, 114, 32) + 'test-access-token'
  let questionUrl = ''
  let questionAuthorization = ''
  const question = await fetchPracticeSqlQuestion(
    'https://api.example.test/',
    'test-access-token',
    async (input, init) => {
      questionUrl = String(input)
      questionAuthorization =
        new Headers(init?.headers).get('authorization') ?? ''
      return new Response(
        JSON.stringify({
          prompt: 'Select employees.',
          schema: ['employees(id INTEGER)'],
        }),
        { status: 200 },
      )
    },
  )
  assert.equal(questionUrl, 'https://api.example.test/api/notes/practice-question')
  assert.equal(questionAuthorization, expectedAuthorization)
  assert.equal(question.prompt, 'Select employees.')

  let executionUrl = ''
  let executionMethod = ''
  let executionBody = ''
  const result = await executePracticeSql(
    'https://api.example.test',
    'test-access-token',
    'SELECT id FROM employees',
    async (input, init) => {
      executionUrl = String(input)
      executionMethod = init?.method ?? ''
      executionBody = String(init?.body)
      return new Response(
        JSON.stringify({
          columns: ['id'],
          rows: [{ id: 1 }],
          rowLimit: 200,
          truncated: false,
        }),
        { status: 200 },
      )
    },
  )
  assert.equal(executionUrl, 'https://api.example.test/api/notes/run-sql')
  assert.equal(executionMethod, 'POST')
  assert.deepEqual(JSON.parse(executionBody), { sql: 'SELECT id FROM employees' })
  assert.equal(result.rows.length, 1)
})

test('SQL execution sends the current question as context to the backend endpoint', async () => {
  let body = ''
  await executePracticeSql(
    'https://api.example.test',
    'test-access-token',
    'SELECT 1',
    async (_input, init) => {
      body = String(init?.body)
      return Response.json({
        columns: ['1'],
        rows: [{ '1': 1 }],
        rowLimit: 200,
        truncated: false,
      })
    },
    'Return one row.',
  )
  assert.deepEqual(JSON.parse(body), {
    sql: 'SELECT 1',
    question: 'Return one row.',
  })
})

test('Gemini evaluation failure keeps the submitted query and executed result available', async () => {
  const query = 'SELECT name FROM employees'
  const result = {
    columns: ['name'],
    rows: [{ name: 'Asha' }],
    rowLimit: 200,
    truncated: false,
  }
  await assert.rejects(
    requestNoteAi(
      {
        kind: 'sql',
        content: query,
        accessToken: 'test-access-token',
        question: 'List employees.',
        executionResult: JSON.stringify(result),
      },
      {
        baseUrl: 'https://api.example.test',
        fetcher: async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'UPSTREAM_FAILURE',
                message: 'The AI request could not be completed.',
              },
            }),
            { status: 502 },
          ),
      },
    ),
    /AI request could not be completed/i,
  )

  assert.equal(query, 'SELECT name FROM employees')
  assert.deepEqual(result.rows, [{ name: 'Asha' }])
})

test('Markdown conversion accepts a valid Gemini response and keeps the call server-scoped', async () => {
  let target = ''
  const result = await requestNoteAi(
    {
      kind: 'markdown',
      content: '# Source',
      accessToken: 'test-access-token',
    },
    {
      baseUrl: 'https://api.example.test',
      fetcher: async (input) => {
        target = String(input)
        return Response.json({ convertedMarkdown: '# Improved notes' })
      },
    },
  )
  assert.deepEqual(result, { convertedMarkdown: '# Improved notes' })
  assert.equal(target, 'https://api.example.test/api/notes/convert-markdown')
})

test('AI request timeout aborts the request and returns a retryable message', async () => {
  await assert.rejects(
    requestNoteAi(
      {
        kind: 'sql',
        content: 'SELECT 1;',
        accessToken: 'test-access-token',
      },
      {
        baseUrl: 'https://api.example.test',
        timeoutMs: 5,
        fetcher: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      },
    ),
    /timed out/i,
  )
})

test('AI deadline covers a stalled response body even when the fetch adapter ignores abort', async () => {
  await assert.rejects(
    requestNoteAi(
      { kind: 'markdown', content: '# Source', accessToken: 'test-access-token' },
      {
        baseUrl: 'https://api.example.test',
        timeoutMs: 5,
        fetcher: async () =>
          new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ),
    /timed out/i,
  )
})

test('AI request reports malformed successful responses and non-JSON failures', async () => {
  await assert.rejects(
    requestNoteAi(
      { kind: 'markdown', content: '# Source', accessToken: 'test-access-token' },
      {
        baseUrl: 'https://api.example.test',
        fetcher: async () => Response.json({ convertedMarkdown: 4 }),
      },
    ),
    /invalid response/i,
  )
  await assert.rejects(
    requestNoteAi(
      { kind: 'sql', content: 'SELECT 1;', accessToken: 'test-access-token' },
      {
        baseUrl: 'https://api.example.test',
        fetcher: async () => new Response('upstream failure', { status: 502 }),
      },
    ),
    /invalid response/i,
  )
})

test('AI request surfaces authenticated and upstream HTTP failures', async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    const message = `Backend error ${status}`
    await assert.rejects(
      requestNoteAi(
        {
          kind: 'markdown',
          content: '# Keep this source',
          accessToken: 'access-token',
        },
        {
          baseUrl: 'https://backend.example',
          fetcher: async () =>
            new Response(
              JSON.stringify({ error: { code: `ERROR_${status}`, message } }),
              { status, headers: { 'content-type': 'application/json' } },
            ),
        },
      ),
      new RegExp(message),
    )
  }
})

test('AI request reports missing backend configuration and network failures', async () => {
  await assert.rejects(
    requestNoteAi(
      { kind: 'markdown', content: '# Source', accessToken: 'test-access-token' },
      { baseUrl: '' },
    ),
    /VITE_BACKEND_URL.*EXPO_PUBLIC_API_BASE_URL/i,
  )
  await assert.rejects(
    requestNoteAi(
      { kind: 'sql', content: 'SELECT 1;', accessToken: 'test-access-token' },
      {
        baseUrl: 'https://api.example.test',
        fetcher: async () => {
          throw new TypeError('offline')
        },
      },
    ),
    /could not be reached/i,
  )
})

test('autosave serializes requests and persists the newest edited revision', async () => {
  let releaseFirst: (() => void) | undefined
  const saves: string[] = []
  const states: SaveState[] = []
  const queue = new AutosaveQueue(
    'initial',
    async (value) => {
      saves.push(value)
      if (value === 'older') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
    },
    (state) => states.push(state),
    60_000,
  )

  queue.edit('older')
  const inFlight = queue.flush()
  queue.edit('newer')
  assert.deepEqual(saves, ['older'])
  releaseFirst?.()
  await inFlight

  assert.deepEqual(saves, ['older', 'newer'])
  assert.equal(states.at(-1), 'saved')
  queue.dispose()
})

test('autosave failure keeps the draft dirty and retry confirms the save', async () => {
  const states: SaveState[] = []
  let calls = 0
  const queue = new AutosaveQueue(
    'initial',
    async () => {
      calls += 1
      if (calls === 1) throw new Error('offline')
    },
    (state) => states.push(state),
    60_000,
  )
  queue.edit('draft')
  await queue.flush()
  assert.equal(states.at(-1), 'failed')
  await queue.retry()
  assert.equal(calls, 2)
  assert.equal(states.at(-1), 'saved')
  queue.dispose()
})

test('local draft cache is scoped and validates recovery data', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
  writeCachedDraft(storage, 'user/one', 'note:one', {
    baseUpdatedAt: '2026-10-16T12:00:00Z',
    value: draft,
  })
  const key = draftStorageKey('user/one', 'note:one')
  assert.match(key, /^shyam-notes-draft:user%2Fone:note%3Aone$/)
  assert.deepEqual(readCachedDraft(storage, 'user/one', 'note:one'), {
    baseUpdatedAt: '2026-10-16T12:00:00Z',
    value: draft,
  })
  assert.deepEqual(
    parseCachedDraft(serializeCachedDraft({
      baseUpdatedAt: '2026-10-16T12:00:00Z',
      value: draft,
    })),
    { baseUpdatedAt: '2026-10-16T12:00:00Z', value: draft },
  )
  values.set(key, '{"baseUpdatedAt":"now","value":{"title":"malformed"}}')
  assert.equal(readCachedDraft(storage, 'user/one', 'note:one'), null)
  assert.equal(readCachedDraft(null, 'user/one', 'note:one'), null)
})

test('Markdown preview encodes raw HTML and does not render executable markup', () => {
  const markup = renderToStaticMarkup(
    MarkdownPreview({
      source: '<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>',
    }),
  )
  assert.equal(markup.includes('<img'), false)
  assert.equal(markup.includes('<script'), false)
  assert.match(markup, /&lt;img/)
  assert.match(markup, /&lt;script/)
})

test('AI requests send only the expected source and bearer auth, with safe failures', async () => {
  let requestedUrl = ''
  let requestedBody = ''
  let requestedAuthorization = ''
  const result = await requestNoteAi(
    {
      kind: 'sql',
      content: 'SELECT 1;',
      accessToken: 'test-access-token',
    },
    {
      baseUrl: 'https://api.example.test/',
      fetcher: async (input, init) => {
        requestedUrl = String(input)
        requestedBody = String(init?.body)
        requestedAuthorization = new Headers(init?.headers).get('authorization') ?? ''
        return new Response(
          JSON.stringify({ output: 'Illustrative', evaluation: 'Review' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    },
  )
  assert.deepEqual(result, {
    output: 'Illustrative',
    evaluation: 'Review',
  })
  assert.equal(requestedUrl, 'https://api.example.test/api/notes/evaluate-sql')
  assert.deepEqual(JSON.parse(requestedBody), { sql: 'SELECT 1;' })
  assert.equal(requestedAuthorization, 'Bearer test-access-token')

  await assert.rejects(
    requestNoteAi(
      {
        kind: 'markdown',
        content: '<script>source stays in editor</script>',
        accessToken: 'test-access-token',
      },
      {
        baseUrl: 'https://api.example.test',
        fetcher: async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'UPSTREAM_FAILURE',
                message: 'The AI request could not be completed.',
              },
            }),
            { status: 502 },
          ),
      },
    ),
    /The AI request could not be completed/,
  )
})
