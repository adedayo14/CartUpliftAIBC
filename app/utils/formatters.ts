export function formatMoney(amount: number, currencyCode = 'USD') {
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(numericAmount)) {
    if (typeof process !== 'undefined' && process.env.DEBUG_MODE === 'true') {
      console.warn(`formatMoney received an invalid amount: ${amount}`);
    }
    // Return a default formatted value for invalid numbers
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(0);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format(numericAmount);
}
