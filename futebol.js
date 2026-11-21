// Cliente da football-data.org (plano gratuito: 10 requisições/minuto, inclui o Brasileirão).
// Uma única chamada traz a temporada inteira, então sincronizar a cada 10 min é tranquilo.
import config from './config.js';

const BASE = 'https://api.football-data.org/v4';

export async function buscarPartidas() {
    if (!config.footballDataKey) throw new Error('FOOTBALL_DATA_KEY não configurada');
    const res = await fetch(`${BASE}/competitions/${config.competicao}/matches`, {
        headers: { 'X-Auth-Token': config.footballDataKey }
    });
    if (!res.ok) {
        const corpo = await res.text().catch(() => '');
        throw new Error(`football-data.org respondeu ${res.status}: ${corpo.slice(0, 200)}`);
    }
    const data = await res.json();
    return (data.matches || []).map(m => ({
        id: m.id,
        temporada: m.season?.startDate ? Number(m.season.startDate.slice(0, 4)) : null,
        rodada: m.matchday ?? null,
        data_utc: m.utcDate,
        status: m.status,
        casa: m.homeTeam?.shortName || m.homeTeam?.name || 'A definir',
        fora: m.awayTeam?.shortName || m.awayTeam?.name || 'A definir',
        gols_casa: m.score?.fullTime?.home ?? null,
        gols_fora: m.score?.fullTime?.away ?? null
    }));
}
