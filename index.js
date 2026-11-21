import http from 'node:http';
import {
    Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} from 'discord.js';
import config from './config.js';
import * as bolao from './bolao.js';
import { textoRegras } from './pontos.js';

const COR = 0x1f8b4c;
const fuso = 'America/Sao_Paulo';
const fmtData = iso => new Date(iso).toLocaleString('pt-BR', {
    timeZone: fuso, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
});
const ts = iso => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:f>`;
const placar = j => (j.gols_casa != null ? `${j.casa} **${j.gols_casa} x ${j.gols_fora}** ${j.fora}` : `${j.casa} x ${j.fora}`);
const medalha = i => ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;
const efemero = { flags: MessageFlags.Ephemeral };

// ---------- Comandos ----------
const comandos = [
    new SlashCommandBuilder().setName('jogos').setDescription('Mostra os jogos de uma rodada do Brasileirão.')
        .addIntegerOption(o => o.setName('rodada').setDescription('Número da rodada (padrão: rodada atual)').setMinValue(1).setMaxValue(38)),
    new SlashCommandBuilder().setName('palpitar').setDescription('Escolhe um jogo numa lista e manda seu palpite.'),
    new SlashCommandBuilder().setName('palpite').setDescription('Palpite rápido num jogo.')
        .addStringOption(o => o.setName('jogo').setDescription('Comece a digitar o nome de um time').setRequired(true).setAutocomplete(true))
        .addIntegerOption(o => o.setName('casa').setDescription('Gols do mandante').setRequired(true).setMinValue(0).setMaxValue(20))
        .addIntegerOption(o => o.setName('fora').setDescription('Gols do visitante').setRequired(true).setMinValue(0).setMaxValue(20)),
    new SlashCommandBuilder().setName('meuspalpites').setDescription('Mostra seus palpites e pontos numa rodada.')
        .addIntegerOption(o => o.setName('rodada').setDescription('Número da rodada (padrão: rodada atual)').setMinValue(1).setMaxValue(38)),
    new SlashCommandBuilder().setName('ranking').setDescription('Ranking do bolão (geral ou de uma rodada).')
        .addIntegerOption(o => o.setName('rodada').setDescription('Só uma rodada (deixe vazio para o geral)').setMinValue(1).setMaxValue(38)),
    new SlashCommandBuilder().setName('regras').setDescription('Como funciona a pontuação do bolão.')
].map(c => c.toJSON());

async function registrarComandos() {
    const rest = new REST({ version: '10' }).setToken(config.token);
    // Usa o ID da aplicação do próprio token (evita CLIENT_ID trocado no .env)
    const appId = client.application?.id ?? config.clientId;
    if (config.clientId && config.clientId !== appId) {
        console.warn(`CLIENT_ID do .env (${config.clientId}) não é deste bot; usando ${appId}.`);
    }
    const rota = config.guildId
        ? Routes.applicationGuildCommands(appId, config.guildId)
        : Routes.applicationCommands(appId);
    // Proteção: se o token for de outro bot (com comandos que não são do bolão), não sobrescreve nada.
    const existentes = await rest.get(rota);
    const nossos = new Set(comandos.map(c => c.name));
    const alheios = existentes.filter(c => !nossos.has(c.name));
    if (alheios.length) {
        throw new Error(`este token parece ser de outro bot (comandos: ${alheios.map(c => '/' + c.name).join(', ')}). ` +
            'Use o token e o CLIENT_ID do bot do bolão no .bolao.env.');
    }
    await rest.put(rota, { body: comandos });
    console.log(`Comandos registrados (${config.guildId ? 'no servidor' : 'globais'}).`);
}

// ---------- Telas ----------
function embedRodada(rodada, userId) {
    const jogos = bolao.palpitesDoUsuarioNaRodada(userId, rodada);
    if (!jogos.length) return new EmbedBuilder().setColor(COR).setDescription(`Não encontrei jogos da rodada ${rodada}.`);
    const linhas = jogos.map(j => {
        const meu = j.p_casa != null ? ` · seu palpite: ${j.p_casa}x${j.p_fora}${j.pontos != null ? ` (**${j.pontos} pts**)` : ''}` : '';
        const estado = j.status === 'FINISHED' ? '✅' : ['IN_PLAY', 'PAUSED'].includes(j.status) ? '🔴' :
            ['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(j.status) ? '⏸️' : (bolao.aberto(j) ? '🟢' : '🔒');
        return `${estado} ${placar(j)} — ${ts(j.data_utc)}${meu}`;
    });
    return new EmbedBuilder().setColor(COR).setTitle(`⚽ Brasileirão — Rodada ${rodada}`)
        .setDescription(linhas.join('\n'))
        .setFooter({ text: '🟢 aberto pra palpite · 🔒 fechado · 🔴 ao vivo · ✅ encerrado · /palpitar para palpitar' });
}

function embedRanking(rodada = null) {
    const lista = bolao.ranking(rodada);
    const titulo = rodada ? `🏆 Ranking da rodada ${rodada}` : '🏆 Ranking geral do bolão';
    if (!lista.length) return new EmbedBuilder().setColor(COR).setTitle(titulo).setDescription('Ninguém pontuou ainda.');
    return new EmbedBuilder().setColor(COR).setTitle(titulo).setDescription(
        lista.map((r, i) => `${medalha(i)} <@${r.user_id}> — **${r.pontos} pts** · ${r.exatos} na mosca · ${r.jogos} jogos`).join('\n'));
}

function menuJogosAbertos() {
    const jogos = bolao.jogosAbertos(25);
    if (!jogos.length) return null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('palpitar_select').setPlaceholder('Escolha o jogo')
            .addOptions(jogos.map(j => ({
                label: `${j.casa} x ${j.fora}`.slice(0, 100),
                description: `Rodada ${j.rodada} · ${fmtData(j.data_utc)}`.slice(0, 100),
                value: String(j.id)
            }))));
}

function modalPalpite(j, atual) {
    const campo = (id, rotulo, valor) => {
        const input = new TextInputBuilder().setCustomId(id).setLabel(rotulo.slice(0, 45))
            .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(2).setRequired(true).setPlaceholder('0');
        if (valor != null) input.setValue(String(valor));
        return new ActionRowBuilder().addComponents(input);
    };
    return new ModalBuilder().setCustomId(`palpite_modal:${j.id}`).setTitle(`${j.casa} x ${j.fora}`.slice(0, 45))
        .addComponents(campo('casa', `Gols ${j.casa}`, atual?.gols_casa), campo('fora', `Gols ${j.fora}`, atual?.gols_fora));
}

async function responderPalpite(interaction, jogoId, casa, fora) {
    if (![casa, fora].every(n => Number.isInteger(n) && n >= 0 && n <= 20)) {
        return interaction.reply({ ...efemero, content: 'Use números inteiros de 0 a 20.' });
    }
    const r = bolao.salvarPalpite(jogoId, interaction.user, casa, fora);
    if (!r.ok) return interaction.reply({ ...efemero, content: `❌ ${r.motivo}` });
    const menu = menuJogosAbertos();
    return interaction.reply({
        ...efemero,
        content: `✅ Palpite salvo: **${r.jogo.casa} ${casa} x ${fora} ${r.jogo.fora}** (${ts(r.jogo.data_utc)}). Pode mudar até o apito inicial.` +
            (menu ? '\nQuer palpitar em outro jogo?' : ''),
        components: menu ? [menu] : []
    });
}

// ---------- Discord ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isAutocomplete() && interaction.commandName === 'palpite') {
            const texto = interaction.options.getFocused();
            return interaction.respond(bolao.jogosAbertos(25, texto).map(j => ({
                name: `${j.casa} x ${j.fora} — R${j.rodada} ${fmtData(j.data_utc)}`.slice(0, 100),
                value: String(j.id)
            })));
        }

        if (interaction.isChatInputCommand()) {
            const rodadaOpt = interaction.options.getInteger('rodada');
            switch (interaction.commandName) {
                case 'jogos': {
                    const rodada = rodadaOpt ?? bolao.rodadaAtual();
                    if (rodada == null) return interaction.reply({ ...efemero, content: 'Ainda não carreguei os jogos. Tente em alguns minutos.' });
                    return interaction.reply({ embeds: [embedRodada(rodada, interaction.user.id)] });
                }
                case 'palpitar': {
                    const menu = menuJogosAbertos();
                    if (!menu) return interaction.reply({ ...efemero, content: 'Não há jogos abertos para palpite agora.' });
                    return interaction.reply({ ...efemero, content: 'Escolha o jogo:', components: [menu] });
                }
                case 'palpite': {
                    const id = Number(interaction.options.getString('jogo'));
                    return responderPalpite(interaction, id, interaction.options.getInteger('casa'), interaction.options.getInteger('fora'));
                }
                case 'meuspalpites': {
                    const rodada = rodadaOpt ?? bolao.rodadaAtual();
                    if (rodada == null) return interaction.reply({ ...efemero, content: 'Ainda não carreguei os jogos.' });
                    return interaction.reply({ ...efemero, embeds: [embedRodada(rodada, interaction.user.id)] });
                }
                case 'ranking':
                    return interaction.reply({ embeds: [embedRanking(rodadaOpt)] });
                case 'regras':
                    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COR).setTitle('📜 Regras do bolão').setDescription(textoRegras)] });
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'palpitar_select') {
            const j = bolao.jogo(Number(interaction.values[0]));
            if (!bolao.aberto(j)) return interaction.reply({ ...efemero, content: '❌ Esse jogo já fechou para palpites.' });
            return interaction.showModal(modalPalpite(j, bolao.palpite(j.id, interaction.user.id)));
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('palpite_modal:')) {
            const id = Number(interaction.customId.split(':')[1]);
            const ler = campo => {
                const t = interaction.fields.getTextInputValue(campo).trim();
                return /^\d{1,2}$/.test(t) ? Number(t) : NaN;
            };
            return responderPalpite(interaction, id, ler('casa'), ler('fora'));
        }
    } catch (erro) {
        console.error('Erro na interação:', erro);
        const resp = { ...efemero, content: 'Deu erro aqui. Tenta de novo em instantes.' };
        if (interaction.isRepliable()) {
            if (interaction.replied || interaction.deferred) await interaction.followUp(resp).catch(() => {});
            else await interaction.reply(resp).catch(() => {});
        }
    }
});

// ---------- Sincronização e anúncios ----------
async function canal() {
    if (!config.canalId) return null;
    return client.channels.fetch(config.canalId).catch(() => null);
}

let sincronizando = false;
async function ciclo() {
    if (sincronizando) return;
    sincronizando = true;
    try {
        const { total, novos, rodadasFechadas } = await bolao.sincronizar();
        if (bolao.primeiraSincronizacao()) {
            console.log(`Primeira sincronização: ${total} jogos carregados.`);
            return;
        }
        const ch = await canal();

        for (const j of novos) {
            if (ch) {
                const pts = bolao.pontuadoresDoJogo(j.id).filter(p => p.pontos > 0);
                const quem = pts.length
                    ? pts.map(p => `<@${p.user_id}> ${p.gols_casa}x${p.gols_fora} → **${p.pontos}**`).join('\n')
                    : 'Ninguém pontuou nesse jogo.';
                await ch.send({
                    embeds: [new EmbedBuilder().setColor(COR).setTitle(`🏁 Fim de jogo — Rodada ${j.rodada}`)
                        .setDescription(`${placar(j)}\n\n${quem}`)],
                    allowedMentions: { parse: [] }
                }).catch(e => console.error('Falha ao anunciar resultado:', e.message));
            }
            bolao.marcarAnunciado(j.id);
        }

        for (const r of rodadasFechadas) {
            if (ch) {
                await ch.send({ content: `📣 **Rodada ${r} encerrada!**`, embeds: [embedRanking(r), embedRanking()], allowedMentions: { parse: [] } })
                    .catch(e => console.error('Falha ao anunciar ranking:', e.message));
            }
            bolao.marcarRodadaFechada(r);
        }

        const prox = bolao.rodadaParaLembrar(3);
        if (prox && ch) {
            const { jogos, usuarios } = bolao.semPalpite(prox);
            const cobranca = usuarios.length ? `\nAinda faltam palpites de: ${usuarios.map(u => `<@${u}>`).join(' ')}` : '';
            await ch.send({
                content: `⏰ Primeiro jogo ${ts(prox.data_utc)}: **${prox.casa} x ${prox.fora}**. ` +
                    `${jogos} jogo(s) hoje ainda aceitam palpite — use **/palpitar**.${cobranca}`,
                allowedMentions: { users: usuarios }
            }).catch(e => console.error('Falha ao lembrar:', e.message));
        }
    } catch (erro) {
        console.error('Falha na sincronização:', erro.message);
    } finally {
        sincronizando = false;
    }
}

client.once(Events.ClientReady, async c => {
    console.log(`⚽ Bolão online como ${c.user.tag}`);
    try {
        await registrarComandos();
    } catch (e) {
        console.error('Bolão desligado:', e.message);
        await client.destroy();
        return;
    }
    await ciclo();
    setInterval(ciclo, config.syncMinutos * 60_000);
});

// Servidor HTTP mínimo: a hospedagem precisa de uma porta respondendo.
http.createServer((req, res) => {
    const ok = client.isReady();
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok, bot: client.user?.tag ?? null, rodada: ok ? bolao.rodadaAtual() : null }));
}).listen(Number(process.env.PORT || 3000), () => console.log(`Health check na porta ${process.env.PORT || 3000}`));

client.login(config.token).catch(e => console.error('Falha no login do Discord:', e.message));
