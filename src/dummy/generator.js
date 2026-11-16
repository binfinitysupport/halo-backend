// ---------------------------------------------------------------------------
// DUMMY DATA ONLY.
// A deterministic port of the mock data in the original Halo Admin prototype
// (same seeded generator, same call order), so the numbers on screen match
// the design exactly. When the real backend is live, stop calling these from
// the seed script and delete the file.
// ---------------------------------------------------------------------------

export const DUMMY = {
  userCountOffset: 12418,   // added to the real user count on the dashboard
  balanceOffset: 2100000,   // added to real total balances on the dashboard
  activeToday: 3206,        // static "active today" figure
};

const DIALS = ['+1', '+44', '+91', '+65', '+971', '+61'];
const NAMES = [
  'Aarav Shah', 'Mia Chen', 'Liam Patel', 'Sofia Rossi', 'Noah Kim', 'Zara Ali',
  'Ethan Brown', 'Ava Singh', 'Lucas Silva', 'Isla Wong', 'Omar Haddad', 'Emma Fischer',
];
const COUNTRIES = ['United States', 'United Kingdom', 'India', 'Singapore', 'UAE', 'Australia'];
const DOC_TYPES = ['ID card', 'Passport', "Driver's license"];
const NETWORKS = ['USDT TRC20', 'USDT BEP20', 'USDC BEP20', 'ETH BEP20'];
const TRC20_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const BEP20_ADDRESS = '0x8F3a2C91bD47e6A0f5C2d9B81E34a7c6D02F9b1E';
const TRC20_DEPOSIT = 'TXq8mH3vK2pLr9WbN4sYd7cE5fJ1aZ6uQ9';
const TEAM_RATES = [10, 5, 3, 2, 1, 1];
const MEMBER_DEPOSITS = [70, 100, 300, 500, 1000, 3600];

export const POPUP_BANNERS = [
  { title: '100,000 USDT giveback', subtitle: 'Complete KYC and make one deposit to share the pool.' },
  { title: 'Up to 2.25% daily yield', subtitle: 'Unlock QS-2 servers with faster cycles.' },
  { title: 'Invite friends, earn 10%', subtitle: 'Get commission on every level-1 deposit.' },
  { title: 'One order. Daily profit.', subtitle: 'Create your strategy order every 24 hours.' },
];

export const HOME_BANNERS = [
  { title: 'Invite friends, earn across 6 generations', subtitle: 'Daily team rewards to your wallet' },
  { title: 'Upgrade from Ordinary User to VIP', subtitle: 'Higher daily task limits' },
  { title: 'Verify your identity in minutes', subtitle: 'Reviewed within 72 hours' },
  { title: 'Deposit USDT 24/7', subtitle: 'TRC20 network, fast credit' },
  { title: 'Redeem points for rewards', subtitle: 'Coming soon' },
];

const pad = (n) => String(n).padStart(2, '0');

export function createRng(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// Same evaluation order as the prototype: first block, then second block.
const makePhone = (rand, dial) => {
  const a = 100 + Math.floor(rand() * 899);
  const b = 100 + Math.floor(rand() * 899);
  return `${dial} ${a}****${b}`;
};

export function generateUsers(count = 36) {
  const rand = createRng(7);
  return Array.from({ length: count }, (_, i) => {
    const uuid = String(20480000 + Math.floor(rand() * 9e5));
    const phone = makePhone(rand, DIALS[i % DIALS.length]);
    const name = NAMES[i % NAMES.length];
    const vip = Math.floor(rand() * 5);
    const activeBalance = Math.round(rand() * 6000 * 100) / 100;
    const flexBalance = Math.round(rand() * 900 * 100) / 100;
    const teamSize = Math.floor(rand() * 40);
    const kycStatus = rand() < 0.6 ? 'verified' : rand() < 0.5 ? 'pending' : 'none';
    const status = rand() < 0.08 ? 'frozen' : 'active';
    const month = 6 + Math.floor(rand() * 5);
    const day = 1 + Math.floor(rand() * 28);
    const joined = new Date(Date.UTC(2026, month - 1, day));
    return { seq: i, uuid, phone, name, vip, activeBalance, flexBalance, teamSize, kycStatus, status, joined };
  });
}

export function generateDeposits() {
  return Array.from({ length: 14 }, (_, i) => ({
    type: 'deposit',
    txId: 'DP' + (5809120 + i * 37),
    userSeq: (i * 5) % 36,
    network: NETWORKS[i % 4],
    address: i % 4 === 0 ? TRC20_DEPOSIT : BEP20_ADDRESS,
    amount: [100, 500, 70, 1000, 250, 3600][i % 6],
    status: 'Credited',
    txHash: '0x' + (0xa3f9c2 + i * 7919).toString(16) + '…' + (0x4e1b + i * 131).toString(16),
    createdAt: new Date(Date.UTC(2026, 10, 6 - Math.floor(i / 4), 9 + (i % 12), (i * 13) % 60)),
  }));
}

export function generateWithdrawals() {
  return Array.from({ length: 12 }, (_, i) => ({
    type: 'withdrawal',
    txId: 'WD' + (3301200 + i * 41),
    userSeq: (i * 7 + 3) % 36,
    network: 'USDT TRC20',
    address: TRC20_ADDRESS,
    amount: [50, 120, 300, 80, 1500, 45][i % 6],
    status: i < 6 ? 'Pending' : i % 4 === 0 ? 'Rejected' : 'Paid',
    createdAt: new Date(Date.UTC(2026, 10, 6 - Math.floor(i / 4), 8 + (i % 12), (i * 17) % 60)),
  }));
}

export function generateKyc(users) {
  return users
    .filter((u) => u.kycStatus === 'pending')
    .slice(0, 6)
    .map((u, i) => ({
      userSeq: u.seq,
      country: COUNTRIES[i % COUNTRIES.length],
      documentType: DOC_TYPES[i % DOC_TYPES.length],
      documentNumber: 'X' + (4820000 + i * 7311),
      submittedAt: new Date(Date.now() - (i + 1) * 12 * 60000),
      status: 'pending',
    }));
}

export function generateOrders() {
  return Array.from({ length: 16 }, (_, i) => {
    const vip = 1 + (i % 4);
    const amount = [300, 1200, 2500, 5000][vip - 1];
    const rate = [1.58, 1.75, 1.95, 2.2][vip - 1];
    const income = (amount * rate) / 100;
    const total = income / 0.7;
    return {
      orderId: 'HT2048' + (18331 - i * 97),
      userSeq: (i * 3) % 36,
      vip,
      amount,
      total,
      income,
      fee: total - income,
      createdAt: new Date(Date.UTC(2026, 10, 6 - Math.floor(i / 5), 8 + (i % 12), (i * 7) % 60, i % 10)),
    };
  });
}

// Team tree for one user, reproduced from the prototype. A real implementation
// would query the referral tree (e.g. $graphLookup on `referrer`).
export function buildDummyTeam(seq, teamSize) {
  let ts = seq * 977 + 13;
  const tr = () => {
    ts = (ts * 16807) % 2147483647;
    return ts / 2147483647;
  };
  let left = teamSize;
  return TEAM_RATES.map((rate, li) => {
    const n = li === 5 ? left : Math.min(left, Math.round(left * (li === 0 ? 0.4 : 0.38)));
    left -= n;
    const members = Array.from({ length: n }, () => {
      const deposit = tr() < 0.25 ? 0 : MEMBER_DEPOSITS[Math.floor(tr() * 6)];
      const uuid = String(20480000 + Math.floor(tr() * 9e5));
      const dial = DIALS[Math.floor(tr() * 6)];
      const phone = makePhone(tr, dial);
      const vip = deposit >= 3600 ? 4 : deposit >= 600 ? 2 : deposit >= 70 ? 1 : 0;
      const month = 7 + Math.floor(tr() * 4);
      const day = 1 + Math.floor(tr() * 28);
      const joined = new Date(Date.UTC(2026, month - 1, day));
      const active = deposit > 0 && tr() < 0.85;
      return { uuid, phone, vip, deposit, joined, active };
    });
    const deposits = members.reduce((a, m) => a + m.deposit, 0);
    return { name: 'L' + (li + 1), rate, members, deposits, commission: (deposits * rate) / 100 };
  });
}
