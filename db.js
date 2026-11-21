import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

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

  CREATE TABLE IF NOT EXISTS tabela (
    posicao   INTEGER PRIMARY KEY,
    time      TEXT NOT NULL,
    jogos     INTEGER, vitorias INTEGER, empates INTEGER, derrotas INTEGER,
    gols_pro  INTEGER, gols_contra INTEGER, saldo INTEGER, pontos INTEGER,
    atualizado TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Time do coração de cada pessoa (chave canônica, ex.: 'flamengo', 'atletico-mg')
  CREATE TABLE IF NOT EXISTS times_favoritos (
    discord_id TEXT PRIMARY KEY,
    time_key   TEXT NOT NULL,
    time_nome  TEXT NOT NULL
  );

  -- Placar ao vivo visto por último (para detectar gol e fim de jogo, inclusive após reinício)
  CREATE TABLE IF NOT EXISTS ao_vivo (
    event_id   TEXT PRIMARY KEY,
    casa TEXT, fora TEXT, casa_key TEXT, fora_key TEXT,
    gols_casa INTEGER, gols_fora INTEGER, estado TEXT,
    atualizado TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Avisos gerados (gol, fim de jogo); o Discord e o Zap marcam o que já enviaram
  CREATE TABLE IF NOT EXISTS eventos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo       TEXT NOT NULL,          -- 'gol' | 'fim'
    times      TEXT NOT NULL,          -- chaves dos times envolvidos, separadas por vírgula
    texto      TEXT NOT NULL,
    criado     TEXT NOT NULL DEFAULT (datetime('now')),
    discord_ok INTEGER NOT NULL DEFAULT 0,
    zap_ok     INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_jogos_rodada ON jogos(temporada, rodada);
  CREATE INDEX IF NOT EXISTS idx_palpites_user ON palpites(user_id);
`);

// Migração: de onde veio o palpite (discord | zap), para auditoria
if (!db.prepare('PRAGMA table_info(palpites)').all().some(c => c.name === 'origem')) {
    db.exec('ALTER TABLE palpites ADD COLUMN origem TEXT');
}

export function getEstado(chave) {
    return db.prepare('SELECT valor FROM estado WHERE chave = ?').get(chave)?.valor ?? null;
}

export function setEstado(chave, valor) {
    db.prepare('INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
        .run(chave, String(valor));
}

export default db;
