// ---------------------------------------------------------------------------
// DUMMY DATA ONLY.
// Makes the demo data for seed.js and the dummy team in routes/users.js. It copies the mock data of the
// original Halo Admin prototype, using the same "seeded" random generator in the same order, so every run
// produces exactly the same numbers as the design. When real data exists, stop using this file and delete it.
//
// Note for readers: the ORDER of the random() calls matters. Changing it (even reordering two lines)
// changes every value that comes after, so the data would no longer match the prototype.
// ---------------------------------------------------------------------------

// Demo numbers added on the dashboard so it looks like a busy platform (see routes/dashboard.js).
export const DUMMY = {
  userCountOffset: 12418, // added to the real user count
  balanceOffset: 2100000, // added to the real total of user balances
  activeToday: 3206, // fixed "active today" figure
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
const TEAM_RATES = [10, 5, 3, 2, 1, 1]; // commission % per team level (level 1 … level 6)
const MEMBER_DEPOSITS = [70, 100, 300, 500, 1000, 3600];
const UUID_BASE = 20480000;
const DEMO_YEAR = 2026;
const MILLISECONDS_PER_MINUTE = 60000;

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

// A "seeded" random number generator (Park–Miller). Unlike Math.random(), the same seed always gives the
// same sequence of numbers between 0 and 1, which is what keeps the demo data identical on every run.
export function createRng(seed = 7) {
  const MULTIPLIER = 16807;
  const MODULUS = 2147483647;
  let state = seed;
  return () => {
    state = (state * MULTIPLIER) % MODULUS;
    return state / MODULUS;
  };
}

// A masked phone number like "+44 317****436" (two random 3-digit blocks, generated in this order).
const makePhone = (random, dialCode) => {
  const firstDigits = 100 + Math.floor(random() * 899);
  const lastDigits = 100 + Math.floor(random() * 899);
  return `${dialCode} ${firstDigits}****${lastDigits}`;
};

// The demo users. `seq` is each user's position (0, 1, 2, …); seed.js uses it to link other rows to users.
export function generateUsers(count = 36) {
  const random = createRng(7);
  return Array.from({ length: count }, (_, index) => {
    const uuid = String(UUID_BASE + Math.floor(random() * 9e5));
    const phone = makePhone(random, DIALS[index % DIALS.length]);
    const name = NAMES[index % NAMES.length];
    const vip = Math.floor(random() * 5); // VIP 0–4
    const activeBalance = Math.round(random() * 6000 * 100) / 100; // 2 decimals
    const flexBalance = Math.round(random() * 900 * 100) / 100;
    const teamSize = Math.floor(random() * 40);
    // 60% verified; otherwise half pending, half none. (The second random() only runs when the first check fails.)
    const kycStatus = random() < 0.6 ? 'verified' : random() < 0.5 ? 'pending' : 'none';
    const status = random() < 0.08 ? 'frozen' : 'active';
    const month = 6 + Math.floor(random() * 5); // June–October
    const day = 1 + Math.floor(random() * 28);
    const joined = new Date(Date.UTC(DEMO_YEAR, month - 1, day));
    return { seq: index, uuid, phone, name, vip, activeBalance, flexBalance, teamSize, kycStatus, status, joined };
  });
}

// 14 completed deposits spread over a few days.
export function generateDeposits() {
  return Array.from({ length: 14 }, (_, index) => ({
    type: 'deposit',
    txId: 'DP' + (5809120 + index * 37),
    userSeq: (index * 5) % 36,
    network: NETWORKS[index % 4],
    address: index % 4 === 0 ? TRC20_DEPOSIT : BEP20_ADDRESS,
    amount: [100, 500, 70, 1000, 250, 3600][index % 6],
    status: 'Credited',
    // A shortened fake transaction hash like "0xa3f9c2…4e1b".
    txHash: '0x' + (0xa3f9c2 + index * 7919).toString(16) + '…' + (0x4e1b + index * 131).toString(16),
    createdAt: new Date(Date.UTC(DEMO_YEAR, 10, 6 - Math.floor(index / 4), 9 + (index % 12), (index * 13) % 60)),
  }));
}

// 12 withdrawals: the first 6 are pending (waiting for the admin), the rest paid or rejected.
export function generateWithdrawals() {
  return Array.from({ length: 12 }, (_, index) => {
    let status;
    if (index < 6) status = 'Pending';
    else if (index % 4 === 0) status = 'Rejected';
    else status = 'Paid';

    return {
      type: 'withdrawal',
      txId: 'WD' + (3301200 + index * 41),
      userSeq: (index * 7 + 3) % 36,
      network: 'USDT TRC20',
      address: TRC20_ADDRESS,
      amount: [50, 120, 300, 80, 1500, 45][index % 6],
      status,
      createdAt: new Date(Date.UTC(DEMO_YEAR, 10, 6 - Math.floor(index / 4), 8 + (index % 12), (index * 17) % 60)),
    };
  });
}

// KYC requests for up to 6 users whose KYC status is "pending", submitted 12, 24, 36… minutes ago.
export function generateKyc(users) {
  return users
    .filter((user) => user.kycStatus === 'pending')
    .slice(0, 6)
    .map((user, index) => ({
      userSeq: user.seq,
      country: COUNTRIES[index % COUNTRIES.length],
      documentType: DOC_TYPES[index % DOC_TYPES.length],
      documentNumber: 'X' + (4820000 + index * 7311),
      submittedAt: new Date(Date.now() - (index + 1) * 12 * MILLISECONDS_PER_MINUTE),
      status: 'pending',
    }));
}

// 16 demo orders copied from the prototype (VIP 1–4 in turn). Only their "fee" total is used, on the dashboard.
export function generateOrders() {
  return Array.from({ length: 16 }, (_, index) => {
    const vip = 1 + (index % 4);
    const amount = [300, 1200, 2500, 5000][vip - 1];
    const rate = [1.58, 1.75, 1.95, 2.2][vip - 1];
    const income = (amount * rate) / 100;
    const total = income / 0.7;
    return {
      orderId: 'HT2048' + (18331 - index * 97),
      userSeq: (index * 3) % 36,
      vip,
      amount,
      total,
      income,
      fee: total - income,
      createdAt: new Date(Date.UTC(DEMO_YEAR, 10, 6 - Math.floor(index / 5), 8 + (index % 12), (index * 7) % 60, index % 10)),
    };
  });
}

// A made-up 6-level team for one user (shown in the admin's user drawer, Team tab).
// The same user always gets the same team, because the random generator is seeded from the user's seq.
// A real version would read the referral tree from the database (WITH RECURSIVE over users.referrer_id).
export function buildDummyTeam(seq, teamSize) {
  const random = createRng(seq * 977 + 13);
  let membersLeft = teamSize;

  return TEAM_RATES.map((rate, levelIndex) => {
    // Level 1 gets 40% of the remaining members, levels 2–5 get 38%, level 6 gets whatever is left.
    const isLastLevel = levelIndex === TEAM_RATES.length - 1;
    const shareOfRemaining = levelIndex === 0 ? 0.4 : 0.38;
    const levelSize = isLastLevel ? membersLeft : Math.min(membersLeft, Math.round(membersLeft * shareOfRemaining));
    membersLeft -= levelSize;

    const members = Array.from({ length: levelSize }, () => {
      const deposit = random() < 0.25 ? 0 : MEMBER_DEPOSITS[Math.floor(random() * 6)];
      const uuid = String(UUID_BASE + Math.floor(random() * 9e5));
      const dialCode = DIALS[Math.floor(random() * 6)];
      const phone = makePhone(random, dialCode);

      let vip = 0;
      if (deposit >= 3600) vip = 4;
      else if (deposit >= 600) vip = 2;
      else if (deposit >= 70) vip = 1;

      const month = 7 + Math.floor(random() * 4); // July–October
      const day = 1 + Math.floor(random() * 28);
      const joined = new Date(Date.UTC(DEMO_YEAR, month - 1, day));
      // Members who never deposited are never active (and then no random number is drawn).
      const active = deposit > 0 && random() < 0.85;
      return { uuid, phone, vip, deposit, joined, active };
    });

    const deposits = members.reduce((total, member) => total + member.deposit, 0);
    return { name: 'L' + (levelIndex + 1), rate, members, deposits, commission: (deposits * rate) / 100 };
  });
}
