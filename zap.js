// Vínculo Discord ↔ WhatsApp: o /zap gera um código que a pessoa manda no grupo do Zap.
// O código fica no banco do bot do WhatsApp (mesma conta da Hostinger).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ZAP_DB = process.env.ZAP_DB || '/home/u243267678/domains/mrbnexus.com.br/zap-data/zap.sqlite';
let db = null;

function abrir() {
    if (db) return db;
    fs.mkdirSync(path.dirname(ZAP_DB), { recursive: true });
    db = new Database(ZAP_DB);
    db.pragma('busy_timeout = 5000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS vinculos (
            zap_id TEXT PRIMARY KEY, discord_id TEXT NOT NULL, nome TEXT,
            criado TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS codigos (
            codigo TEXT PRIMARY KEY, discord_id TEXT NOT NULL, nome TEXT, expira INTEGER NOT NULL
        );
    `);
    return db;
}

export function gerarCodigo(discordId, nome) {
    const d = abrir();
    d.prepare('DELETE FROM codigos WHERE discord_id = ? OR expira < ?').run(discordId, Date.now());
    const codigo = String(crypto.randomInt(100000, 1000000));
    d.prepare('INSERT INTO codigos (codigo, discord_id, nome, expira) VALUES (?, ?, ?, ?)')
        .run(codigo, discordId, nome, Date.now() + 10 * 60_000);
    return codigo;
}

export function vinculado(discordId) {
    return abrir().prepare('SELECT COUNT(*) AS n FROM vinculos WHERE discord_id = ?').get(discordId).n > 0;
}
