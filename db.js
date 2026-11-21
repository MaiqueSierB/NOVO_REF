import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jogos (
    id          INTEGER PRIMARY KEY,      -- id da partida na football-data.org
    temporada   INTEGER,
    rodada      INTEGER,
    data_utc    TEXT NOT NULL,            -- ISO 8601
    status      TEXT NOT NULL,            -- SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, POSTPONED...
    casa        TEXT NOT NULL,
    fora        TEXT NOT NULL,
    gols_casa   INTEGER,
    gols_fora   INTEGER,
    anunciado   INTEGER NOT NULL DEFAULT 0 -- 1 quando o resultado já foi anunciado no canal
  );

  CREATE TABLE IF NOT EXISTS palpites (
    jogo_id     INTEGER NOT NULL REFERENCES jogos(id),
    user_id     TEXT NOT NULL,
    username    TEXT,
    gols_casa   INTEGER NOT NULL,
    gols_fora   INTEGER NOT NULL,
    pontos      INTEGER,                  -- NULL até o jogo terminar
    atualizado  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (jogo_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS estado (
    chave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jogos_rodada ON jogos(temporada, rodada);
  CREATE INDEX IF NOT EXISTS idx_palpites_user ON palpites(user_id);
`);

export function getEstado(chave) {
    return db.prepare('SELECT valor FROM estado WHERE chave = ?').get(chave)?.valor ?? null;
}

export function setEstado(chave, valor) {
    db.prepare('INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
        .run(chave, String(valor));
}

export default db;
