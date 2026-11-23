// Monitor dos bots: visita cada um a cada 5 minutos (isso também os mantém acordados na Hostinger),
// guarda o último estado e avisa no privado do admin quando um cai ou volta.
// Cada checagem fica gravada (30 dias) para a página de status (status.js).
import db from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS monitor (
    bot   TEXT NOT NULL,
    slot  INTEGER NOT NULL,          -- janela de 5 min (epoch / 300000): uma linha por bot por janela, mesmo com 2 processos
    ok    INTEGER NOT NULL,          -- 1 no ar, 2 no ar com aviso (ex.: Zap esperando pareamento), 0 fora
    ms    INTEGER,
    detalhe TEXT,
    PRIMARY KEY (bot, slot)
)`);
const gravar = db.prepare('INSERT OR IGNORE INTO monitor (bot, slot, ok, ms, detalhe) VALUES (?, ?, ?, ?, ?)');
const limpar = db.prepare('DELETE FROM monitor WHERE slot < ?');
export const SLOT_MS = 5 * 60_000;
// "No ar, mas com aviso": o app responde, mas está pausado ou sem o WhatsApp conectado
const comAviso = detalhe => /pausado|aguardando|pareamento/i.test(detalhe ?? '');
const BOTS = (process.env.MONITOR_BOTS ||
    'Anti Janja=https://antijanja.mrbnexus.com.br/health,RMDB=https://rmdb.mrbnexus.com.br/,' +
    'RGDB=https://rgdb.mrbnexus.com.br/,Zap=https://zap.mrbnexus.com.br/,Aniversários=https://aniversario.mrbnexus.com.br/,' +
    'Portal=https://regresso.mrbnexus.com.br/health')
    .split(',').map(par => { const [nome, url] = par.split('='); return { nome: nome.trim(), url: url.trim() }; });

const FALHAS_PARA_ALERTA = 3;   // 3 checagens seguidas (~15 min) antes de avisar, para não alarmar em reinício
const estado = new Map();       // nome -> { ok, falhas, desde, ms, detalhe, alertado }

async function checar(bot) {
    const inicio = Date.now();
    try {
        const r = await fetch(bot.url, { signal: AbortSignal.timeout(15_000) });
        const corpo = await r.json().catch(() => ({}));
        return { ok: r.ok, ms: Date.now() - inicio, detalhe: r.ok ? (corpo.bot || corpo.estado || 'ok') : `HTTP ${r.status}${corpo.estado ? ` (${corpo.estado})` : ''}` };
    } catch (e) {
        return { ok: false, ms: Date.now() - inicio, detalhe: e.name === 'TimeoutError' ? 'sem resposta' : e.message };
    }
}

export async function rodarMonitor(avisar, proprio) {
    const slot = Math.floor(Date.now() / SLOT_MS);
    // O próprio bolão também entra na página de status
    if (proprio) gravar.run('Bolão', slot, proprio.ok ? 1 : 0, 0, proprio.detalhe);
    limpar.run(slot - (30 * 86_400_000) / SLOT_MS);
    await Promise.all(BOTS.map(async bot => {
        const r = await checar(bot);
        gravar.run(bot.nome, slot, r.ok ? (comAviso(r.detalhe) ? 2 : 1) : 0, r.ms, String(r.detalhe ?? '').slice(0, 200));
        const antes = estado.get(bot.nome) || { ok: true, falhas: 0, desde: Date.now(), alertado: false };
        const agora = { ...antes, ms: r.ms, detalhe: r.detalhe };
        if (r.ok) {
            if (antes.alertado) await avisar(`✅ **${bot.nome}** voltou ao ar.`).catch(() => {});
            Object.assign(agora, { ok: true, falhas: 0, alertado: false, desde: antes.ok ? antes.desde : Date.now() });
        } else {
            agora.falhas = antes.falhas + 1;
            if (antes.ok) Object.assign(agora, { ok: false, desde: Date.now() });
            if (agora.falhas >= FALHAS_PARA_ALERTA && !antes.alertado) {
                agora.alertado = true;
                await avisar(`⚠️ **${bot.nome}** fora do ar há ~${agora.falhas * 5} min: ${r.detalhe}.\nLogs: hPanel → ${new URL(bot.url).host} → Node.js.`).catch(() => {});
            }
        }
        estado.set(bot.nome, agora);
    }));
}

export const nomesBots = () => ['Bolão', ...BOTS.map(b => b.nome)];

export function textoStatus() {
    if (!estado.size) return 'Ainda não fiz a primeira checagem. Tenta em 1 minuto.';
    return BOTS.map(b => {
        const e = estado.get(b.nome);
        if (!e) return `⏳ **${b.nome}** — aguardando`;
        const desde = `<t:${Math.floor(e.desde / 1000)}:R>`;
        return e.ok ? `🟢 **${b.nome}** — ${e.detalhe} · ${e.ms} ms · no ar desde ${desde}`
            : `🔴 **${b.nome}** — ${e.detalhe} · fora desde ${desde}`;
    }).join('\n');
}
