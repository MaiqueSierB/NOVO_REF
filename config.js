import 'dotenv/config';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Na Hostinger os segredos ficam fora da public_html, num arquivo que
// não é apagado nos deploys nem fica acessível pela web.
const secretsFile = process.env.SECRETS_FILE || '/home/u243267678/domains/mrbnexus.com.br/.bolao.env';
if (fs.existsSync(secretsFile)) dotenv.config({ path: secretsFile });

const chaves = ['TOKEN', 'CLIENT_ID', 'GUILD_ID', 'FOOTBALL_DATA_KEY', 'BOLAO_CHANNEL_ID'];
console.log(`Segredos: ${secretsFile} ${fs.existsSync(secretsFile) ? 'encontrado' : 'NÃO encontrado'}; ` +
    chaves.map(k => `${k}=${process.env[k] ? 'ok' : 'faltando'}`).join(' '));

const config = {
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    footballDataKey: process.env.FOOTBALL_DATA_KEY,
    // canal onde o bot anuncia lembretes, resultados e ranking (opcional)
    canalId: process.env.BOLAO_CHANNEL_ID,
    // código da competição na football-data.org (BSA = Brasileirão Série A)
    competicao: process.env.COMPETICAO || 'BSA',
    // de quantos em quantos minutos sincroniza jogos e resultados
    syncMinutos: Number(process.env.SYNC_MINUTOS || 10),
    dbPath: process.env.DB_PATH || 'bolao.sqlite'
};

export default config;
