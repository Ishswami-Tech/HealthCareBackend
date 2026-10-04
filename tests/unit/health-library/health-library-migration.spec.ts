/// <reference types="jest" />

/**
 * Migration column coverage: `CREATE TABLE/TYPE IF NOT EXISTS` alone keeps an older
 * `prisma db push` shape untouched, so the migration must ALSO assert every
 * non-key column (ADD COLUMN IF NOT EXISTS) and every enum value (ADD VALUE IF NOT
 * EXISTS) of the HealthLibraryPost model, with the definition Prisma would emit.
 * This spec derives all expectations from schema.prisma, so a new model field that
 * the migration forgets fails here instead of 500-ing in production.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const BACKEND_ROOT = resolve(__dirname, '../../..');
const PRISMA_DIR = resolve(BACKEND_ROOT, 'src/libs/infrastructure/database/prisma');
const SCHEMA_PATH = resolve(PRISMA_DIR, 'schema.prisma');
const MIGRATION_PATH = resolve(
  PRISMA_DIR,
  'migrations/20261003000000_add_health_library_posts/migration.sql'
);

const MODEL_NAME = 'HealthLibraryPost';
const SCALAR_SQL_TYPES: Readonly<Record<string, string>> = {
  String: 'TEXT',
  Int: 'INTEGER',
  DateTime: 'TIMESTAMP(3)',
  Json: 'JSONB',
  Boolean: 'BOOLEAN',
  Float: 'DOUBLE PRECISION',
};

interface ModelColumn {
  field: string;
  column: string;
  /** Postgres type, quoted for enums. */
  sqlType: string;
  enumName: string | null;
  isKey: boolean;
  /** `<type>[ NOT NULL][ DEFAULT x]` exactly as Prisma emits it. */
  definition: string;
}

interface ModelRelation {
  /** Column holding the foreign key. */
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

interface ParsedModel {
  table: string;
  columns: ModelColumn[];
  enums: Map<string, string[]>;
  indexes: string[][];
  relations: ModelRelation[];
}

const normalizeSql = (sql: string): string =>
  sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();

function blockLines(schema: string, keyword: 'model' | 'enum', name: string): string[] {
  const match = new RegExp(`^${keyword}\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  if (!match) {
    throw new Error(`${keyword} ${name} not found in schema.prisma`);
  }
  return (match[1] ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('//'));
}

function mapName(attributes: string, fallback: string): string {
  return /@map\("([^"]+)"\)/.exec(attributes)?.[1] ?? fallback;
}

function sqlDefault(attributes: string, enumName: string | null): string | null {
  const expression = /@default\(((?:[^()]|\([^()]*\))*)\)/.exec(attributes)?.[1]?.trim();
  if (expression === undefined) return null;
  if (expression === 'now()') return 'CURRENT_TIMESTAMP';
  if (/^-?\d+(\.\d+)?$/.test(expression)) return expression;
  if (expression === 'true' || expression === 'false') return expression.toUpperCase();
  const quoted = /^"(.*)"$/.exec(expression);
  if (quoted) return `'${quoted[1] ?? ''}'`;
  if (enumName && /^\w+$/.test(expression)) return `'${expression}'`;
  throw new Error(`Unsupported @default(${expression}) - extend the spec's default mapping`);
}

function parseModel(schema: string): ParsedModel {
  const modelNames = new Set([...schema.matchAll(/^model\s+(\w+)/gm)].map(match => match[1] ?? ''));
  const enumNames = new Set([...schema.matchAll(/^enum\s+(\w+)/gm)].map(match => match[1] ?? ''));
  const lines = blockLines(schema, 'model', MODEL_NAME);

  const columns: ModelColumn[] = [];
  const enums = new Map<string, string[]>();
  const indexes: string[][] = [];
  const relations: ModelRelation[] = [];
  let table = MODEL_NAME;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      table = mapName(line.startsWith('@@map') ? line : '', table);
      const index = /^@@index\(\[([^\]]+)\]\)/.exec(line)?.[1];
      if (index) {
        indexes.push(index.split(',').map(part => part.trim()));
      }
      continue;
    }
    const field = /^(\w+)\s+(\w+)(\[\])?(\?)?(?:\s+(.*))?$/.exec(line);
    if (!field) {
      throw new Error(`Cannot parse schema line: ${line}`);
    }
    const [, name = '', type = '', list, optional, attributes = ''] = field;
    if (modelNames.has(type)) {
      const relation = /@relation\(fields:\s*\[(\w+)\],\s*references:\s*\[(\w+)\]\)/.exec(
        attributes
      );
      if (relation) {
        const target = blockLines(schema, 'model', type);
        const targetTable = mapName(target.find(entry => entry.startsWith('@@map')) ?? '', type);
        relations.push({
          column: relation[1] ?? '',
          referencedTable: targetTable,
          referencedColumn: relation[2] ?? '',
        });
      }
      continue;
    }
    if (list) {
      throw new Error(`List scalar ${name} is not supported by this spec`);
    }
    const enumName = enumNames.has(type) ? type : null;
    const baseType = enumName ? `"${enumName}"` : SCALAR_SQL_TYPES[type];
    if (!baseType) {
      throw new Error(`Unmapped Prisma type ${type} for ${name} - extend the spec's type mapping`);
    }
    if (enumName && !enums.has(enumName)) {
      enums.set(
        enumName,
        blockLines(schema, 'enum', enumName).filter(entry => /^\w+$/.test(entry))
      );
    }
    const isKey = /@id\b/.test(attributes);
    // Key defaults (uuid()/cuid()) are generated by Prisma, not by the database.
    const defaultSql = isKey ? null : sqlDefault(attributes, enumName);
    columns.push({
      field: name,
      column: mapName(attributes, name),
      sqlType: baseType,
      enumName,
      isKey,
      definition: `${baseType}${optional ? '' : ' NOT NULL'}${defaultSql ? ` DEFAULT ${defaultSql}` : ''}`,
    });
  }

  return { table, columns, enums, indexes, relations };
}

const addColumnStatement = (table: string, column: ModelColumn): string =>
  `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column.column}" ${column.definition};`;

const addValueStatement = (enumName: string, value: string): string =>
  `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}';`;

function indexStatement(table: string, parts: string[]): { name: string; statement: string } {
  const names = parts.map(part => part.replace(/\(.*\)$/, ''));
  const name = `${table}_${names.join('_')}_idx`;
  const columns = parts
    .map(part => {
      const column = part.replace(/\(.*\)$/, '');
      return /sort:\s*Desc/i.test(part) ? `"${column}" DESC` : `"${column}"`;
    })
    .join(', ');
  return { name, statement: `CREATE INDEX IF NOT EXISTS "${name}" ON "${table}"(${columns});` };
}

function foreignKeyGuard(table: string, relation: ModelRelation): string {
  const name = `${table}_${relation.column}_fkey`;
  return (
    `IF NOT EXISTS ( SELECT 1 FROM pg_constraint WHERE conname = '${name}' ` +
    `AND conrelid = '"${table}"'::regclass ) THEN ALTER TABLE "${table}" ` +
    `ADD CONSTRAINT "${name}" FOREIGN KEY ("${relation.column}") ` +
    `REFERENCES "${relation.referencedTable}"("${relation.referencedColumn}") ` +
    `ON DELETE RESTRICT ON UPDATE CASCADE;`
  );
}

const missingFrom = (sql: string, expected: readonly string[]): string[] =>
  expected.filter(statement => !sql.includes(statement));

const schemaText = readFileSync(SCHEMA_PATH, 'utf8');
const model = parseModel(schemaText);
const sql = normalizeSql(readFileSync(MIGRATION_PATH, 'utf8'));
const nonKeyColumns = model.columns.filter(column => !column.isKey);
const createTableBody =
  /CREATE TABLE IF NOT EXISTS "health_library_posts" \( (.*?) \);/.exec(sql)?.[1] ?? '';

describe('health library migration vs schema.prisma', () => {
  it('parses the HealthLibraryPost model (sanity)', () => {
    expect(model.table).toBe('health_library_posts');
    expect(model.columns.map(column => column.column)).toEqual(
      expect.arrayContaining([
        'id',
        'coverImageKey',
        'viewCount',
        'deletedAt',
        'whenToSeeDoctor',
        'updatedAt',
      ])
    );
    expect([...model.enums.keys()].sort()).toEqual([
      'HealthLibraryMediaType',
      'HealthLibraryStatus',
      'HealthLibraryTab',
    ]);
    expect(model.relations.map(relation => relation.column).sort()).toEqual([
      'authorId',
      'clinicId',
    ]);
  });

  describe('columns (self-healing an older table shape)', () => {
    it.each(nonKeyColumns.map(column => [column.column, column] as const))(
      'asserts "%s" with ALTER TABLE ... ADD COLUMN IF NOT EXISTS, exactly as Prisma defines it',
      (_name, column) => {
        expect(sql).toContain(addColumnStatement(model.table, column));
      }
    );

    it('has no ADD COLUMN that is missing IF NOT EXISTS, and none for a column the model lacks', () => {
      expect(sql).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
      const added = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"/g)].map(match => match[1]);
      expect(added.sort()).toEqual(nonKeyColumns.map(column => column.column).sort());
    });

    it.each(model.columns.map(column => [column.column, column] as const))(
      'declares "%s" in CREATE TABLE IF NOT EXISTS for fresh installs',
      (_name, column) => {
        expect(createTableBody).toContain(`"${column.column}" ${column.definition}`);
      }
    );

    it('adds the columns after the table exists and before anything indexes or references them', () => {
      const createTable = sql.indexOf('CREATE TABLE IF NOT EXISTS "health_library_posts"');
      const firstAddColumn = sql.indexOf('ADD COLUMN IF NOT EXISTS');
      const lastAddColumn = sql.lastIndexOf('ADD COLUMN IF NOT EXISTS');
      const firstIndex = sql.indexOf('CREATE INDEX');
      const firstForeignKey = sql.indexOf('ADD CONSTRAINT');

      expect(createTable).toBeGreaterThanOrEqual(0);
      expect(firstAddColumn).toBeGreaterThan(createTable);
      expect(firstIndex).toBeGreaterThan(lastAddColumn);
      expect(firstForeignKey).toBeGreaterThan(lastAddColumn);
    });
  });

  describe('enums (self-healing an older enum shape)', () => {
    const enumValues = [...model.enums.entries()].flatMap(([enumName, values]) =>
      values.map(value => [`${enumName}.${value}`, enumName, value] as const)
    );

    it.each(enumValues)(
      'asserts %s with ALTER TYPE ... ADD VALUE IF NOT EXISTS',
      (_label, enumName, value) => {
        expect(sql).toContain(addValueStatement(enumName, value));
      }
    );

    it.each([...model.enums.entries()])(
      'creates %s behind a pg_type guard with the schema values in order',
      (enumName, values) => {
        const list = values.map(value => `'${value}'`).join(', ');
        expect(sql).toContain(
          `IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName}') THEN ` +
            `CREATE TYPE "${enumName}" AS ENUM (${list}); END IF;`
        );
      }
    );

    it('has no ADD VALUE without IF NOT EXISTS and adds values only after the types exist', () => {
      expect(sql).not.toMatch(/ADD VALUE (?!IF NOT EXISTS)/);
      const lastCreateType = sql.lastIndexOf('CREATE TYPE');
      expect(sql.indexOf('ADD VALUE IF NOT EXISTS')).toBeGreaterThan(lastCreateType);
    });
  });

  describe('index and foreign key guards remain', () => {
    it.each(model.indexes.map(parts => [indexStatement(model.table, parts).name, parts] as const))(
      'keeps the guarded index %s',
      (_name, parts) => {
        expect(sql).toContain(indexStatement(model.table, parts).statement);
      }
    );

    it('still drops the superseded index idempotently', () => {
      expect(sql).toContain('DROP INDEX IF EXISTS "health_library_posts_clinicId_status_tab_idx";');
    });

    it.each(model.relations.map(relation => [relation.column, relation] as const))(
      'keeps the pg_constraint-guarded foreign key for %s',
      (_column, relation) => {
        expect(sql).toContain(foreignKeyGuard(model.table, relation));
      }
    );

    it('has no unguarded CREATE TABLE / CREATE INDEX', () => {
      expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
      expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    });
  });

  describe('the spec itself', () => {
    it('would have caught the original IF-NOT-EXISTS-only migration', () => {
      const withoutHealing = normalizeSql(
        readFileSync(MIGRATION_PATH, 'utf8')
          .split(/\r?\n/)
          .filter(line => !/ADD COLUMN IF NOT EXISTS|ADD VALUE IF NOT EXISTS/.test(line))
          .join('\n')
      );

      expect(
        missingFrom(
          withoutHealing,
          nonKeyColumns.map(column => addColumnStatement(model.table, column))
        )
      ).toHaveLength(nonKeyColumns.length);
      expect(
        missingFrom(withoutHealing, [addValueStatement('HealthLibraryStatus', 'ARCHIVED')])
      ).toHaveLength(1);
    });
  });
});
