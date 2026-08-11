// 牌的基础定义：一副标准牌去掉大小王，共 52 张
// 点数编码：3~10 原值，J=11 Q=12 K=13 A=14 2=15（2 最大，且不参与顺子/连对）
// 花色编码：0=♠ 1=♥ 2=♣ 3=♦

export const SUITS = ['♠', '♥', '♣', '♦'];
export const BLACK5_ID = '0-5'; // 黑桃5 —— 决定"黑五"身份的关键牌

const FACE = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' };

export function rankChar(r) {
  return r <= 10 ? String(r) : FACE[r];
}

export function makeDeck() {
  const deck = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 3; rank <= 15; rank++) {
      deck.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  return deck;
}

export function cardLabel(c) {
  return SUITS[c.suit] + rankChar(c.rank);
}

export function isRed(c) {
  return c.suit === 1 || c.suit === 3;
}

export function sortHand(hand) {
  hand.sort((a, b) => a.rank - b.rank || a.suit - b.suit);
}

// Fisher–Yates 洗牌
export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
