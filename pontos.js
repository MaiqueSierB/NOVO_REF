// Regras de pontuação do bolão (modelo clássico de bolão de Brasileirão)
export const REGRAS = {
    exato: 25,          // acertou o placar exato
    golsVencedor: 18,   // acertou o vencedor e os gols de quem venceu (ex.: palpite 2x0, deu 2x1)
    saldo: 15,          // acertou o vencedor e o saldo (ex.: 2x1, deu 3x2) — ou empate com placar diferente
    golsPerdedor: 12,   // acertou o vencedor e os gols de quem perdeu (ex.: 2x1, deu 3x1)
    vencedor: 10,       // acertou só quem venceu
    erro: 0
};

export function calcularPontos(pc, pf, gc, gf) {
    if (pc === gc && pf === gf) return REGRAS.exato;
    const resPalpite = Math.sign(pc - pf);
    const resJogo = Math.sign(gc - gf);
    if (resPalpite !== resJogo) return REGRAS.erro;
    if (resJogo === 0) return REGRAS.saldo;                 // empate, mas placar diferente
    const casaVenceu = resJogo > 0;
    const [pV, pP, gV, gP] = casaVenceu ? [pc, pf, gc, gf] : [pf, pc, gf, gc];
    if (pV === gV) return REGRAS.golsVencedor;
    if (pc - pf === gc - gf) return REGRAS.saldo;
    if (pP === gP) return REGRAS.golsPerdedor;
    return REGRAS.vencedor;
}

export const textoRegras =
    `Só o **Brasileirão Série A**. Pontos por jogo:\n` +
    `🎯 Placar exato: **${REGRAS.exato}**\n` +
    `🥅 Vencedor + gols de quem venceu: **${REGRAS.golsVencedor}** (palpite 2x0, deu 2x1)\n` +
    `⚖️ Vencedor + saldo de gols: **${REGRAS.saldo}** (palpite 2x1, deu 3x2)\n` +
    `🤝 Empate, mas com outro placar: **${REGRAS.saldo}** (palpite 1x1, deu 0x0)\n` +
    `🧤 Vencedor + gols de quem perdeu: **${REGRAS.golsPerdedor}** (palpite 2x1, deu 3x1)\n` +
    `👍 Só o vencedor: **${REGRAS.vencedor}** (palpite 1x0, deu 3x1)\n` +
    `❌ Errou o resultado: **${REGRAS.erro}**\n\n` +
    `Desempate no ranking: mais placares exatos.\n` +
    `Palpites podem ser feitos ou alterados até o apito inicial. Os pontos saem sozinhos quando o jogo acaba. Vale só pontos, sem dinheiro.`;
