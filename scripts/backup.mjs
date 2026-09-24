import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.ABC_DB || resolve(root, 'data/abc.sqlite');
const destination = process.argv[2];
if (!destination || !existsSync(source) || existsSync(destination)) {
  console.error('Usage: node scripts/backup.mjs /path/to/new-backup.sqlite (source must exist; target must not exist)');
  process.exit(1);
}
mkdirSync(dirname(resolve(destination)), { recursive: true });
const db = new DatabaseSync(source);
try { await backup(db, destination); console.log('Consistent SQLite backup created:', resolve(destination)); }
finally { db.close(); }
