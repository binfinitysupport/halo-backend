// Business rules for the user app, in one place so they are easy to find and change.
// Each rule names the section of the Technical Document it comes from.
// Amounts are USDT (1 USDT = 1 USD).

// Rounds money to 2 decimal places (cents).
export const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

// ---- Deposits (doc 6.3, appendix A.4) ----
// Each option is one network the user can pay with. "payCurrency" and "network" are the names
// OxaPay expects (checked against https://api.oxapay.com/v1/common/currencies).
export const DEPOSIT_OPTIONS = [
  { id: 'USDT-TRC20', label: 'USDT TRC20', payCurrency: 'USDT', network: 'Tron' },
  { id: 'USDT-BEP20', label: 'USDT BEP20', payCurrency: 'USDT', network: 'BSC' },
  { id: 'USDC-BEP20', label: 'USDC BEP20', payCurrency: 'USDC', network: 'BSC' },
  { id: 'ETH-BEP20', label: 'ETH BEP20', payCurrency: 'ETH', network: 'BSC' },
];
// Deposit address expiry shown to the user (doc S16: "Expires in 29:48" – a 30-minute QR).
export const DEPOSIT_LIFETIME_MINUTES = 30;

// ---- Withdrawals (doc 6.3, S18–S19) ----
export const WITHDRAWAL_MIN_USDT = 20;
export const WITHDRAWAL_MAX_USDT = 50000;
// Fixed fee on every withdrawal (answer from the business: fixed 6%).
export const WITHDRAWAL_FEE_RATE = 0.06;
// Doc section 12 marks "KYC before withdrawal" as an assumption still to be confirmed.
export const KYC_REQUIRED_FOR_WITHDRAWAL = true;

export const WITHDRAWAL_NETWORKS = ['TRC20', 'BEP20'];

// Address formats: TRC20 addresses start with T (34 characters); BEP20 are 0x followed by 40 hex digits.
const TRC20_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BEP20_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export function isValidWithdrawalAddress(network, address) {
  if (network === 'TRC20') return TRC20_ADDRESS.test(address);
  if (network === 'BEP20') return BEP20_ADDRESS.test(address);
  return false;
}

// ---- Transfers (doc 6.3, S20) ----
export const TRANSFER_MIN_TO_USER_USDT = 70;
export const TRANSFER_MIN_BETWEEN_WALLETS_USDT = 10;
// Other users are found by this 7-digit UUID.
export const USER_UUID_PATTERN = /^\d{7}$/;

// ---- Accounts ----
export const LOGIN_PASSWORD_MIN_LENGTH = 6;
export const FUND_PASSWORD_MIN_DIGITS = 6;

// ---- KYC (doc S27) ----
export const KYC_ID_TYPES = ['ID card', 'Passport', "Driver's license"];
// Each ID photo is sent as a data URL; this caps its size (about 3 MB of text).
export const KYC_IMAGE_MAX_CHARACTERS = 3 * 1024 * 1024;
