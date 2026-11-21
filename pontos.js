// Regras de pontuação do bolão
export const REGRAS = {
    exato: 10,          // acertou o placar exato
    vencedorSaldo: 7,   // acertou o vencedor e o saldo de gols (ex.: palpite 2x1, jogo 3x2)
    resultado: 5,       // acertou só quem venceu ou que empatou
    erro: 0
};

const sinal = n => Math.sign(n);

export function calcularPontos(palpiteCasa, palpiteFora, golsCasa, golsFora) {
    if (palpiteCasa === golsCasa && palpiteFora === golsFora) return REGRAS.exato;
    const saldoPalpite = palpiteCasa - palpiteFora;
    const saldoJogo = golsCasa - golsFora;
    if (sinal(saldoPalpite) !== sinal(saldoJogo)) return REGRAS.erro;
    // mesmo resultado (vitória da casa, empate ou vitória do visitante)
    if (saldoJogo !== 0 && saldoPalpite === saldoJogo) return REGRAS.vencedorSaldo;
    return REGRAS.resultado;
}

export const textoRegras =
    `**Pontuação por jogo**\n` +
    `🎯 Placar exato: **${REGRAS.exato} pts**\n` +
    `✅ Vencedor + saldo de gols certo: **${REGRAS.vencedorSaldo} pts** (ex.: palpite 2x1, deu 3x2)\n` +
    `👍 Acertou só o resultado (vitória ou empate): **${REGRAS.resultado} pts**\n` +
    `❌ Errou: **${REGRAS.erro} pts**\n\n` +
    `Palpites podem ser feitos ou alterados até o apito inicial. Depois disso o jogo trava.\n` +
    `Os pontos são calculados sozinhos quando o jogo termina. Vale só pontos, sem dinheiro.`;
