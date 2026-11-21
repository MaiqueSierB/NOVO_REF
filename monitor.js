// Monitor dos bots: visita cada um a cada 5 minutos (isso também os mantém acordados na Hostinger),
// guarda o último estado e avisa no privado do admin quando um cai ou volta.
const BOTS = (process.env.MONITOR_BOTS ||
    'Anti Janja=https://antijanja.mrbnexus.com.br/health,RMDB=https://rmdb.mrbnexus.com.br/,' +
    'RGDB=https://rgdb.mrbnexus.com.br/,Zap=https://zap.mrbnexus.com.br/,Aniversários=https://aniversario.mrbnexus.com.br/')
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

export async function rodarMonitor(avisar) {
    await Promise.all(BOTS.map(async bot => {
        const r = await checar(bot);
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
