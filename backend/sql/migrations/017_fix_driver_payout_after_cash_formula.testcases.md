## 017 payout-after-cash strict formula tests

Formula:
`driver_payout_after_cash = max(0, transfer_base - abs(transfer_commission) - abs(cash_commission))`

### Case 1 (target)
- transfer_base: `5001.68`
- transfer_commission: `1000.34`
- cash_commission: `-25.10`
- expected: `3976.24`

### Case 2 (no cash)
- transfer_base: `2500.00`
- transfer_commission: `500.00`
- cash_commission: `0`
- expected: `2000.00`

### Case 3 (positive cash value still deducted by ABS)
- transfer_base: `1000.00`
- transfer_commission: `100.00`
- cash_commission: `25.00`
- expected: `875.00`

### Case 4 (clamp)
- transfer_base: `100.00`
- transfer_commission: `120.00`
- cash_commission: `25.00`
- expected: `0.00`
