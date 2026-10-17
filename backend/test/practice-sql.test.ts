import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runPracticeSql } from '../src/practice-sql.js'

test('runs read-only queries against the isolated practice dataset', () => {
  const result = runPracticeSql(
    'SELECT name, salary FROM employees WHERE salary >= 65000 ORDER BY salary DESC',
  )

  assert.deepEqual(result.columns, ['name', 'salary'])
  assert.deepEqual(result.rows, [
    { name: 'Chen', salary: 81000 },
    { name: 'Asha', salary: 72000 },
  ])
  assert.equal(result.truncated, false)
})

test('rejects writes, multiple statements, and unsafe functions', () => {
  for (const sql of [
    'DELETE FROM employees',
    'SELECT 1; SELECT 2',
    'SELECT load_extension("x")',
    'PRAGMA table_info(employees)',
    'SELECT name FROM sqlite_schema',
    "SELECT value FROM json_each('[1,2]')",
    'WITH RECURSIVE loop(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM loop) SELECT value FROM loop',
  ]) {
    assert.throws(() => runPracticeSql(sql))
  }
})

test('caps output rows when SQLite returns more than the limit', () => {
  const result = runPracticeSql(
    'SELECT first.id, second.id, third.id, fourth.id FROM employees first, employees second, employees third, employees fourth',
  )

  assert.equal(result.rows.length, 200)
  assert.equal(result.rowLimit, 200)
  assert.equal(result.truncated, true)
})

test('limits table scans using the SQLite query plan', () => {
  assert.throws(
    () =>
      runPracticeSql(
        'SELECT a.id FROM employees a, employees b, employees c, employees d, employees e',
      ),
    /no more than three joins or table scans/i,
  )
})

test('uses SQLite parser boundaries for comments, quotes and second statements', () => {
  const result = runPracticeSql(
    "-- a leading comment\nSELECT 'value;still one statement' AS label; /* trailing comment */",
  )
  assert.deepEqual(result.rows, [{ label: 'value;still one statement' }])
  assert.throws(() =>
    runPracticeSql('SELECT 1; /* separator */ DELETE FROM employees'),
  )
  assert.throws(() =>
    runPracticeSql('SELECT 1; /* unterminated trailing comment'),
  )
})
