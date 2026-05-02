export function formatSequentialId(prefix: string, value: number) {
  return `${prefix}-${String(value).padStart(3, "0")}`;
}
