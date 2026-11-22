// Placar ao vivo do Brasileirão pela API pública da ESPN (sem chave, não oficial).
// A football-data.org gratuita tem placar atrasado, por isso o "gol ao vivo" usa a ESPN.
// A cada minuto compara o placar com o último visto e gera avisos de gol e de fim de jogo.
import db from './db.js';
import { identificarTime } from './times.js';

// Série A, Série B, Copa do Brasil, Libertadores e Sul-Americana: o aviso de gol vale para qualquer time
// brasileiro. (O bolão e a /tabela continuam só Série A.)
const LIGAS = (process.env.LIGAS_AO_VIVO || 'bra.1,bra.2,bra.copa_do_brazil,conmebol.libertadores,conmebol.sudamericana').split(',');
const URL = liga => `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`;

function dataBR(d = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}${p.month}${p.day}`;
}

async function buscar(liga, params = '') {
    try {
        const res = await fetch(URL(liga) + params);
        if (!res.ok) throw new Error(`ESPN (${liga}) respondeu ${res.status}`);
        return (await res.json()).events || [];
    } catch (e) {
        console.warn(e.message);
        return [];   // uma liga fora do ar não derruba as outras
    }
}

const num = v => {
    const n = Number(typeof v === 'object' && v !== null ? (v.value ?? v.displayValue) : v);
    return Number.isFinite(n) ? n : 0;
};

// Converte um evento da ESPN no nosso formato
function lerEvento(ev) {
    const comp = ev.competitions?.[0];
    const cs = comp?.competitors || [];
    const casa = cs.find(c => c.homeAway === 'home') || cs[0];
    const fora = cs.find(c => c.homeAway === 'away') || cs[1];
    if (!casa || !fora) return null;
    const nome = c => c.team?.shortDisplayName || c.team?.displayName || c.team?.name || '?';
    const estado = ev.status?.type?.state || comp?.status?.type?.state || 'pre';   // pre | in | post
    const relogio = ev.status?.displayClock || comp?.status?.displayClock || '';
    const gols = (comp?.details || []).filter(d => d.scoringPlay).map(d => ({
        teamId: d.team?.id, minuto: d.clock?.displayValue || '',
        autor: d.athletesInvolved?.[0]?.displayName || d.athletesInvolved?.[0]?.shortName || '',
        contra: /own goal|contra/i.test(d.type?.text || '')
    }));
    return {
        id: String(ev.id), estado, relogio,
        casa: nome(casa), fora: nome(fora),
        casaKey: identificarTime(casa.team?.displayName || nome(casa))?.key || identificarTime(nome(casa))?.key || null,
        foraKey: identificarTime(fora.team?.displayName || nome(fora))?.key || identificarTime(nome(fora))?.key || null,
        casaId: casa.team?.id, foraId: fora.team?.id,
        golsCasa: num(casa.score), golsFora: num(fora.score), gols
    };
}

const inserirEvento = db.prepare('INSERT INTO eventos (tipo, times, texto) VALUES (?, ?, ?)');
const salvar = db.prepare(`
    INSERT INTO ao_vivo (event_id, casa, fora, casa_key, fora_key, gols_casa, gols_fora, estado, atualizado)
    VALUES (@id, @casa, @fora, @casaKey, @foraKey, @golsCasa, @golsFora, @estado, datetime('now'))
    ON CONFLICT(event_id) DO UPDATE SET gols_casa = excluded.gols_casa, gols_fora = excluded.gols_fora,
        estado = excluded.estado, atualizado = excluded.atualizado
`);

// Busca no YouTube pelos melhores momentos do jogo (com a data, para não pegar jogo antigo).
// Só um link: o vídeo em si é das emissoras e clubes, o bot não baixa nem reposta.
function linkMelhoresMomentos(casa, fora, quando = new Date()) {
    const data = quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(`melhores momentos ${casa} x ${fora} ${data}`)}`;
}

// Compara com o último estado salvo e gera os avisos.
function processar(eventos) {
    const novos = [];
    for (const e of eventos.filter(Boolean)) {
        const antes = db.prepare('SELECT * FROM ao_vivo WHERE event_id = ?').get(e.id);
        const times = [e.casaKey, e.foraKey].filter(Boolean).join(',');
        const placar = `${e.casa} ${e.golsCasa} x ${e.golsFora} ${e.fora}`;
        if (antes && times) {
            // Gols novos (pode ter mais de um entre duas checagens)
            const lados = [['casa', e.golsCasa - antes.gols_casa, e.casa, e.casaId], ['fora', e.golsFora - antes.gols_fora, e.fora, e.foraId]];
            for (const [, qtd, time, teamId] of lados) {
                for (let i = 0; i < qtd; i++) {
                    const g = e.gols.filter(x => x.teamId === teamId).at(-(qtd - i));
                    const det = g ? ` (${[g.minuto, g.autor].filter(Boolean).join(' — ')}${g.contra ? ', contra' : ''})` : (e.relogio ? ` (${e.relogio})` : '');
                    const texto = `⚽ *GOL DO ${time.toUpperCase()}!*${det}\n${placar}`;
                    inserirEvento.run('gol', times, texto); novos.push(texto);
                }
            }
            // Gol anulado (VAR): placar diminuiu
            if (e.golsCasa < antes.gols_casa || e.golsFora < antes.gols_fora) {
                const texto = `🚩 *Gol anulado!* Placar corrigido: ${placar}`;
                inserirEvento.run('gol', times, texto); novos.push(texto);
            }
            if (e.estado === 'post' && antes.estado !== 'post') {
                const texto = `🏁 *Fim de jogo:* ${placar}\n🎥 Melhores momentos (os vídeos oficiais costumam sair até 1h depois):\n${linkMelhoresMomentos(e.casa, e.fora)}`;
                inserirEvento.run('fim', times, texto); novos.push(texto);
            }
        }
        const { id, casa, fora, casaKey, foraKey, golsCasa, golsFora, estado } = e;
        salvar.run({ id, casa, fora, casaKey, foraKey, golsCasa, golsFora, estado });
    }
    return novos;
}

export async function checarAoVivo() {
    // Jogos de "hoje" pelo horário de Brasília em cada competição
    const listas = await Promise.all(LIGAS.map(l => buscar(l.trim(), `?dates=${dataBR()}`)));
    const porId = new Map();
    for (const ev of listas.flat()) porId.set(String(ev.id), ev);
    db.prepare("DELETE FROM eventos WHERE criado < datetime('now', '-3 days')").run();
    db.prepare("DELETE FROM ao_vivo WHERE atualizado < datetime('now', '-5 days')").run();
    return processar([...porId.values()].map(lerEvento));
}

// ---------- Times do coração ----------
export function definirTime(discordId, time) {
    db.prepare(`INSERT INTO times_favoritos (discord_id, time_key, time_nome) VALUES (?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET time_key = excluded.time_key, time_nome = excluded.time_nome`)
        .run(discordId, time.key, time.nome);
}

export function removerTime(discordId) {
    return db.prepare('DELETE FROM times_favoritos WHERE discord_id = ?').run(discordId).changes > 0;
}

export function torcedores(timesCsv) {
    const keys = timesCsv.split(',').filter(Boolean);
    if (!keys.length) return [];
    return db.prepare(`SELECT * FROM times_favoritos WHERE time_key IN (${keys.map(() => '?').join(',')})`).all(...keys);
}

export function eventosPendentesDiscord() {
    return db.prepare('SELECT * FROM eventos WHERE discord_ok = 0 ORDER BY id').all();
}

export function marcarDiscord(id) {
    db.prepare('UPDATE eventos SET discord_ok = 1 WHERE id = ?').run(id);
}
