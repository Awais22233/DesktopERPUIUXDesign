import { AppError } from "./errors"

/** Granular permissions. Roles are sets of these. */
export const PERMISSIONS = [
  "sale.create",
  "sale.void",
  "sale.price_override",
  "sale.discount_override",
  "sale.credit_limit_override",
  "sale.backdate",
  "purchase.create",
  "purchase.void",
  "payment.create",
  "expense.create",
  "stock.adjust",
  "ledger.adjust",
  "report.view",
  "report.export",
  "settings.manage",
  "users.manage",
  "backup.restore",
] as const
export type Permission = (typeof PERMISSIONS)[number]

export interface Actor {
  userId: number
  permissions: ReadonlySet<Permission>
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission)
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new AppError("FORBIDDEN", `Permission required: ${permission}`)
}

export const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set(PERMISSIONS)
