# Bolão do Brasileirão (bot de Discord)

Bolão por pontos do Brasileirão Série A. Os jogos e resultados vêm da [football-data.org](https://www.football-data.org) (plano gratuito) e os pontos são calculados sozinhos quando cada jogo termina. Vale só pontos, sem dinheiro.

## Comandos

| Comando | O que faz |
|---|---|
| `/palpitar` | Abre uma lista com os próximos jogos; escolha um e digite o placar |
| `/palpite jogo casa fora` | Palpite rápido (o campo `jogo` sugere times enquanto você digita) |
| `/jogos [rodada]` | Jogos da rodada, com status e o seu palpite |
| `/meuspalpites [rodada]` | Seus palpites e pontos (só você vê) |
| `/ranking [rodada]` | Ranking geral ou de uma rodada |
| `/regras` | Pontuação |
| `/tabela` | Classificação da Série A |
| `/rodada [n]` | Jogos e resultados da rodada |
| `/meutime time` | Aviso de gol e fim de jogo do seu time no privado — qualquer time brasileiro (Série A, B, Copa do Brasil, Libertadores, Sul-Americana) |
| `/zap` | Gera o código para ligar seu WhatsApp (notas e bolão pelo grupo do Zap) |

## Pontuação (só Brasileirão Série A)

- 🎯 Placar exato: **25**
- 🥅 Vencedor + gols de quem venceu: **18** (palpite 2x0, deu 2x1)
- ⚖️ Vencedor + saldo de gols: **15** (palpite 2x1, deu 3x2) — empate com outro placar também vale 15
- 🧤 Vencedor + gols de quem perdeu: **12** (palpite 2x1, deu 3x1)
- 👍 Só o vencedor: **10**
- ❌ Errou o resultado: **0**

Desempate: mais placares exatos. O ranking é por temporada.

Palpites podem ser feitos ou alterados até o apito inicial.

## Anúncios automáticos (se `BOLAO_CHANNEL_ID` estiver configurado)

- Lembrete ~3 h antes do primeiro jogo do dia, marcando quem ainda não palpitou
- Resultado de cada jogo com quem pontuou
- Ranking da rodada e geral quando a rodada termina

## Configuração

Segredos no arquivo `/home/u243267678/domains/mrbnexus.com.br/.bolao.env` (fora do site) ou num `.env` local:

```
TOKEN=token do bot
CLIENT_ID=id da aplicação
GUILD_ID=id do servidor
FOOTBALL_DATA_KEY=chave da football-data.org
BOLAO_CHANNEL_ID=id do canal de anúncios (opcional)
```

Variáveis opcionais: `DB_PATH` (onde fica o banco SQLite), `SYNC_MINUTOS` (padrão 10), `COMPETICAO` (padrão `BSA`).

```
npm install
npm start
```
