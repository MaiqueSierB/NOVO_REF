// Backup diário dos bancos dos bots: uma cópia por dia (por volta das 4h) em backups/AAAA-MM-DD/,
// guardando os últimos 7 dias. Usa "VACUUM INTO", que tira uma cópia consistente mesmo com o bot escrevendo.
// A sessão do WhatsApp NÃO entra (é sensível e, se perder, é só parear de novo).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getEstado, setEstado } from './db.js';

const BASE = process.env.BOTS_DIR || '/home/u243267678/domains/mrbnexus.com.br';
const PASTA = process.env.BACKUP_DIR || `${BASE}/backups`;
const DIAS = Number(process.env.BACKUP_DIAS || 7);
const HORA = Number(process.env.BACKUP_HORA ?? 4);

export const BANCOS = {
    'rmdb.sqlite': process.env.RMDB_DB || `${BASE}/rmdb-data/servidor.sqlite`,
    'rgdb.sqlite': process.env.RGDB_DB || `${BASE}/rgdb-data/servidor.sqlite`,
    'bolao.sqlite': process.env.BOLAO_DB || `${BASE}/bolao-data/bolao.sqlite`,
    'aniversario.sqlite': process.env.ANIV_DB || `${BASE}/aniversario-data/servidor.sqlite`,
    'zap.sqlite': process.env.ZAP_DB || `${BASE}/zap-data/zap.sqlite`,
    'antijanja-resenha.sqlite': process.env.RESENHA_DB || `${BASE}/antijanja-data/resenha.sqlite`,
    'gym.sqlite': process.env.GYM_DB || `${BASE}/gym-data/gym.sqlite`
};

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });   // AAAA-MM-DD
const horaAgora = () => Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));

export function fazerBackup(dia = hoje()) {
    const destino = path.join(PASTA, dia);
    const temp = `${destino}.parcial`;
    fs.rmSync(temp, { recursive: true, force: true });
    fs.mkdirSync(temp, { recursive: true });
    const feitos = [], falhas = [];
    for (const [nome, origem] of Object.entries(BANCOS)) {
        if (!fs.existsSync(origem)) continue;
        let banco;
        try {
            banco = new Database(origem, { readonly: true, fileMustExist: true });
            banco.pragma('busy_timeout = 15000');
            banco.exec(`VACUUM INTO '${path.join(temp, nome).replace(/'/g, "''")}'`);
            // Confere se a cópia abre e está íntegra
            const copia = new Database(path.join(temp, nome), { readonly: true });
            const ok = copia.prepare('PRAGMA quick_check').get();
            copia.close();
            if (Object.values(ok ?? {})[0] !== 'ok') throw new Error('cópia não passou na checagem');
            feitos.push(`${nome} (${(fs.statSync(path.join(temp, nome)).size / 1024).toFixed(0)} KB)`);
        } catch (e) {
            falhas.push(`${nome}: ${e.message}`);
        } finally {
            banco?.close();
        }
    }
    // Fotos do Gym Rats: espelho único em backups/gym-fotos (só copia as novas, nunca apaga)
    try {
        const n = espelharFotos();
        if (n) feitos.push(`${n} foto${n > 1 ? 's' : ''} nova${n > 1 ? 's' : ''} do Gym Rats`);
    } catch (e) {
        falhas.push(`fotos do Gym Rats: ${e.message}`);
    }
    // Só troca a pasta do dia quando a cópia terminou (nunca fica um backup pela metade com nome de pronto)
    fs.rmSync(destino, { recursive: true, force: true });
    fs.renameSync(temp, destino);
    limparAntigos();
    return { dia, feitos, falhas };
}

const FOTOS_GYM = process.env.GYM_FOTOS || `${BASE}/gym-data/fotos`;
function espelharFotos() {
    if (!fs.existsSync(FOTOS_GYM)) return 0;
    const destino = path.join(PASTA, 'gym-fotos');
    fs.mkdirSync(destino, { recursive: true });
    let novas = 0;
    for (const f of fs.readdirSync(FOTOS_GYM)) {
        if (!f.endsWith('.jpg') || fs.existsSync(path.join(destino, f))) continue;
        fs.copyFileSync(path.join(FOTOS_GYM, f), path.join(destino, `${f}.parcial`));
        fs.renameSync(path.join(destino, `${f}.parcial`), path.join(destino, f));
        novas++;
    }
    return novas;
}

function limparAntigos() {
    const pastas = fs.readdirSync(PASTA).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p)).sort();
    for (const velha of pastas.slice(0, Math.max(0, pastas.length - DIAS))) {
        fs.rmSync(path.join(PASTA, velha), { recursive: true, force: true });
    }
}

export function listarBackups() {
    try {
        return fs.readdirSync(PASTA).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p)).sort().reverse()
            .map(dia => ({ dia, arquivos: fs.readdirSync(path.join(PASTA, dia)) }));
    } catch {
        return [];
    }
}

// Chamado de hora em hora: faz o backup do dia uma vez, a partir da HORA (ou na hora, se nunca foi feito)
export function verificarBackup(avisar) {
    const dia = hoje();
    if (getEstado('backup_ultimo') === dia) return;
    if (getEstado('backup_ultimo') && horaAgora() < HORA) return;
    setEstado('backup_ultimo', dia);
    try {
        const r = fazerBackup(dia);
        console.log(`💾 Backup ${dia}: ${r.feitos.join(', ') || 'nada'}${r.falhas.length ? ` · FALHAS: ${r.falhas.join('; ')}` : ''}`);
        if (r.falhas.length) avisar?.(`⚠️ Backup de ${dia} com problema:\n${r.falhas.join('\n')}`).catch(() => {});
    } catch (e) {
        console.error('Backup falhou:', e.message);
        avisar?.(`⚠️ O backup diário dos bancos falhou: ${e.message}`).catch(() => {});
    }
}
