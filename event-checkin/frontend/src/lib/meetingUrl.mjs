// Pasted meeting links may omit the scheme; the API validates the result.
export function normalizeMeetingUrl(value) {
  const url = value.trim();
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?::[0-9]{1,5})?(?:[/?#][^\s]*)?$/.test(url) ? `https://${url}` : url;
}
