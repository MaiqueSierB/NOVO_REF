// Página de status pública dos bots do Regresso: /status (HTML) e /status.json.
// Usa as checagens que o monitor grava a cada 5 minutos (30 dias de histórico).
import db from './db.js';
import { SLOT_MS, nomesBots } from './monitor.js';

const DIA = 86_400_000;

// Quedas de antes da página existir, tiradas dos logs da Hostinger (gravadas uma vez só)
// (ok 1 = conectado no período, 0 = fora)
const QUEDAS_DOS_LOGS = [
    { bot: 'Zap', de: '2026-11-21T03:00:00Z', ate: '2026-11-21T14:50:00Z', ok: 1, detalhe: 'conectado (pelos logs)' },
    { bot: 'Zap', de: '2026-11-21T14:50:00Z', ate: '2026-11-21T21:27:00Z', ok: 0, detalhe: 'WhatsApp restringiu o número; bot pausado até parear de novo' },
    { bot: 'Zap', de: '2026-11-21T21:27:00Z', ate: '2026-11-23T19:20:00Z', ok: 1, detalhe: 'conectado (pelos logs)' },
    { bot: 'Zap', de: '2026-11-23T19:20:00Z', ate: '2026-11-23T20:05:00Z', ok: 0, detalhe: 'sessão encerrada pelo WhatsApp (logout)' }
];
if (!db.prepare("SELECT valor FROM estado WHERE chave = 'status_logs_importados'").get()) {
    const ins = db.prepare('INSERT OR IGNORE INTO monitor (bot, slot, ok, ms, detalhe) VALUES (?, ?, ?, NULL, ?)');
    db.transaction(() => {
        for (const q of QUEDAS_DOS_LOGS) {
            for (let slot = Math.floor(Date.parse(q.de) / SLOT_MS); slot < Math.floor(Date.parse(q.ate) / SLOT_MS); slot++) ins.run(q.bot, slot, q.ok, q.detalhe);
        }
        db.prepare("INSERT OR REPLACE INTO estado (chave, valor) VALUES ('status_logs_importados', '1')").run();
    })();
}
const POR_DIA = DIA / SLOT_MS;            // 288 checagens por dia

// Considera no ar quem respondeu (ok 1 ou 2)
function uptime(bot, desdeSlot) {
    const r = db.prepare('SELECT COUNT(*) AS n, SUM(ok > 0) AS bons FROM monitor WHERE bot = ? AND slot >= ?').get(bot, desdeSlot);
    return r.n ? (r.bons / r.n) * 100 : null;
}

// Quedas: sequências de checagens fora do ar (2 ou mais = 10 min, para não contar reinício)
function quedas(bot, desdeSlot) {
    const linhas = db.prepare('SELECT slot, ok, detalhe FROM monitor WHERE bot = ? AND slot >= ? ORDER BY slot').all(bot, desdeSlot);
    const lista = [];
    let atual = null;
    for (const l of linhas) {
        if (l.ok === 0) {
            if (!atual) atual = { bot, inicio: l.slot, fim: l.slot, n: 0, motivo: l.detalhe };
            atual.fim = l.slot;
            atual.n++;
        } else if (atual) {
            if (atual.n >= 2) lista.push({ ...atual, emAndamento: false });
            atual = null;
        }
    }
    if (atual) lista.push({ ...atual, emAndamento: true });   // queda acontecendo agora aparece já na 1ª checagem
    return lista;
}

export function dadosStatus() {
    const agora = Math.floor(Date.now() / SLOT_MS);
    const bots = nomesBots().map(nome => {
        const ultimo = db.prepare('SELECT slot, ok, ms, detalhe FROM monitor WHERE bot = ? ORDER BY slot DESC LIMIT 1').get(nome);
        // Últimos 30 dias, dia a dia (no fuso de Brasília)
        // Brasília é UTC-3 o ano todo (sem horário de verão desde 2019): meia-noite local = 03:00 UTC
        const local = new Date(Date.now() - 3 * 3_600_000);
        const meiaNoite = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3);
        const dias = [];
        for (let i = 29; i >= 0; i--) {
            const inicio = meiaNoite - i * DIA;
            const r = db.prepare('SELECT COUNT(*) AS n, SUM(ok > 0) AS bons FROM monitor WHERE bot = ? AND slot >= ? AND slot < ?')
                .get(nome, Math.floor(inicio / SLOT_MS), Math.floor((inicio + DIA) / SLOT_MS));
            dias.push({ data: new Date(inicio - 3 * 3_600_000).toISOString().slice(0, 10), pct: r.n ? (r.bons / r.n) * 100 : null });
        }
        return {
            nome,
            situacao: !ultimo || agora - ultimo.slot > 3 ? 'sem dados' : ultimo.ok === 1 ? 'no ar' : ultimo.ok === 2 ? 'atenção' : 'fora do ar',
            detalhe: ultimo?.detalhe ?? null,
            ms: ultimo?.ms ?? null,
            checado: ultimo ? new Date(ultimo.slot * SLOT_MS).toISOString() : null,
            uptime24h: uptime(nome, agora - POR_DIA),
            uptime7d: uptime(nome, agora - 7 * POR_DIA),
            uptime30d: uptime(nome, agora - 30 * POR_DIA),
            dias
        };
    });
    const incidentes = nomesBots().flatMap(n => quedas(n, agora - 30 * POR_DIA))
        .sort((a, b) => b.inicio - a.inicio).slice(0, 15)
        .map(q => ({
            bot: q.bot, motivo: q.motivo, emAndamento: q.emAndamento,
            inicio: new Date(q.inicio * SLOT_MS).toISOString(),
            minutos: (q.fim - q.inicio + 1) * 5
        }));
    const inicio = db.prepare('SELECT MIN(slot) AS s FROM monitor WHERE ms IS NOT NULL').get()?.s;
    return { atualizado: new Date().toISOString(), inicioMonitor: inicio ? new Date(inicio * SLOT_MS).toISOString() : null, bots, incidentes };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => (v == null ? '—' : `${v >= 99.95 ? '100' : v.toFixed(v >= 99 ? 2 : 1)}%`);
const quando = iso => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const duracao = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim());
const corDia = p => (p == null ? 'var(--vazio)' : p >= 99.5 ? 'var(--ok)' : p >= 95 ? 'var(--aviso)' : 'var(--fora)');
const COR = { 'no ar': 'var(--ok)', 'atenção': 'var(--aviso)', 'fora do ar': 'var(--fora)', 'sem dados': 'var(--vazio)' };

export function paginaStatus() {
    const d = dadosStatus();
    const fora = d.bots.filter(b => b.situacao === 'fora do ar');
    const atencao = d.bots.filter(b => b.situacao === 'atenção');
    const geral = fora.length ? ['fora', `${fora.map(b => b.nome).join(', ')} fora do ar`]
        : atencao.length ? ['aviso', `Tudo no ar — ${atencao.map(b => b.nome).join(', ')} com aviso`]
            : ['ok', 'Todos os bots no ar'];

    const linhas = d.bots.map(b => `
<section class="bot">
  <div class="topo"><span class="bola" style="background:${COR[b.situacao]}"></span><h2>${esc(b.nome)}</h2>
    <span class="sit">${esc(b.situacao)}${b.situacao !== 'no ar' && b.detalhe ? ` · ${esc(b.detalhe)}` : ''}</span></div>
  <div class="barras">${b.dias.map(x => `<i style="background:${corDia(x.pct)}" title="${x.data.split('-').reverse().join('/')}: ${pct(x.pct)}"></i>`).join('')}</div>
  <div class="rodape"><span>30 dias atrás</span><span>24h ${pct(b.uptime24h)} · 7d ${pct(b.uptime7d)} · 30d ${pct(b.uptime30d)}</span><span>hoje</span></div>
</section>`).join('');

    const incidentes = d.incidentes.length
        ? `<ul class="inc">${d.incidentes.map(i => `<li><b>${esc(i.bot)}</b> ${i.emAndamento ? '<span class="tag">agora</span>' : ''}
            <span>${quando(i.inicio)} · ${i.emAndamento ? 'há' : 'durou'} ${duracao(i.minutos)}</span><small>${esc(i.motivo)}</small></li>`).join('')}</ul>`
        : `<p class="vazio">Nenhuma queda registrada${d.inicioMonitor ? ` desde ${quando(d.inicioMonitor)}` : ''}.</p>`;

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Status dos bots do Regresso</title><meta http-equiv="refresh" content="60">
<style>
:root{--ok:#2fb36a;--aviso:#e9b02c;--fora:#e5484d;--vazio:#3a3d44;--fundo:#111214;--card:#1b1d21;--texto:#eceef1;--fraco:#8b9098}
*{box-sizing:border-box;margin:0}body{background:var(--fundo);color:var(--texto);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:32px 16px}
main{max-width:760px;margin:0 auto}h1{font-size:26px;margin-bottom:6px}.sub{color:var(--fraco);margin-bottom:22px;font-size:14px}
.geral{border-radius:14px;padding:16px 20px;font-weight:700;font-size:18px;margin-bottom:22px}
.geral.ok{background:rgba(47,179,106,.15);color:var(--ok)}.geral.aviso{background:rgba(233,176,44,.15);color:var(--aviso)}.geral.fora{background:rgba(229,72,77,.15);color:var(--fora)}
.bot{background:var(--card);border-radius:14px;padding:16px 18px;margin-bottom:12px}
.topo{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.topo h2{font-size:17px}.sit{color:var(--fraco);font-size:14px;margin-left:auto}
.bola{width:12px;height:12px;border-radius:50%;flex:none}
.barras{display:flex;gap:3px;margin:14px 0 8px;height:30px}.barras i{flex:1;border-radius:3px}
.rodape{display:flex;justify-content:space-between;color:var(--fraco);font-size:12px;gap:8px}
h3{margin:28px 0 12px;font-size:18px}.inc{list-style:none;padding:0}.inc li{background:var(--card);border-radius:12px;padding:12px 16px;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.inc span{color:var(--fraco);font-size:14px}.inc small{width:100%;color:var(--fraco)}.tag{background:var(--fora);color:#fff!important;border-radius:999px;padding:1px 8px;font-size:12px!important}
.vazio{color:var(--fraco)}footer{color:var(--fraco);font-size:12px;margin-top:28px;text-align:center}
</style></head><body><main>
<h1>Bots do Regresso</h1><p class="sub">Checado a cada 5 minutos · atualizado ${quando(d.atualizado)}</p>
<div class="geral ${geral[0]}">${esc(geral[1])}</div>
${linhas}
<h3>Quedas recentes</h3>${incidentes}
<footer>${d.inicioMonitor ? `Monitoramento automático desde ${quando(d.inicioMonitor)}; quedas anteriores vêm dos logs da hospedagem. ` : ''}Quedas de menos de 10 minutos (reinícios) não contam · <a href="/status.json" style="color:inherit">JSON</a></footer>
</main></body></html>`;
}
