export const sql = `
-- Expenses and Cash & Bank get their own "view" permissions. Roles that could already work with them keep seeing them;
-- every other role (for example Sales User) no longer sees these pages until the owner allows it.
INSERT OR IGNORE INTO role_permissions(role_id, permission)
  SELECT role_id, 'expense.view' FROM role_permissions WHERE permission = 'expense.create';
INSERT OR IGNORE INTO role_permissions(role_id, permission)
  SELECT role_id, 'cashbank.view' FROM role_permissions WHERE permission IN ('ledger.adjust', 'cash.close');
`
