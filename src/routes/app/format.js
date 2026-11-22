// Shapes of user-app data sent to the browser. Database column names stay inside the server.
import { num } from '../../db.js';

// What the app may show about the logged-in user. Password hashes are never included.
export const toProfileResponse = (row) => ({
  id: row.id,
  uuid: row.uuid,
  phone: row.phone,
  countryIso: row.country_iso,
  email: row.email,
  name: row.name,
  vip: row.vip,
  inviteCode: row.invite_code,
  kycStatus: row.kyc_status,
  accountStatus: row.status,
  joinedAt: row.joined_at,
});

export const toWalletsResponse = (row) => ({
  flexible: num(row.flex_balance),
  active: num(row.active_balance),
});
