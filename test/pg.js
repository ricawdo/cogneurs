/* Base Postgres embarquée (PGlite) pour les tests locaux */
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const fs = require('node:fs'), path = require('node:path');
module.exports = async function startPg(port = 5439) {
  const pg = await PGlite.create();
  await pg.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  const srv = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' });
  await srv.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  process.env.DB_SSL = '0'; process.env.DB_MAX = '1'; process.env.SECURE_COOKIE = '0';
  return { stop: async () => { await srv.stop(); await pg.close(); }, pg };
};
