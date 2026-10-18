import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownPreview } from '../src/components/MarkdownPreview'
import { resolveAppTheme } from '../src/components/ThemeContext'
import { AutosaveQueue, type SaveState } from '../src/lib/autosave'
import { RequestSequence } from '../src/lib/request-sequence'
import {
  appendSqlPracticeToNote,
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
  appendMarkdownToNote,
  convertMarkdownSource,
  getMarkdownBlockSource,
  getStoredMarkdownBlocks,
  parseSafeHtml,
  parseMarkdown,
  removeDuplicateMarkdownFromRoughNotes,
  removeMarkdownBlockFromNote,
  updateMarkdownBlockInNote,
} from '../src/lib/markdown'
import {
  executePracticeSql,
  evaluateSqlWithAi,
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

test('opening the Expo SQL panel has no request and explicit SQL evaluation validates locally', async () => {
  const expoNote = readFileSync(new URL('../app/(app)/note.tsx', import.meta.url), 'utf8')
  assert.match(expoNote, /evaluateSqlWithAi/)
  assert.doesNotMatch(expoNote, /fetchPracticeSqlQuestion|executePracticeSql/)

  let requests = 0
  const fetcher: typeof fetch = async () => {
    requests += 1
    return Response.json({ output: 'One row', evaluation: 'Looks correct.' })
  }
  await assert.rejects(
    evaluateSqlWithAi(
      { question: '', sql: '', accessToken: 'test-access-token' },
      { baseUrl: 'https://api.example.test', fetcher },
    ),
    /Enter a practice question/i,
  )
  await assert.rejects(
    evaluateSqlWithAi(
      { question: 'Return one row.', sql: ' ', accessToken: 'test-access-token' },
      { baseUrl: 'https://api.example.test', fetcher },
    ),
    /Enter a SQL query/i,
  )
  assert.equal(requests, 0)
})

test('SQL evaluation sends only the validated SQL and question with bearer authentication', async () => {
  let target = ''
  let body = ''
  let authorization = ''
  const result = await evaluateSqlWithAi(
    {
      question: 'Return one row.',
      sql: 'SELECT 1;',
      accessToken: 'test-access-token',
    },
    {
      baseUrl: 'https://api.example.test/',
      fetcher: async (input, init) => {
        target = String(input)
        body = String(init?.body)
        authorization = new Headers(init?.headers).get('authorization') ?? ''
        return Response.json({ output: 'One row', evaluation: 'Looks correct.' })
      },
    },
  )
  assert.equal(target, 'https://api.example.test/api/notes/evaluate-sql')
  assert.deepEqual(JSON.parse(body), { sql: 'SELECT 1;', question: 'Return one row.' })
  assert.equal(authorization, 'Bearer test-access-token')
  assert.deepEqual(result, { output: 'One row', evaluation: 'Looks correct.' })
})

test('Gemini evaluation failure preserves the submitted question and SQL', async () => {
  const query = 'SELECT name FROM employees'
  await assert.rejects(
    evaluateSqlWithAi(
      {
        sql: query,
        question: 'List employees.',
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
    /AI request could not be completed/i,
  )

  assert.equal(query, 'SELECT name FROM employees')
})

test('Markdown conversion accepts a valid Gemini response and keeps the call server-scoped', async () => {
  let target = ''
  let body = ''
  let authorization = ''
  let requestId = ''
  const result = await requestNoteAi(
    {
      kind: 'markdown',
      content: '# Source',
      accessToken: 'test-access-token',
    },
    {
      baseUrl: 'https://api.example.test',
      fetcher: async (input, init) => {
        target = String(input)
        body = String(init?.body)
        authorization = new Headers(init?.headers).get('authorization') ?? ''
        requestId = new Headers(init?.headers).get('x-request-id') ?? ''
        return Response.json({ convertedMarkdown: '# Improved notes' })
      },
    },
  )
  assert.deepEqual(result, { convertedMarkdown: '# Improved notes' })
  assert.equal(target, 'https://api.example.test/api/notes/convert-markdown')
  assert.deepEqual(JSON.parse(body), { markdown: '# Source' })
  assert.match(requestId, /^[\w-]{1,64}$/)
  assert.equal(authorization, 'Bearer test-access-token')
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
    /HTTP 502/i,
  )
})

test('AI request surfaces authenticated and upstream HTTP failures', async () => {
  const expectedMessages = new Map([
    [401, /session is missing or expired/i],
    [403, /not authorized/i],
    [404, /endpoint was not found/i],
    [429, /rate limited/i],
    [500, /Backend error 500/i],
    [503, /Backend error 503/i],
  ])
  for (const [status, expected] of expectedMessages) {
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
      expected,
    )
  }
})

test('structured provider failures retain a safe backend code and correlation ID', async () => {
  let requestedId = ''
  let displayedError = ''
  await assert.rejects(
    requestNoteAi(
      {
        kind: 'markdown',
        content: '# Original heading\n\nOriginal paragraph.',
        accessToken: 'test-access-token',
      },
      {
        baseUrl: 'https://backend.example',
        fetcher: async (_input, init) => {
          requestedId = new Headers(init?.headers).get('x-request-id') ?? ''
          return Response.json(
            {
              error: {
                code: 'UPSTREAM_FAILURE',
                message:
                  'The AI request could not be completed. Your note has not been changed.',
              },
            },
            {
              status: 502,
              headers: { 'x-request-id': requestedId },
            },
          )
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      displayedError = error.message
      assert.match(displayedError, /The AI request could not be completed/)
      assert.match(displayedError, /code: UPSTREAM_FAILURE/)
      return true
    },
  )
  assert.match(requestedId, /^[\w-]{1,64}$/)
  assert.ok(displayedError.includes(`request ID: ${requestedId}`))
  assert.equal(displayedError.includes('# Original heading'), false)
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
    /did not return a readable HTTP response/i,
  )
})

test('AI requests reject an absent access token before network access', async () => {
  let requests = 0
  await assert.rejects(
    requestNoteAi(
      { kind: 'markdown', content: '# Source', accessToken: '' },
      {
        baseUrl: 'https://api.example.test',
        fetcher: async () => {
          requests += 1
          return Response.json({ convertedMarkdown: '# Converted' })
        },
      },
    ),
    /session has expired/i,
  )
  assert.equal(requests, 0)
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
  assert.doesNotMatch(markup, /onerror|alert\(1\)/)
})

test('Markdown conversion renders headings, paragraphs, emphasis, and lists as content', () => {
  const source = [
    '# Study Notes',
    '',
    'A first paragraph.',
    'A continued line.',
    '',
    'Use **bold** and *italic* text.',
    '',
    '- First item',
    '- **Second item**',
  ].join('\r\n')
  const converted = convertMarkdownSource(source)
  const blocks = parseMarkdown(converted)
  const markup = renderToStaticMarkup(MarkdownPreview({ source: converted }))

  assert.equal(blocks[0]?.type, 'heading')
  assert.match(markup, /<h1>Study Notes<\/h1>/)
  assert.match(markup, /<p>A first paragraph\.\nA continued line\.<\/p>/)
  assert.match(markup, /<strong>bold<\/strong>/)
  assert.match(markup, /<em>italic<\/em>/)
  assert.match(markup, /<ul>[\s\S]*<li><p>First item<\/p><\/li>/)
  assert.match(markup, /<strong>Second item<\/strong>/)
  assert.doesNotMatch(markup, /# Study Notes/)
})

test('Markdown conversion preserves fenced code, tables, links, and blockquotes', () => {
  const source = [
    '```sql',
    'SELECT salary FROM Employees;',
    '```',
    '',
    '| name | salary |',
    '| --- | ---: |',
    '| Arun | 45000 |',
    '',
    '> Sample-only result',
    '',
    '[Docs](https://example.test/docs)',
  ].join('\n')
  const converted = convertMarkdownSource(source)
  const markup = renderToStaticMarkup(MarkdownPreview({ source: converted }))

  assert.match(markup, /<pre><code aria-label="sql source code">SELECT salary FROM Employees;<\/code><\/pre>/)
  assert.match(markup, /<table>[\s\S]*<th style="text-align:left">name<\/th>[\s\S]*<td style="text-align:left">Arun<\/td>/)
  assert.match(markup, /<blockquote><p>Sample-only result<\/p><\/blockquote>/)
  assert.match(markup, /href="https:\/\/example\.test\/docs"/)
})

test('empty Markdown is rejected without modifying the original source', () => {
  const source = '# Original note\n\nKeep this text.'
  assert.throws(() => convertMarkdownSource(' \n\t'), /Paste Markdown source/)
  assert.equal(source, '# Original note\n\nKeep this text.')
})

test('two Markdown conversions update the same saved file and survive a fresh fetch', async () => {
  let stored: Note = {
    ...sourceNote,
    note_type: 'text',
    title: 'Existing file',
    source_content: 'Keep my rough notes.',
  }
  const methods: string[] = []
  const patches: Record<string, unknown>[] = []
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const method = init?.method ?? 'GET'
        methods.push(method)
        if (url.pathname.endsWith('/notes') && method === 'PATCH') {
          assert.equal(
            url.searchParams.get('id'),
            `eq.${sourceNote.id}`,
          )
          assert.equal(
            url.searchParams.get('owner_id'),
            `eq.${sourceNote.owner_id}`,
          )
          const patch = JSON.parse(String(init?.body)) as Record<string, unknown>
          patches.push(patch)
          stored = {
            ...stored,
            ...patch,
            updated_at: `2026-10-16T12:0${patches.length + 1}:00.000Z`,
          }
          return Response.json(stored)
        }
        if (url.pathname.endsWith('/notes') && method === 'GET') {
          return Response.json(stored)
        }
        throw new Error(`Unexpected notes request: ${method}`)
      },
    },
  })

  let working: EditableNote = {
    ...stored,
    markdown_output: null,
    markdown_converted_source: null,
  }
  const firstAppend = appendMarkdownToNote(
    working,
    '# SQL Joins\n\n**Join** tables.',
  )
  const { block: firstBlock, ...first } = firstAppend
  working = { ...working, ...first }
  let saved = await saveNote(
    client,
    stored.id,
    stored.updated_at,
    working,
    stored.owner_id,
  )
  working = { ...working, ...saved }

  const secondAppend = appendMarkdownToNote(
    working,
    '# SQL Aggregates\n\n`COUNT(*)`',
  )
  const { block: secondBlock, ...second } = secondAppend
  working = { ...working, ...second }
  assert.notEqual(firstBlock.id, secondBlock.id)
  assert.deepEqual(
    getStoredMarkdownBlocks(working.markdown_output).map((block) => block.source),
    ['# SQL Joins\n\n**Join** tables.', '# SQL Aggregates\n\n`COUNT(*)`'],
  )
  saved = await saveNote(
    client,
    stored.id,
    stored.updated_at,
    working,
    stored.owner_id,
  )
  working = { ...working, ...saved }
  const withoutSecond = removeMarkdownBlockFromNote(working, secondBlock.id)
  working = { ...working, ...withoutSecond }
  saved = await saveNote(
    client,
    stored.id,
    stored.updated_at,
    working,
    stored.owner_id,
  )
  const fresh = await getNote(client, sourceNote.id, sourceNote.owner_id)

  assert.equal(saved.id, sourceNote.id)
  assert.equal(saved.file_id, sourceNote.file_id)
  assert.equal(saved.title, 'Existing file')
  assert.equal(saved.note_type, 'text')
  assert.equal(saved.source_content, 'Keep my rough notes.')
  assert.deepEqual(
    getStoredMarkdownBlocks(fresh.markdown_output).map((block) => block.source),
    ['# SQL Joins\n\n**Join** tables.'],
  )
  assert.equal(fresh.markdown_converted_source, '# SQL Joins\n\n**Join** tables.')
  assert.equal(fresh.id, sourceNote.id)
  assert.equal(fresh.file_id, sourceNote.file_id)
  assert.equal(fresh.title, 'Existing file')
  assert.equal(fresh.source_content, 'Keep my rough notes.')
  assert.equal(patches.length, 3)
  assert.deepEqual(methods, ['PATCH', 'PATCH', 'PATCH', 'GET'])
})

test('Markdown append removes legacy duplicate source without touching rough notes', () => {
  assert.equal(
    removeDuplicateMarkdownFromRoughNotes(
      'Keep this rough note.\n\n# Converted\n\nRaw source.',
      '# Converted\n\nRaw source.',
    ),
    'Keep this rough note.',
  )
  assert.equal(
    removeDuplicateMarkdownFromRoughNotes(
      '# Converted\n\nRaw source.',
      '# Converted\n\nRaw source.',
    ),
    '',
  )
  assert.equal(
    removeDuplicateMarkdownFromRoughNotes(
      'Independent rough notes.',
      '# Converted\n\nRaw source.',
    ),
    'Independent rough notes.',
  )
})

test('Markdown renderer decodes stored blocks without showing source serialization', () => {
  const appended = appendMarkdownToNote(
    { markdown_output: null, markdown_converted_source: null },
    '# Formatted heading\n\n**Bold text**',
  )
  const markup = renderToStaticMarkup(
    MarkdownPreview({ source: appended.markdown_output }),
  )
  assert.match(markup, /<h1>Formatted heading<\/h1>/)
  assert.match(markup, /<strong>Bold text<\/strong>/)
  assert.doesNotMatch(markup, /SHYAM-MARKDOWN-BLOCKS|&quot;source&quot;/)
  assert.equal((markup.match(/Formatted heading/g) ?? []).length, 1)
})

test('editing a Markdown block changes only its source and keeps its stable ID and order', () => {
  const initial = appendMarkdownToNote(
    { markdown_output: null, markdown_converted_source: null },
    '# First block',
  )
  const second = appendMarkdownToNote(initial, '```sql\n  SELECT 1;\n```')
  const edited = updateMarkdownBlockInNote(
    second,
    initial.block.id,
    '# Edited first block\n\n**Updated**',
  )
  const blocks = getStoredMarkdownBlocks(edited.markdown_output)

  assert.deepEqual(blocks.map(({ id, source }) => ({ id, source })), [
    { id: initial.block.id, source: '# Edited first block\n\n**Updated**' },
    { id: second.block.id, source: '```sql\n  SELECT 1;\n```' },
  ])
  assert.equal(edited.markdown_converted_source, '# Edited first block\n\n**Updated**\n\n```sql\n  SELECT 1;\n```')
})

test('copy source selects only the requested Markdown block and preserves exact Markdown', () => {
  const codeTableSource = [
    '# SQL sample',
    '',
    '  ```sql',
    '    SELECT *',
    '    FROM users;',
    '  ```',
    '',
    '| name | total |',
    '| --- | ---: |',
    '| Sam | **3** |',
  ].join('\n')
  const first = appendMarkdownToNote(
    { markdown_output: null, markdown_converted_source: null },
    codeTableSource,
  )
  const second = appendMarkdownToNote(first, '# Neighbour block')

  assert.equal(
    getMarkdownBlockSource(second.markdown_output, first.block.id),
    codeTableSource,
  )
  assert.equal(
    getMarkdownBlockSource(second.markdown_output, second.block.id),
    '# Neighbour block',
  )
})

test('editing a Markdown block does not append another block', () => {
  const first = appendMarkdownToNote(
    { markdown_output: null, markdown_converted_source: null },
    '# Original',
  )
  const second = appendMarkdownToNote(first, '# Neighbour')
  const updated = updateMarkdownBlockInNote(
    second,
    first.block.id,
    '# Revised',
  )
  const blocks = getStoredMarkdownBlocks(updated.markdown_output)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0]?.id, first.block.id)
  assert.equal(blocks[0]?.source, '# Revised')
  assert.equal(blocks[1]?.id, second.block.id)
  assert.equal(blocks[1]?.source, '# Neighbour')
})

test('full Markdown renderer retains tables, nested lists, inline syntax and fenced code', () => {
  const source = [
    '# Heading level one',
    '## Heading level two',
    '',
    '**bold _bold italic_** and *italic* and ~~removed~~ plus `inline()`.',
    '',
    '| Left | Center | Right |',
    '| :--- | :---: | ---: |',
    '| a | b | c |',
    '',
    '- parent',
    '  - child',
    '    1. nested ordered',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    '```javascript',
    'function run() {',
    '  return 1;',
    '}',
    '```',
    '',
    '> quoted **text**',
    '',
    '---',
    '',
    '[safe](https://example.test/path)',
  ].join('\n')
  const markup = renderToStaticMarkup(MarkdownPreview({ source }))

  assert.match(markup, /<h1>Heading level one<\/h1>/)
  assert.match(markup, /<h2>Heading level two<\/h2>/)
  assert.match(markup, /<table>/)
  assert.match(markup, /text-align:left/)
  assert.match(markup, /text-align:center/)
  assert.match(markup, /text-align:right/)
  assert.match(markup, /<ul>[\s\S]*<li><p>parent<\/p><ul>[\s\S]*child/)
  assert.match(markup, /type="checkbox"[^>]*checked=""/)
  assert.match(markup, /type="checkbox"/)
  assert.doesNotMatch(markup, /\[x\]|\[ \]/)
  assert.match(markup, /<strong>bold <em>bold italic<\/em><\/strong>/)
  assert.match(markup, /<del>removed<\/del>/)
  assert.match(markup, /<code>inline\(\)<\/code>/)
  assert.match(markup, /data-language="javascript"/)
  assert.match(markup, /function run\(\) \{\n\s{2}return 1;\n\}/)
  assert.match(markup, /<blockquote>/)
  assert.match(markup, /<hr\/>/)
  assert.match(markup, /href="https:\/\/example\.test\/path"/)
})

test('safe HTML panels and inline formatting render without executing unsupported content', () => {
  const source = [
    'Text before the panel.',
    '',
    '<div style="background-color:#dbeafe;color:#1e3a8a;padding:12px;border:1px solid #2563eb;border-radius:8px"><strong>Blue panel</strong> with <span style="color:purple">colored text</span></div>',
    '',
    '<u>underlined</u> and <kbd>Ctrl</kbd>',
    '',
    '<script>alert(1)</script>',
    '',
    '<unknown onclick="alert(1)">safe text</unknown>',
    '',
    'Text after the panel.',
  ].join('\n')
  const markup = renderToStaticMarkup(MarkdownPreview({ source }))
  const expoRenderer = readFileSync(
    new URL('../src/components/ExpoMarkdownPreview.tsx', import.meta.url),
    'utf8',
  )

  assert.match(markup, /Text before the panel\./)
  assert.match(markup, /Text after the panel\./)
  assert.match(markup, /class="markdown-html-panel"/)
  assert.match(markup, /background-color:#dbeafe/)
  assert.match(markup, /color:#1e3a8a/)
  assert.match(markup, /border-color:#2563eb/)
  assert.match(markup, /<u>underlined<\/u>/)
  assert.match(markup, /class="markdown-kbd">Ctrl<\/kbd>/)
  assert.match(expoRenderer, /parseSafeHtml\(/)
  assert.match(expoRenderer, /node\.tag === 'div'/)
  assert.match(expoRenderer, /node\.tag === 'u' && styles\.underline/)
  assert.match(expoRenderer, /node\.tag === 'kbd' && styles\.kbd/)
  assert.doesNotMatch(expoRenderer, /Unsupported HTML displayed as text/)
  assert.match(markup, /safe text/)
  assert.doesNotMatch(markup, /Unsupported HTML displayed as text/)
  assert.doesNotMatch(markup, /onclick|alert\(1\)|<script>/)
  const parsed = parseSafeHtml('<img src="javascript:alert(1)" onerror="alert(1)">plain')
  assert.deepEqual(parsed, [{ tag: '#text', text: 'plain' }])
})

test('fenced SQL, JavaScript, JSON, and Mermaid remain readable code, not Markdown', () => {
  const source = [
    '```sql',
    'SELECT *',
    '  FROM notes;',
    '```',
    '```javascript',
    'const answer = 42;',
    '```',
    '```json',
    '{ "answer": 42 }',
    '```',
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```',
    '$$E = mc^2$$',
  ].join('\n')
  const markup = renderToStaticMarkup(MarkdownPreview({ source }))
  assert.match(markup, /data-language="sql"/)
  assert.match(markup, /data-language="javascript"/)
  assert.match(markup, /data-language="json"/)
  assert.match(markup, /data-language="mermaid"/)
  assert.match(markup, /SELECT \*\n {2}FROM notes;/)
  assert.match(markup, /\{ &quot;answer&quot;: 42 \}/)
  assert.match(markup, /graph TD\n {2}A --&gt; B/)
  assert.doesNotMatch(markup, />sql<\/div>|>javascript<\/div>|<svg/)
  assert.match(markup, /\$\$E = mc\^2\$\$/)
  assert.match(markup, /class="markdown-math-fallback"/)
})

test('Markdown code blocks, task markers, quote, and horizontal rule keep semantic layout', () => {
  const source = [
    '- [x] checked task',
    '- [ ] unchecked task',
    '',
    '1. ordered parent',
    '   1. ordered child',
    '      - nested bullet',
    '',
    '> quote with **emphasis**',
    '',
    '---',
  ].join('\n')
  const markup = renderToStaticMarkup(MarkdownPreview({ source }))
  assert.match(markup, /class="markdown-task-item"/)
  assert.match(markup, /<input[^>]*checked=""/)
  assert.match(markup, /checked task/)
  assert.match(markup, /unchecked task/)
  assert.match(markup, /<ol[^>]*>[\s\S]*<ol[^>]*>[\s\S]*<ul>/)
  assert.match(markup, /<blockquote><p>quote with <strong>emphasis<\/strong><\/p><\/blockquote>/)
  assert.match(markup, /<hr\/>/)
  assert.doesNotMatch(markup, /\[x\]|\[ \]/)
  assert.doesNotMatch(markup, /Unsupported HTML/)
})

test('inline HTML breaks render as line breaks, not raw tags', () => {
  const markup = renderToStaticMarkup(
    MarkdownPreview({ source: 'first<br>second' }),
  )
  assert.match(markup, /first<br\/>second/)
  assert.doesNotMatch(markup, /<script>/)
})

test('failed Markdown edit save retains existing rendered block and retry source', async () => {
  const appended = appendMarkdownToNote(
    { markdown_output: null, markdown_converted_source: null },
    '# Saved version',
  )
  const edited = updateMarkdownBlockInNote(
    appended,
    appended.block.id,
    '# User edit',
  )
  const noteBefore = {
    ...sourceNote,
    markdown_output: appended.markdown_output,
    markdown_converted_source: appended.markdown_converted_source,
  }
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async () => Response.json({ message: 'denied' }, { status: 403 }),
    },
  })
  await assert.rejects(
    saveNote(client, noteBefore.id, noteBefore.updated_at, edited, noteBefore.owner_id),
    /could not be saved/,
  )
  assert.equal(getMarkdownBlockSource(noteBefore.markdown_output, appended.block.id), '# Saved version')
  assert.equal(getStoredMarkdownBlocks(edited.markdown_output)[0]?.source, '# User edit')
})

test('failed Markdown block deletion preserves the persisted block', async () => {
  const appended = appendMarkdownToNote(
    { markdown_output: null, markdown_converted_source: null },
    '# Keep this block',
  )
  const noteBefore = {
    ...sourceNote,
    markdown_output: appended.markdown_output,
    markdown_converted_source: appended.markdown_converted_source,
  }
  const client = createClient('https://supabase.example.test', 'test-publishable-key', {
    global: {
      fetch: async () => Response.json({ message: 'denied' }, { status: 403 }),
    },
  })
  const deletion = removeMarkdownBlockFromNote(noteBefore, appended.block.id)
  await assert.rejects(
    saveNote(
      client,
      noteBefore.id,
      noteBefore.updated_at,
      deletion,
      noteBefore.owner_id,
    ),
    /could not be saved/,
  )
  assert.deepEqual(getStoredMarkdownBlocks(noteBefore.markdown_output), [
    appended.block,
  ])
})

test('Markdown blocks edit inline while copy and delete controls remain', () => {
  const notesScreen = readFileSync(
    new URL('../app/(app)/notes.tsx', import.meta.url),
    'utf8',
  )
  const editorScreen = readFileSync(
    new URL('../app/(app)/note.tsx', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(notesScreen, /Add MD Converter|createMarkdownNote|markdownPreviewCard/)
  assert.doesNotMatch(notesScreen, /markdownFileId|markdownDraft|markdownBusy/)
  assert.doesNotMatch(editorScreen, /createMarkdownNote|noteRouteForSelection/)
  const convertHandler = editorScreen.match(
    /async function convertMarkdown\(\) \{([\s\S]*?)\n {2}\}/,
  )?.[1]
  assert.ok(convertHandler)
  assert.match(convertHandler, /appendMarkdownToNote\(current, input\)/)
  assert.match(convertHandler, /await saveMarkdownValue\(currentNote, next\)/)
  assert.match(convertHandler, /await queue\.flush\(\)/)
  assert.match(convertHandler, /setMarkdownOpen\(false\)[\s\S]*?setMarkdownDraft\(''\)/)
  assert.match(convertHandler, /catch \(error\)[\s\S]*?setMarkdownError\(/)
  assert.doesNotMatch(convertHandler, /\.insert\(|\.delete\(|router\.(push|replace)\(/)
  assert.match(convertHandler, /pendingMarkdownSave\.current = \{ source: input, blockId: block\.id \}/)
  assert.match(convertHandler, /pendingMarkdownSave\.current = null[\s\S]*?setMarkdownOpen\(false\)/)
  const failedSaveHandler = convertHandler.slice(
    convertHandler.indexOf('} catch (error)'),
  )
  assert.doesNotMatch(
    failedSaveHandler,
    /setMarkdownDraft\(['"]['"]\)|setMarkdownOpen\(false\)|pendingMarkdownSave\.current = null/,
  )
  assert.match(editorScreen, /setMarkdownDraft\(''\)[\s\S]*?setMarkdownError\(''\)[\s\S]*?setMarkdownOpen\(true\)/)
  assert.match(editorScreen, /if \(markdownBusyLock\.current\) return/)
  assert.match(editorScreen, /pending\.source === input/)
  assert.match(editorScreen, /markdownBusy \? 'Saving…' : 'Convert Notes'/)
  assert.match(editorScreen, /getStoredMarkdownBlocks\(value\.markdown_output\)\.map/)
  assert.match(editorScreen, /accessibilityLabel=\{`Copy Markdown block \$\{index \+ 1\}`\}/)
  assert.match(editorScreen, /accessibilityLabel=\{`Edit Markdown block \$\{index \+ 1\}`\}[\s\S]*?onPress=\{\(\) => editMarkdownBlock\(block\)\}/)
  assert.match(editorScreen, /markdownInlineEditor/)
  assert.doesNotMatch(editorScreen, /✎/)
  assert.match(editorScreen, /onPress=\{\(\) => void copyMarkdownBlock\(block\.id\)\}/)
  assert.match(editorScreen, /Clipboard\.setStringAsync\(source\)/)
  assert.match(editorScreen, /updateMarkdownBlockInNote\(current, blockId, markdownEditDraft\)/)
  assert.match(editorScreen, /Save the current note before editing this Markdown block/)
  assert.match(editorScreen, /markdownBusy \? 'Saving…' : 'Save'/)
  assert.doesNotMatch(editorScreen, /Convert and Save|accessibilityLabel=\{`Edit Markdown source|markdownEditModal/)
  assert.match(editorScreen, /Delete Markdown block \$\{index \+ 1\}/)
  assert.match(editorScreen, /onPress=\{\(\) => void deleteMarkdownBlock\(block\.id\)\}/)
  const deleteHandler = editorScreen.match(
    /async function deleteMarkdownBlock\(blockId: string\) \{([\s\S]*?)\n {2}\}/,
  )?.[1]
  assert.ok(deleteHandler)
  assert.match(deleteHandler, /removeMarkdownBlockFromNote\(current, blockId\)/)
  assert.match(deleteHandler, /await saveMarkdownValue\(currentNote, next\)/)
  assert.match(deleteHandler, /catch \(error\)[\s\S]*?setSaveError\(/)
  assert.doesNotMatch(deleteHandler, /setValue\(|valueRef\.current\s*=/)
  assert.match(editorScreen, /editable=\{!markdownBusy\}/)
  assert.match(editorScreen, /source_content: removeDuplicateMarkdownFromRoughNotes\(/)
  assert.match(editorScreen, /accessibilityLabel="Note content"/)
  assert.ok(
    editorScreen.indexOf('getStoredMarkdownBlocks(value.markdown_output).map') <
      editorScreen.indexOf('accessibilityLabel="Note content"'),
  )
  assert.match(editorScreen, /async function leaveEditor\(\) \{\s*if \(markdownBusyLock\.current\)/)
  assert.match(editorScreen, /async function confirmDeleteNote\(\) \{\s*if \(!client \|\| !session \|\| !noteRef\.current \|\| deleteBusyLock\.current\) return\s*if \(markdownBusyLock\.current\)/)
  for (const label of ['SQL', 'Markdown', 'Copy Note', 'Delete Note']) {
    assert.match(editorScreen, new RegExp(`<IconAction label="${label}"`))
  }
  assert.match(editorScreen, /function openMarkdownEditor\(\) \{[\s\S]*?setMarkdownOpen\(true\)/)
  assert.match(editorScreen, /accessibilityLabel="Markdown input"/)
  assert.match(editorScreen, /Convert Notes/)
  assert.match(editorScreen, /onPress=\{cancelMarkdownEditor\}/)
  assert.doesNotMatch(editorScreen, /Delete converted content/)
  assert.doesNotMatch(editorScreen, /setMarkdownResult/)
  assert.match(convertHandler, /if \(markdownBusyLock\.current\) return/)
  assert.doesNotMatch(editorScreen, /requestNoteAi/)
})

test('note editor has an outer page scroll and an independent bounded note-content scroll', () => {
  const editorScreen = readFileSync(
    new URL('../app/(app)/note.tsx', import.meta.url),
    'utf8',
  )
  const styles = editorScreen.slice(editorScreen.indexOf('const styles = StyleSheet.create'))
  const appCss = readFileSync(new URL('../src/note-editor.css', import.meta.url), 'utf8')
  const rootLayout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8')
  const pageHeader = editorScreen.indexOf('<View style={styles.header}>')
  const editorHeader = editorScreen.indexOf('<View style={styles.editorHeader}>')
  const title = editorScreen.indexOf('accessibilityLabel="Note title"')
  const contentScroll = editorScreen.indexOf('<ScrollView', title)
  const markdownBlocks = editorScreen.indexOf('getStoredMarkdownBlocks(value.markdown_output).map', contentScroll)
  const noteContent = editorScreen.indexOf('accessibilityLabel="Note content"')
  const contentScrollEnd = editorScreen.indexOf('</ScrollView>', noteContent)
  const sqlPanel = editorScreen.indexOf('{sqlOpen ? (', contentScrollEnd)

  assert.match(editorScreen, /<ExpoScreen scroll>\s*<View style=\{\[styles\.page/)
  assert.ok(pageHeader >= 0 && pageHeader < editorHeader)
  assert.ok(editorHeader >= 0 && editorHeader < title)
  assert.ok(title < contentScroll && contentScroll < markdownBlocks)
  assert.ok(markdownBlocks < noteContent && noteContent < contentScrollEnd && contentScrollEnd < sqlPanel)
  assert.match(editorScreen, /nativeID="note-editor-content-scroll"[\s\S]*?nestedScrollEnabled/)
  assert.match(editorScreen, /maxHeight: noteContentMaxHeight/)
  assert.match(editorScreen, /Math\.max\(180, Math\.min\(windowHeight \* 0\.65, 680\)\)/)
  assert.match(rootLayout, /import '\.\.\/src\/note-editor\.css'/)
  assert.doesNotMatch(editorScreen, /fixedEditorHeader|editorScroll/)
  assert.match(editorScreen, /styles\.header[\s\S]*?<IconAction label="SQL"[\s\S]*?<IconAction label="Markdown"[\s\S]*?<IconAction label="Copy Note"[\s\S]*?<IconAction label="Delete Note"[\s\S]*?<ThemeToggle \/>[\s\S]*<SaveIndicator/)
  assert.match(styles, /page: \{[^}]*maxWidth: 920/)
  assert.match(styles, /editorHeader: \{ gap: 8 \}/)
  assert.match(styles, /noteContentScroll: \{ flexGrow: 0, flexShrink: 1, width: '100%' \}/)
  assert.match(appCss, /#note-editor-content-scroll\s*\{[^}]*overscroll-behavior-y: contain;/)
  assert.doesNotMatch(styles, /fixedEditorHeader|editorScroll/)
})

test('Markdown collapse is independent by stable block ID and animates accessibly', () => {
  const editorScreen = readFileSync(
    new URL('../app/(app)/note.tsx', import.meta.url),
    'utf8',
  )
  const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  const bodyStart = editorScreen.indexOf('function AnimatedMarkdownBody')
  const bodyEnd = editorScreen.indexOf('\nfunction IconAction', bodyStart)
  const animatedBody = editorScreen.slice(bodyStart, bodyEnd)
  const toggleStart = editorScreen.indexOf('function MarkdownBlockToggle')
  const toggleEnd = editorScreen.indexOf('\nfunction IconAction', toggleStart)
  const toggleComponent = editorScreen.slice(toggleStart, toggleEnd)
  const blockStart = editorScreen.indexOf('getStoredMarkdownBlocks(value.markdown_output).map')
  const blockEnd = editorScreen.indexOf('{markdownOpen ?', blockStart)
  const blockList = editorScreen.slice(blockStart, blockEnd)
  const editStart = editorScreen.indexOf('function editMarkdownBlock(')
  const editEnd = editorScreen.indexOf('\n  async function saveMarkdownBlockEdit', editStart)
  const editHandler = editorScreen.slice(editStart, editEnd)
  const deleteStart = editorScreen.indexOf('async function deleteMarkdownBlock(')
  const deleteEnd = editorScreen.indexOf('\n  function editMarkdownBlock', deleteStart)
  const deleteHandler = editorScreen.slice(deleteStart, deleteEnd)

  assert.match(editorScreen, /useState<Record<string, boolean>>\(\{\}\)/)
  assert.match(blockList, /collapsedMarkdownBlocks\[block\.id\]/)
  assert.doesNotMatch(blockList, /collapsedMarkdownBlocks\[index\]|collapsedMarkdownBlocks\[block\.source\]/)
  assert.match(toggleComponent, /accessibilityState=\{\{ expanded: !collapsed, disabled \}\}/)
  assert.match(toggleComponent, /accessibilityLabel=\{label\}/)
  assert.match(toggleComponent, /onFocus=\{\(\) => setShowTooltip\(true\)\}/)
  assert.match(toggleComponent, /{label}/)
  assert.ok(blockList.indexOf('Copy Markdown block') < blockList.indexOf('<AnimatedMarkdownBody'))
  assert.ok(blockList.indexOf('Delete Markdown block') < blockList.indexOf('<AnimatedMarkdownBody'))
  assert.match(blockList, /onToggle=\{\(\) => setCollapsedMarkdownBlocks\(\(current\) => \(\{[\s\S]*?\[block\.id\]: !current\[block\.id\]/)
  assert.match(editHandler, /setCollapsedMarkdownBlocks\(\(current\) => \(\{ \.\.\.current, \[block\.id\]: false \}\)\)/)
  assert.ok(editHandler.indexOf('[block.id]: false') < editHandler.indexOf('setEditingMarkdownBlockId(block.id)'))
  assert.match(animatedBody, /Animated\.timing\(progress/)
  assert.match(animatedBody, /outputRange: \[0, Math\.max\(bodyHeight, 1\)\]/)
  assert.match(animatedBody, /accessibilityElementsHidden=\{collapsed\}/)
  assert.match(animatedBody, /importantForAccessibility=\{collapsed \? 'no-hide-descendants' : 'auto'\}/)
  assert.match(animatedBody, /AccessibilityInfo\.isReduceMotionEnabled/)
  assert.match(animatedBody, /duration: reduceMotion \? 0 : 180/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(editorScreen, /delete next\[blockId\]/)
  assert.ok(deleteHandler.indexOf('await saveMarkdownValue(currentNote, next)') < deleteHandler.lastIndexOf('delete next[blockId]'))
  assert.match(blockList, /onPress=\{\(\) => void copyMarkdownBlock\(block\.id\)\}/)
  assert.match(blockList, /onPress=\{\(\) => void deleteMarkdownBlock\(block\.id\)\}/)
  assert.doesNotMatch(editorScreen, /setCollapsedMarkdownBlocks\(\{\}\)/)
})

test('AI requests send only the expected source and bearer auth, with safe failures', async () => {
  let requestedUrl = ''
  let requestedBody = ''
  let requestedAuthorization = ''
  let requestId = ''
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
        requestId = new Headers(init?.headers).get('x-request-id') ?? ''
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
  assert.match(requestId, /^[\w-]{1,64}$/)
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
