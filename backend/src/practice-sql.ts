import {
  DatabaseSync,
  constants,
  type SQLInputValue,
  type SQLOutputValue,
} from 'node:sqlite'

const maxQueryLength = 10_000
const maxResultRows = 200
const maxTableScans = 4
const allowedFunctions = new Set([
  'abs',
  'avg',
  'coalesce',
  'count',
  'date',
  'datetime',
  'ifnull',
  'instr',
  'julianday',
  'length',
  'lower',
  'max',
  'min',
  'nullif',
  'round',
  'strftime',
  'substr',
  'sum',
  'time',
  'total',
  'trim',
  'typeof',
  'upper',
])
const allowedTables = new Set(['employees', 'departments'])

export type PracticeSqlResult = {
  columns: string[]
  rows: Array<Record<string, string | number | boolean | null>>
  rowLimit: number
  truncated: boolean
}

const practiceTables = [
  {
    name: 'employees',
    columns: [
      ['id', 'INTEGER'],
      ['name', 'TEXT'],
      ['department_id', 'INTEGER'],
      ['salary', 'INTEGER'],
    ],
    rows: [
      [1, 'Asha', 10, 72000],
      [2, 'Ben', 20, 64000],
      [3, 'Chen', 10, 81000],
      [4, 'Diya', 30, 59000],
    ],
  },
  {
    name: 'departments',
    columns: [
      ['id', 'INTEGER'],
      ['name', 'TEXT'],
    ],
    rows: [
      [10, 'Engineering'],
      [20, 'Finance'],
      [30, 'Operations'],
    ],
  },
] as const

export const practiceSqlQuestion = {
  prompt:
    'List each employee name and salary for employees earning at least 65000, ordered by salary from highest to lowest.',
  schema: [
    'employees(id INTEGER, name TEXT, department_id INTEGER, salary INTEGER)',
    'departments(id INTEGER, name TEXT)',
  ],
}

export function runPracticeSql(sql: string): PracticeSqlResult {
  if (!sql.trim() || sql.length > maxQueryLength) {
    throw new Error('Enter a SQL query of no more than 10,000 characters.')
  }
  const database = new DatabaseSync(':memory:', {
    allowExtension: false,
    defensive: true,
    limits: {
      length: 100_000,
      sqlLength: maxQueryLength,
      column: 100,
      exprDepth: 50,
      compoundSelect: 20,
      vdbeOp: 100_000,
      functionArg: 50,
      attach: 0,
    },
  })

  try {
    for (const table of practiceTables) {
      const definitions = table.columns
        .map(([name, type]) => `"${name}" ${type}`)
        .join(', ')
      database.exec(`CREATE TABLE "${table.name}" (${definitions})`)
      const columns = table.columns.map(([name]) => `"${name}"`).join(', ')
      const placeholders = table.columns.map(() => '?').join(', ')
      const insert = database.prepare(
        `INSERT INTO "${table.name}" (${columns}) VALUES (${placeholders})`,
      )
      for (const row of table.rows) {
        insert.run(...(row as unknown as SQLInputValue[]))
      }
    }

    database.setAuthorizer((action, first, second) => {
      if (action === constants.SQLITE_SELECT) {
        return constants.SQLITE_OK
      }
      if (
        action === constants.SQLITE_READ &&
        typeof first === 'string' &&
        allowedTables.has(first.toLowerCase())
      ) {
        return constants.SQLITE_OK
      }
      if (action === constants.SQLITE_RECURSIVE) {
        return constants.SQLITE_DENY
      }
      if (
        action === constants.SQLITE_FUNCTION &&
        typeof second === 'string' &&
        allowedFunctions.has(second.toLowerCase())
      ) {
        return constants.SQLITE_OK
      }
      return constants.SQLITE_DENY
    })

    const statement = database.prepare(sql)
    if (
      !sql.startsWith(statement.sourceSQL) ||
      hasSqlTokens(sql.slice(statement.sourceSQL.length))
    ) {
      throw new Error('Run one SQL statement at a time.')
    }
    const queryPlan = database
      .prepare(`EXPLAIN QUERY PLAN ${statement.sourceSQL}`)
      .all()
    const tableScanCount = queryPlan.filter(
      (step) =>
        typeof step.detail === 'string' &&
        /^(SCAN|SEARCH)\b/.test(step.detail),
    ).length
    if (tableScanCount > maxTableScans) {
      throw new Error('Use no more than three joins or table scans.')
    }
    const columns = statement.columns().map(({ name }) => name)
    const rows: PracticeSqlResult['rows'] = []
    let truncated = false
    for (const row of statement.iterate()) {
      if (rows.length >= maxResultRows) {
        truncated = true
        break
      }
      rows.push(normalizeRow(row))
    }
    return { columns, rows, rowLimit: maxResultRows, truncated }
  } finally {
    database.close()
  }
}

function hasSqlTokens(sql: string): boolean {
  let index = 0
  while (index < sql.length) {
    if (/\s/.test(sql[index])) {
      index += 1
      continue
    }
    if (sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index + 2)
      index = newline === -1 ? sql.length : newline + 1
      continue
    }
    if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2)
      if (end === -1) return true
      index = end + 2
      continue
    }
    return true
  }
  return false
}

function normalizeRow(
  row: Record<string, SQLOutputValue>,
): PracticeSqlResult['rows'][number] {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint'
        ? value.toString()
        : value instanceof Uint8Array
          ? Buffer.from(value).toString('base64')
          : typeof value === 'number' && !Number.isFinite(value)
            ? String(value)
            : value,
    ]),
  ) as PracticeSqlResult['rows'][number]
}
