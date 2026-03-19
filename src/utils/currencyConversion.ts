const KES_RATE = parseFloat(process.env.USD_TO_KES_RATE || '129'); // 1 USD = 129 KES

export function convertUSDToLocal(usdAmount: number, _currency: 'KES' = 'KES'): number {
  return Math.round(usdAmount * KES_RATE);
}

export function convertLocalToUSD(localAmount: number, _currency: 'KES' = 'KES'): number {
  return parseFloat((localAmount / KES_RATE).toFixed(2));
}

export function getExchangeRate(_currency: 'KES' = 'KES'): number {
  return KES_RATE;
}
