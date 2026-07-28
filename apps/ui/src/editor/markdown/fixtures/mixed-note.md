# Mortgage options

We are comparing three lenders. The rate assumption comes from [[doc_a1b2c3]];
the earlier analysis is [[doc_z9y8x7|last quarter's draft]].

## What we know

- The **30-year fixed** quote is 6.4%.
- The 15-year quote is *5.85%*, which needs re-checking.
  - The broker quoted it verbally.
  - Nothing is in writing yet.

## What to do next

1. Ask for written quotes.
2. Re-run the payoff table.
   1. Include the origination fee.
   2. Include the appraisal.
3. Decide by Friday.

> Rates move on Thursdays — treat anything older than a week as stale.

```python
def monthly(principal, rate, years):
    r = rate / 12
    n = years * 12
    return principal * r / (1 - (1 + r) ** -n)
```

---

See also: [the lender's page](https://example.com/rates), and note that
`amortization_schedule` is the column name in the export.
