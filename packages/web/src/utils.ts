export function formatCurrency(amountInCents: string | bigint | number): string {
  const cents = typeof amountInCents === 'bigint' ? amountInCents : BigInt(amountInCents);
  const isNegative = cents < 0n;
  const absCents = isNegative ? -cents : cents;
  const pesos = absCents / 100n;
  const remainder = absCents % 100n;

  // Formato argentino: $ 123.456,78
  const pesosStr = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centsStr = remainder.toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}$ ${pesosStr},${centsStr}`;
}

export function formatDate(isoDate: string): string {
  if (!isoDate) return '-';
  const parts = isoDate.slice(0, 10).split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
