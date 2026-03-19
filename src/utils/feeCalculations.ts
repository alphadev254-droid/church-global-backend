interface PaymentFees {
  baseAmount: number;
  convenienceFee: number;
  systemFeeAmount: number;
  totalAmount: number;
  systemGatewayFeeRate: number;
  systemFeeRate: number;
}

// No fees charged — user pays the exact package/event/donation amount
export function calculatePaymentFees(baseAmount: number, _country?: string): PaymentFees {
  const amount = parseFloat(baseAmount.toFixed(2));
  return {
    baseAmount:           amount,
    convenienceFee:       0,
    systemFeeAmount:      0,
    totalAmount:          amount,
    systemGatewayFeeRate: 0,
    systemFeeRate:        0,
  };
}

// ─── B2C fee (M-Pesa send money tariff, paid by business) ────────────────────
export function calculateB2CFee(amount: number): number {
  const tiers = [
    { max: parseFloat(process.env.MPESA_B2C_FEE_TIER_1_MAX || '100'),    fee: parseFloat(process.env.MPESA_B2C_FEE_TIER_1_FEE || '0') },
    { max: parseFloat(process.env.MPESA_B2C_FEE_TIER_2_MAX || '500'),    fee: parseFloat(process.env.MPESA_B2C_FEE_TIER_2_FEE || '7') },
    { max: parseFloat(process.env.MPESA_B2C_FEE_TIER_3_MAX || '1000'),   fee: parseFloat(process.env.MPESA_B2C_FEE_TIER_3_FEE || '13') },
    { max: parseFloat(process.env.MPESA_B2C_FEE_TIER_4_MAX || '250000'), fee: parseFloat(process.env.MPESA_B2C_FEE_TIER_4_FEE || '108') },
  ];
  for (const tier of tiers) {
    if (amount <= tier.max) return tier.fee;
  }
  return tiers[tiers.length - 1].fee;
}

// ─── B2B fee (percentage, capped) ────────────────────────────────────────────
export function calculateB2BFee(amount: number): number {
  const rate = parseFloat(process.env.MPESA_B2B_FEE_RATE || '0.0025');
  const cap  = parseFloat(process.env.MPESA_B2B_FEE_CAP  || '200');
  return Math.min(parseFloat((amount * rate).toFixed(2)), cap);
}
