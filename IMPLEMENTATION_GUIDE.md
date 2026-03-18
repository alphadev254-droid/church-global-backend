# Multi-Gateway Payment System Implementation Guide

## Overview
This system supports two payment gateways based on user's country:
- **Kenya**: Paystack (instant split payments via subaccounts)
- **Malawi**: Paychangu (wallet system with manual payouts)

## Database Schema Changes

### 1. Run Migration
```bash
npx prisma migrate dev --name add_wallet_system_and_fees
npx prisma generate
```

### 2. New Tables Created
- **Wallet**: Tracks church earnings (Malawi only)
- **WalletTransaction**: Audit trail of wallet movements
- **Withdrawal**: Withdrawal requests and payouts

### 3. Updated Tables
- **Transaction**: Added `baseAmount`, `convenienceFee`, `taxAmount`, `totalAmount`, `gateway`, `gatewayCountry`
- **Payment**: Added `convenienceFee`, `taxAmount`, `gateway`
- **Church**: Added `wallet` relation

## Environment Variables

Add to `.env`:
```env
# Payment fees (charged to customer)
PAYMENT_CONVENIENCE_FEE_PERCENTAGE=2
PAYMENT_TAX_RATE=17.5

# Withdrawal fees (deducted from withdrawal)
WITHDRAWAL_MOBILE_MONEY_FEE_RATE=0.03
WITHDRAWAL_BANK_FEE_RATE=0.01
WITHDRAWAL_BANK_FIXED_FEE=700

# Paychangu (Malawi)
PAYCHANGU_SECRET_KEY=your_secret_key
PAYCHANGU_PUBLIC_KEY=your_public_key
```

## Gateway Routing Logic

### User Hierarchy
```
National Admin (has accountCountry)
  ↓
Regional/District/Local Admin (has nationalAdminId)
  ↓
Church Admin (has nationalAdminId)
  ↓
Member (linked via church → nationalAdminId)
```

### Gateway Selection
```typescript
// src/utils/gatewayRouter.ts
getPaymentGateway(userId) → 'paystack' | 'paychangu'

Logic:
1. Check user.accountCountry (National Admin)
2. If not, get from user.nationalAdminId (Regional/District/Local/Church Admin)
3. If not, get from church.nationalAdminId (Members)
4. Return: Malawi → 'paychangu', Kenya → 'paystack'
```

## Fee Structure

### Payment Fees (Charged to Customer)
```
Base Amount: 1000 MWK
Convenience Fee (2%): 20 MWK
Tax on Fee (17.5%): 3.5 MWK
Total Customer Pays: 1023.5 MWK

Church Receives: 1000 MWK (100% of base)
System Keeps: 23.5 MWK (convenience fee + tax)
```

### Withdrawal Fees (Deducted from Withdrawal)
```
Mobile Money (3%):
  Request: 5000 MWK
  Fee: 150 MWK
  Net Payout: 4850 MWK

Bank Transfer (1% + 700 MWK):
  Request: 10000 MWK
  Fee: 800 MWK (100 + 700)
  Net Payout: 9200 MWK
```

## Payment Flow

### Kenya (Paystack)
```
1. User buys ticket (1000 KSH)
2. System calculates fees → Total: 1023.5 KSH
3. Paystack processes payment
4. Split payment:
   - Church subaccount: 1000 KSH
   - System account: 23.5 KSH
5. Church withdraws from Paystack dashboard
```

### Malawi (Paychangu)
```
1. User buys ticket (1000 MWK)
2. System calculates fees → Total: 1023.5 MWK
3. Paychangu processes payment
4. All money goes to System Paychangu account
5. Webhook received → Credit church wallet with 1000 MWK
6. Church requests withdrawal via app
7. System processes payout via Paychangu API
```

## API Endpoints

### Wallet Endpoints
```
GET  /api/wallets/balance          - Get wallet balance
GET  /api/wallets/transactions     - Get wallet transaction history
POST /api/wallets/withdraw         - Request withdrawal
GET  /api/wallets/withdrawals      - Get withdrawal history
```

### Withdrawal Request Body
```json
{
  "amount": 5000,
  "method": "mobile_money",
  "mobileOperator": "airtel",
  "mobileNumber": "998951510"
}
```

OR

```json
{
  "amount": 10000,
  "method": "bank_transfer",
  "bankCode": "bank-uuid-from-paychangu",
  "accountName": "Church ABC",
  "accountNumber": "1234567890"
}
```

## Integration Steps

### 1. Register Routes
Add to `src/index.ts` or `src/app.ts`:
```typescript
import walletRoutes from './routes/walletRoutes';

app.use('/api/wallets', walletRoutes);
```

### 2. Update Transaction Controller
When creating transactions (tickets, donations), use:
```typescript
import { getPaymentGateway, getCurrency } from '../utils/gatewayRouter';
import { calculatePaymentFees } from '../utils/feeCalculations';

const gateway = await getPaymentGateway(userId);
const currency = getCurrency(gateway);
const fees = calculatePaymentFees(baseAmount);

// Create transaction with fee breakdown
await prisma.transaction.create({
  data: {
    baseAmount: fees.baseAmount,
    convenienceFee: fees.convenienceFee,
    taxAmount: fees.taxAmount,
    totalAmount: fees.totalAmount,
    amount: fees.totalAmount,
    currency,
    gateway,
    gatewayCountry: gateway === 'paychangu' ? 'Malawi' : 'Kenya',
    // ... other fields
  }
});
```

### 3. Update Webhook Handler
For Paychangu webhooks, credit church wallet:
```typescript
import { creditChurchWallet } from '../utils/walletOperations';

// After payment confirmed
if (transaction.gateway === 'paychangu') {
  await creditChurchWallet(
    transaction.churchId!,
    transaction.baseAmount,
    'event_ticket',
    transaction.id,
    `Ticket purchase - ${transaction.reference}`
  );
}
```

## Testing Checklist

### Kenya Users (Paystack)
- [ ] National admin can subscribe to package
- [ ] Fees calculated correctly (2% + 17.5% tax)
- [ ] Payment splits to church subaccount
- [ ] Transaction records fee breakdown

### Malawi Users (Paychangu)
- [ ] National admin can subscribe to package
- [ ] Fees calculated correctly
- [ ] Payment goes to system account
- [ ] Wallet credited with base amount
- [ ] Wallet transaction created
- [ ] Church can view wallet balance
- [ ] Church can request withdrawal
- [ ] Withdrawal fees calculated correctly
- [ ] Payout processed via Paychangu

## Database Queries

### Check Wallet Balance
```sql
SELECT * FROM wallets WHERE churchId = 'church_id';
```

### View Wallet Transactions
```sql
SELECT * FROM wallet_transactions 
WHERE walletId = 'wallet_id' 
ORDER BY createdAt DESC;
```

### View Withdrawals
```sql
SELECT * FROM withdrawals 
WHERE walletId = 'wallet_id' 
ORDER BY createdAt DESC;
```

### System Revenue Report
```sql
-- Convenience fees + taxes
SELECT 
  SUM(convenienceFee + taxAmount) as total_payment_fees,
  COUNT(*) as transaction_count
FROM transactions
WHERE status = 'completed';

-- Withdrawal fees
SELECT 
  SUM(fee) as total_withdrawal_fees,
  COUNT(*) as withdrawal_count
FROM withdrawals
WHERE status = 'completed';
```

## Next Steps

1. **Run migrations**: `npx prisma migrate dev`
2. **Update .env**: Add payment and withdrawal fee variables
3. **Register routes**: Add wallet routes to app
4. **Update transaction controller**: Use gateway router and fee calculations
5. **Update webhook handler**: Credit wallets for Malawi payments
6. **Test payment flows**: Test both Kenya and Malawi scenarios
7. **Build frontend**: Create wallet dashboard and withdrawal pages

## Support

For issues or questions:
- Check logs for trace IDs
- Verify environment variables
- Ensure Paychangu credentials are correct
- Test with small amounts first
