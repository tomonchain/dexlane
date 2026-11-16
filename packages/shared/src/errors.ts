/** Erreur métier attendue (règle violée), distincte d'une panne technique. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const isDomainError = (e: unknown, code?: string): e is DomainError =>
  e instanceof DomainError && (code === undefined || e.code === code);
