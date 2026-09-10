// ponytail: crypto.randomUUID needs a secure context (https or localhost); a plain-http LAN
// dev URL would throw here. Add a getRandomValues fallback if that ever matters.
export function newId(): string {
  return crypto.randomUUID()
}
