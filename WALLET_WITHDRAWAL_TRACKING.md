# Wallet & Withdrawal Tracking System

## 📊 Database Tables for Tracking

### 1. **Wallet** Table
Stores church wallet balance (Malawi only)
```typescript
{
  id: "wallet_123",
  churchId: "church_456",
  nationalAdminId: "admin_789",
  balance: 50000.00,  // Current available balance
  currency: "MWK",
  createdAt: "2026-03-07T10:00:00Z",
  updatedAt: "2026-03-07T12:00:00Z"
}
```

### 2. **WalletTransaction** Table
Complete audit trail of all wallet movements (LINKS TO TRANSACTION)
```typescript
{
  id: "wtxn_001",
  walletId: "wallet_123",
  type: "credit",  // or "debit"
  amount: 1000.00,
  balanceBefore: 49000.00,
  balanceAfter: 50000.00,
  source: "event_ticket",  // or "donation", "withdrawal", "refund"
  sourceId: "transaction_abc123",  // ← LINKS TO Transaction.id
  description: "Ticket purchase - Conference 2024",
  createdAt: "2026-03-07T12:00:00Z"
}
```

**Key Point:** `sourceId` stores the `Transaction.id`, creating a direct link:
- WalletTransaction.sourceId → Transaction.id
- This allows full traceability from wallet movement back to original payment

### 3. **Withdrawal** Table
Tracks withdrawal requests and payouts (Malawi only)
```typescript
{
  id: "withdrawal_001",
  walletId: "wallet_123",
  nationalAdminId: "admin_789",
  
  // Amounts
  amount: 5000.00,        // Gross amount requested
  fee: 150.00,            // Withdrawal fee (3% for mobile money)
  netAmount: 4850.00,     // Actually sent to church
  
  // Method
  method: "mobile_money",  // or "bank_transfer"
  
  // Mobile Money details
  mobileOperator: "airtel",  // or "tnm"
  mobileNumber: "998951510",
  
  // Bank details (if bank_transfer)
  bankCode: "bank_uuid",
  accountName: "Church Account",
  accountNumber: "1234567890",
  
  // Paychangu tracking
  chargeId: "PAYOUT-withdrawal_001",  // Paychangu payout reference
  gatewayResponse: "{...}",           // Full Paychangu response JSON
  
  // Status tracking
  status: "completed",  // "pending" | "processing" | "completed" | "failed"
  failureReason: null,
  processedAt: "2026-03-07T13:00:00Z",
  
  createdAt: "2026-03-07T12:30:00Z",
  updatedAt: "2026-03-07T13:00:00Z"
}
```

## 🔗 How Everything Links Together

### Payment → Transaction → WalletTransaction → Wallet

```
Member buys ticket (1000 MWK)
        ↓
Transaction created
  id: "txn_abc123"
  baseAmount: 1000
  convenienceFee: 20
  taxAmount: 3.5
  totalAmount: 1023.5
  gateway: "paychangu"
  status: "completed"
        ↓
WalletTransaction created
  sourceId: "txn_abc123"  ← Links to Transaction
  type: "credit"
  amount: 1000  (baseAmount only)
  source: "event_ticket"
        ↓
Wallet updated
  balance: 49000 → 50000
```

### Withdrawal → WalletTransaction → Wallet

```
Church requests withdrawal (5000 MWK)
        ↓
Withdrawal created
  id: "withdrawal_001"
  amount: 5000
  fee: 150
  netAmount: 4850
  status: "pending"
        ↓
WalletTransaction created (debit)
  sourceId: "withdrawal_001"  ← Links to Withdrawal
  type: "debit"
  amount: 5000
  source: "withdrawal"
        ↓
Wallet updated
  balance: 50000 → 45000
        ↓
Paychangu payout initiated
  chargeId: "PAYOUT-withdrawal_001"
        ↓
Withdrawal updated
  status: "completed"
  chargeId: "PAYOUT-withdrawal_001"
  gatewayResponse: "{...}"
  processedAt: "2026-03-07T13:00:00Z"
```

## 🔍 Traceability Queries

### 1. Find all transactions that credited a wallet
```typescript
const walletTransactions = await prisma.walletTransaction.findMany({
  where: { 
    walletId: "wallet_123",
    type: "credit"
  },
  include: {
    // Can't directly include Transaction, but sourceId links to it
  }
});

// Then fetch linked transactions
const transactionIds = walletTransactions.map(wt => wt.sourceId);
const transactions = await prisma.transaction.findMany({
  where: { id: { in: transactionIds } }
});
```

### 2. Find wallet transaction for a specific payment
```typescript
const walletTransaction = await prisma.walletTransaction.findFirst({
  where: {
    sourceId: "txn_abc123",  // Transaction.id
    source: "event_ticket"
  }
});
```

### 3. Track a withdrawal from request to completion
```typescript
const withdrawal = await prisma.withdrawal.findUnique({
  where: { id: "withdrawal_001" },
  include: {
    wallet: {
      include: {
        church: true
      }
    }
  }
});

// Find the debit transaction
const debitTransaction = await prisma.walletTransaction.findFirst({
  where: {
    sourceId: "withdrawal_001",
    type: "debit"
  }
});
```

### 4. Get complete wallet history with linked records
```typescript
const walletHistory = await prisma.walletTransaction.findMany({
  where: { walletId: "wallet_123" },
  orderBy: { createdAt: 'desc' }
});

// For each entry, fetch the linked record based on source
for (const wt of walletHistory) {
  if (wt.source === 'event_ticket' || wt.source === 'donation') {
    const transaction = await prisma.transaction.findUnique({
      where: { id: wt.sourceId }
    });
  } else if (wt.source === 'withdrawal') {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: wt.sourceId }
    });
  }
}
```

## 💰 Withdrawal Fee Structure

Configured in `.env`:
```env
WITHDRAWAL_MOBILE_MONEY_FEE_RATE=0.03  # 3%
WITHDRAWAL_BANK_FEE_RATE=0.01          # 1%
WITHDRAWAL_BANK_FIXED_FEE=700          # 700 MWK
```

**Mobile Money:**
- Amount: 5000 MWK
- Fee: 150 MWK (3%)
- Net: 4850 MWK

**Bank Transfer:**
- Amount: 5000 MWK
- Fee: 750 MWK (1% + 700 fixed)
- Net: 4250 MWK

## 📋 Summary

**Tracking Tables:**
1. **Wallet** - Current balance
2. **WalletTransaction** - Every movement (links to Transaction via sourceId)
3. **Withdrawal** - Payout requests and status
4. **Transaction** - Original payments (linked from WalletTransaction)

**Key Links:**
- WalletTransaction.sourceId → Transaction.id (for credits)
- WalletTransaction.sourceId → Withdrawal.id (for debits)
- Withdrawal.chargeId → Paychangu payout reference

This provides complete end-to-end traceability from payment to wallet to withdrawal!
