import db, { getEstado, setEstado } from './db.js';
import { buscarPartidas, buscarTabela } from './futebol.js';
import { calcularPontos, REGRAS } from './pontos.js';

const ABERTOS = ['SCHEDULED', 'TIMED'];
const agoraISO = () => new Date().toISOString();

function temporadaAtual() {
    return db.prepare('SELECT MAX(temporada) AS t FROM jogos').get()?.t ?? null;
}

// Rodada atual = a menor rodada da temporada que ainda tem jogo por terminar.
export function rodadaAtual() {
    const t = temporadaAtual();
    if (t == null) return null;
    const aberta = db.prepare(`
        SELECT MIN(rodada) AS r FROM jogos
        WHERE temporada = ? AND rodada IS NOT NULL
          AND status NOT IN ('FINISHED', 'CANCELLED', 'AWARDED')
    `).get(t)?.r;
    return aberta ?? db.prepare('SELECT MAX(rodada) AS r FROM jogos WHERE temporada = ?').get(t)?.r ?? null;
}

export function jogo(id) {
    return db.prepare('SELECT * FROM jogos WHERE id = ?').get(id);
}

export function aberto(j) {
    return j && ABERTOS.includes(j.status) && new Date(j.data_utc).getTime() > Date.now();
}

// Próximos jogos que ainda aceitam palpite (no máximo 25, limite do menu do Discord)
export function jogosAbertos(limite = 25, filtro = '') {
    const f = `%${filtro.toLowerCase()}%`;
    return db.prepare(`
        SELECT * FROM jogos
        WHERE status IN ('SCHEDULED', 'TIMED') AND data_utc > ?
          AND (lower(casa) LIKE ? OR lower(fora) LIKE ?)
        ORDER BY data_utc, id
        LIMIT ?
    `).all(agoraISO(), f, f, limite);
}

export function salvarPalpite(jogoId, user, golsCasa, golsFora) {
    const j = jogo(jogoId);
    if (!j) return { ok: false, motivo: 'Jogo não encontrado.' };
    if (!aberto(j)) return { ok: false, motivo: 'Esse jogo já começou ou não está aceitando palpites.' };
    db.prepare(`
        INSERT INTO palpites (jogo_id, user_id, username, gols_casa, gols_fora, atualizado)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(jogo_id, user_id) DO UPDATE SET
            gols_casa = excluded.gols_casa, gols_fora = excluded.gols_fora,
            username = excluded.username, atualizado = excluded.atualizado
    `).run(jogoId, user.id, user.username, golsCasa, golsFora);
    return { ok: true, jogo: j };
}

export function palpite(jogoId, userId) {
    return db.prepare('SELECT * FROM palpites WHERE jogo_id = ? AND user_id = ?').get(jogoId, userId);
}

export function palpitesDoUsuarioNaRodada(userId, rodada) {
    return db.prepare(`
        SELECT j.*, p.gols_casa AS p_casa, p.gols_fora AS p_fora, p.pontos
        FROM jogos j LEFT JOIN palpites p ON p.jogo_id = j.id AND p.user_id = ?
        WHERE j.temporada = ? AND j.rodada = ?
        ORDER BY j.data_utc, j.id
    `).all(userId, temporadaAtual(), rodada);
}

export function ranking(rodada = null, limite = 15) {
    const params = [temporadaAtual()];
    let filtroRodada = '';
    if (rodada != null) { filtroRodada = 'AND j.rodada = ?'; params.push(rodada); }
    params.push(limite);
    return db.prepare(`
        SELECT p.user_id, MAX(p.username) AS username,
               COALESCE(SUM(p.pontos), 0) AS pontos,
               SUM(CASE WHEN p.pontos = ${REGRAS.exato} THEN 1 ELSE 0 END) AS exatos,
               COUNT(p.pontos) AS jogos
        FROM palpites p JOIN jogos j ON j.id = p.jogo_id
        WHERE j.temporada = ? ${filtroRodada}
        GROUP BY p.user_id
        ORDER BY pontos DESC, exatos DESC, jogos DESC
        LIMIT ?
    `).all(...params);
}

export function pontuadoresDoJogo(jogoId) {
    return db.prepare(`
        SELECT user_id, username, gols_casa, gols_fora, pontos FROM palpites
        WHERE jogo_id = ? ORDER BY pontos DESC, username
    `).all(jogoId);
}

// Quem já participou do bolão alguma vez na temporada (usado nos lembretes)
function participantes() {
    return db.prepare(`
        SELECT DISTINCT p.user_id FROM palpites p JOIN jogos j ON j.id = p.jogo_id
        WHERE j.temporada = ?
    `).all(temporadaAtual()).map(r => r.user_id);
}

const upsertJogo = db.prepare(`
    INSERT INTO jogos (id, temporada, rodada, data_utc, status, casa, fora, gols_casa, gols_fora)
    VALUES (@id, @temporada, @rodada, @data_utc, @status, @casa, @fora, @gols_casa, @gols_fora)
    ON CONFLICT(id) DO UPDATE SET
        temporada = excluded.temporada, rodada = excluded.rodada, data_utc = excluded.data_utc,
        status = excluded.status, casa = excluded.casa, fora = excluded.fora,
        gols_casa = excluded.gols_casa, gols_fora = excluded.gols_fora
`);

// Busca jogos/resultados, recalcula pontos e devolve o que precisa ser anunciado.
export async function sincronizar() {
    const partidas = await buscarPartidas();
    db.transaction(lista => { for (const p of lista) upsertJogo.run(p); })(partidas);

    // Classificação (falha aqui não impede o resto da sincronização)
    try {
        const tabela = await buscarTabela();
        if (tabela.length) {
            db.transaction(linhas => {
                db.prepare('DELETE FROM tabela').run();
                const ins = db.prepare(`INSERT INTO tabela (posicao, time, jogos, vitorias, empates, derrotas, gols_pro, gols_contra, saldo, pontos)
                    VALUES (@posicao, @time, @jogos, @vitorias, @empates, @derrotas, @gols_pro, @gols_contra, @saldo, @pontos)`);
                for (const l of linhas) ins.run(l);
            })(tabela);
        }
    } catch (e) {
        console.error('Falha ao atualizar a tabela:', e.message);
    }

    // (Re)calcula os pontos de todos os jogos encerrados — barato e corrige placares revisados.
    const encerrados = db.prepare(`
        SELECT * FROM jogos WHERE status = 'FINISHED' AND gols_casa IS NOT NULL AND gols_fora IS NOT NULL
    `).all();
    const atualizar = db.prepare('UPDATE palpites SET pontos = ? WHERE jogo_id = ? AND user_id = ?');
    db.transaction(() => {
        for (const j of encerrados) {
            for (const p of db.prepare('SELECT * FROM palpites WHERE jogo_id = ?').all(j.id)) {
                const pts = calcularPontos(p.gols_casa, p.gols_fora, j.gols_casa, j.gols_fora);
                if (p.pontos !== pts) atualizar.run(pts, j.id, p.user_id);
            }
        }
    })();

    // Jogos recém-terminados que ainda não foram anunciados
    const novos = db.prepare(`
        SELECT * FROM jogos WHERE status = 'FINISHED' AND gols_casa IS NOT NULL AND anunciado = 0
        ORDER BY data_utc
    `).all();

    // Rodadas que acabaram de fechar por completo
    const rodadasFechadas = [];
    for (const r of new Set(novos.map(j => j.rodada))) {
        const faltam = db.prepare(`
            SELECT COUNT(*) AS n FROM jogos WHERE temporada = ? AND rodada = ?
              AND status NOT IN ('FINISHED', 'CANCELLED', 'AWARDED')
        `).get(temporadaAtual(), r).n;
        if (faltam === 0 && getEstado(`rodada_fechada_${temporadaAtual()}_${r}`) == null) rodadasFechadas.push(r);
    }

    return { total: partidas.length, novos, rodadasFechadas };
}

export function marcarAnunciado(jogoId) {
    db.prepare('UPDATE jogos SET anunciado = 1 WHERE id = ?').run(jogoId);
}

export function marcarRodadaFechada(rodada) {
    setEstado(`rodada_fechada_${temporadaAtual()}_${rodada}`, agoraISO());
}

// Na primeira sincronização não anunciamos o passado inteiro da temporada.
export function primeiraSincronizacao() {
    if (getEstado('inicializado')) return false;
    db.prepare("UPDATE jogos SET anunciado = 1 WHERE status = 'FINISHED'").run();
    const t = temporadaAtual();
    for (const { rodada } of db.prepare(`
        SELECT rodada FROM jogos WHERE temporada = ? GROUP BY rodada
        HAVING SUM(CASE WHEN status NOT IN ('FINISHED','CANCELLED','AWARDED') THEN 1 ELSE 0 END) = 0
    `).all(t)) setEstado(`rodada_fechada_${t}_${rodada}`, agoraISO());
    setEstado('inicializado', agoraISO());
    return true;
}

// Lembrete: rodada com jogo começando nas próximas `horas` horas, ainda não lembrada.
export function rodadaParaLembrar(horas = 3) {
    const limite = new Date(Date.now() + horas * 3600_000).toISOString();
    const prox = db.prepare(`
        SELECT * FROM jogos WHERE status IN ('SCHEDULED','TIMED') AND data_utc > ? AND data_utc <= ?
        ORDER BY data_utc LIMIT 1
    `).get(agoraISO(), limite);
    if (!prox) return null;
    const chave = `lembrete_${prox.temporada}_${prox.rodada}_${prox.data_utc.slice(0, 10)}`;
    if (getEstado(chave)) return null;
    setEstado(chave, agoraISO());
    return prox;
}

// Quem participa do bolão mas ainda não palpitou nos jogos abertos do dia do próximo jogo
export function semPalpite(jogoBase) {
    const dia = jogoBase.data_utc.slice(0, 10);
    const jogosDia = db.prepare(`
        SELECT id FROM jogos WHERE status IN ('SCHEDULED','TIMED') AND data_utc > ? AND substr(data_utc, 1, 10) = ?
    `).all(agoraISO(), dia).map(r => r.id);
    if (!jogosDia.length) return { jogos: 0, usuarios: [] };
    const usuarios = participantes().filter(uid => {
        const n = db.prepare(`SELECT COUNT(*) AS n FROM palpites WHERE user_id = ? AND jogo_id IN (${jogosDia.map(() => '?').join(',')})`)
            .get(uid, ...jogosDia).n;
        return n < jogosDia.length;
    });
    return { jogos: jogosDia.length, usuarios };
}

export function tabela() {
    return db.prepare('SELECT * FROM tabela ORDER BY posicao').all();
}
