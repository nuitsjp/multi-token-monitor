export const full = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});
export const cost = (value: number | null) => (value === null ? '—' : usd.format(value));
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
export const costWhole = (value: number) => usdWhole.format(value);
