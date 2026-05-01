export function formatMoney(amount: number, currency = "AED") {
  return `${amount.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${currency}`;
}

export function formatMonth(month: string) {
  const [year, value] = month.split("-");
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric"
  }).format(new Date(Number(year), Number(value) - 1, 1));
}

export function roundCurrency(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
