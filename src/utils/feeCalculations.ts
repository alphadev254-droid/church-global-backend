interface PaymentFees {
  baseAmount: number;
  convenienceFee: number;
  systemFeeAmount: number;
  totalAmount: number;
  systemGatewayFeeRate: number;
  systemFeeRate: number;
}

function requireEnv(key: string): number {
  const val = process.env[key];
  if (!val) throw new Error('Payment configuration is not available. Please contact support.');
  const num = parseFloat(val);
  if (isNaN(num)) throw new Error('Payment configuration is not available. Please contact support.');
  return num;
}

export function calculatePaymentFees(baseAmount: number, country?: string): PaymentFees {
  const PAYSTACK_FEE_RATE  = requireEnv('PAYSTACK_FEE_RATE') / 100;
  const PAYCHANGU_FEE_RATE = requireEnv('PAYMENT_CONVENIENCE_FEE_PERCENTAGE') / 100;

  const gatewayFeeRate = country === 'Kenya' ? PAYSTACK_FEE_RATE : PAYCHANGU_FEE_RATE;
  const convenienceFee = baseAmount * gatewayFeeRate;

  const KENYA_SYSTEM_FEE_RATE  = requireEnv('CONVENIENCE_RATE_KENYA') / 100;
  const MALAWI_SYSTEM_FEE_RATE = requireEnv('CONVENIENCE_RATE_MALAWI') / 100;
  const systemFeeRate   = country === 'Kenya' ? KENYA_SYSTEM_FEE_RATE : MALAWI_SYSTEM_FEE_RATE;
  const systemFeeAmount = baseAmount * systemFeeRate;

  const totalAmount = baseAmount + convenienceFee + systemFeeAmount;

  return {
    baseAmount:           parseFloat(baseAmount.toFixed(2)),
    convenienceFee:       parseFloat(convenienceFee.toFixed(2)),
    systemFeeAmount:      parseFloat(systemFeeAmount.toFixed(2)),
    totalAmount:          parseFloat(totalAmount.toFixed(2)),
    systemGatewayFeeRate: gatewayFeeRate,
    systemFeeRate,
  };
}

interface WithdrawalFees {
  amount: number;
  fee: number;
  netAmount: number;
}

export function calculateWithdrawalFee(
  amount: number,
  method: 'mobile_money' | 'bank_transfer'
): WithdrawalFees {
  let fee: number;

  if (method === 'mobile_money') {
    fee = amount * (requireEnv('WITHDRAWAL_MOBILE_MONEY_FEE_RATE'));
  } else {
    fee = (amount * requireEnv('WITHDRAWAL_BANK_FEE_RATE')) + requireEnv('WITHDRAWAL_BANK_FIXED_FEE');
  }

  const netAmount = amount - fee;

  return {
    amount: parseFloat(amount.toFixed(2)),
    fee: parseFloat(fee.toFixed(2)),
    netAmount: parseFloat(netAmount.toFixed(2))
  };
}
