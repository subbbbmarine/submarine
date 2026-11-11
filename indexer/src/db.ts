import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type InArgs, type InStatement, type Row } from '@libsql/client';
import { DB_PATH } from './config.js';

mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = createClient({ url: `file:${DB_PATH}` });

export const all = async (sql: string, args: InArgs = []): Promise<Row[]> => (await db.execute({ sql, args })).rows;
export const one = async (sql: string, args: InArgs = []): Promise<Row | undefined> => (await all(sql, args))[0];
export const batch = async (statements: InStatement[]): Promise<void> => {
  if (statements.length) await db.batch(statements, 'write');
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 18,
    total_supply REAL NOT NULL DEFAULT 0,
    creator TEXT,
    source TEXT NOT NULL,            -- 'terminal' for our launchpad, 'external' for anything else on the chain
    factory TEXT,                    -- the contract that created it, which is how other launchpads are told apart
    uri TEXT,
    block INTEGER NOT NULL,
    tx_hash TEXT,
    created_at INTEGER NOT NULL,
    graduated INTEGER NOT NULL DEFAULT 0,
    has_pool INTEGER NOT NULL DEFAULT 0,
    raised REAL NOT NULL DEFAULT 0,
    sold REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    last_trade_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS tokens_created ON tokens(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS trades (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    token TEXT NOT NULL,
    trader TEXT NOT NULL,
    is_buy INTEGER NOT NULL,
    zro REAL NOT NULL,
    amount REAL NOT NULL,
    price REAL NOT NULL,
    venue TEXT NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS trades_token ON trades(token, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS trades_trader ON trades(trader, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS trades_ts ON trades(ts DESC)`,
  `CREATE TABLE IF NOT EXISTS candles (
    token TEXT NOT NULL,
    interval INTEGER NOT NULL,
    t INTEGER NOT NULL,
    o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
    v REAL NOT NULL,
    PRIMARY KEY (token, interval, t)
  )`,
  `CREATE TABLE IF NOT EXISTS balances (
    token TEXT NOT NULL,
    holder TEXT NOT NULL,
    wei TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (token, holder)
  )`,
  `CREATE INDEX IF NOT EXISTS balances_holder ON balances(holder)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL,
    token TEXT NOT NULL,
    is_buy INTEGER NOT NULL,
    amount TEXT NOT NULL,
    min_out TEXT NOT NULL,
    filled TEXT NOT NULL DEFAULT '0',
    expiry INTEGER NOT NULL,
    open INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS orders_owner ON orders(owner, id DESC)`,
  `CREATE INDEX IF NOT EXISTS orders_token ON orders(token, id DESC)`,
  `CREATE TABLE IF NOT EXISTS order_fills (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    zro REAL NOT NULL,
    tokens REAL NOT NULL,
    keeper TEXT NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS order_fills_id ON order_fills(id, ts)`,
  // What a token's creator did with its coins besides trading them. Trades live in the trades table.
  `CREATE TABLE IF NOT EXISTS dev_moves (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    token TEXT NOT NULL,
    kind TEXT NOT NULL,              -- 'transfer' or 'burn'
    to_addr TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS dev_moves_token ON dev_moves(token, ts)`,
  // Fees as the contracts report them: 'curve' splits between the creator and the treasury, 'router' is all treasury.
  `CREATE TABLE IF NOT EXISTS fee_events (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    token TEXT NOT NULL,
    kind TEXT NOT NULL,
    to_treasury REAL NOT NULL,
    to_creator REAL NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS fee_events_ts ON fee_events(ts)`,
  // Where the earners' part went: the creator, the holders, and ZRO that bought the token back to burn it.
  `CREATE TABLE IF NOT EXISTS earner_events (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    token TEXT NOT NULL,
    to_creator REAL NOT NULL,
    to_holders REAL NOT NULL,
    to_burn REAL NOT NULL,
    burned REAL NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS earner_events_token ON earner_events(token)`,
  `CREATE TABLE IF NOT EXISTS buybacks (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    token TEXT NOT NULL,
    zro REAL NOT NULL,
    tokens REAL NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Wallet-to-wallet transfers of the tokens we follow, which is what links wallets on the holders' map.
  `CREATE TABLE IF NOT EXISTS transfers (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    token TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS transfers_token ON transfers(token)`,
  // CopyVault: who follows whom on what terms, take profit and stop loss, and every movement of a follower's money.
  `CREATE TABLE IF NOT EXISTS vault_follows (
    follower TEXT NOT NULL,
    leader TEXT NOT NULL,
    rules TEXT NOT NULL,
    active INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (follower, leader)
  )`,
  `CREATE TABLE IF NOT EXISTS vault_exits (follower TEXT PRIMARY KEY, take_profit_bps INTEGER NOT NULL, stop_loss_bps INTEGER NOT NULL, slippage_bps INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS vault_events (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    follower TEXT NOT NULL,
    kind TEXT NOT NULL,              -- deposit, withdraw, copy_buy, copy_sell, exit, sell, tokens_out
    leader TEXT,
    token TEXT,
    zro REAL NOT NULL DEFAULT 0,
    tokens REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS vault_events_follower ON vault_events(follower, ts DESC)`,
  `CREATE TABLE IF NOT EXISTS referral_links (trader TEXT PRIMARY KEY, referrer TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS referral_links_referrer ON referral_links(referrer)`,
  `CREATE TABLE IF NOT EXISTS referral_credits (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    trader TEXT NOT NULL,
    referrer TEXT NOT NULL,
    to_referrer REAL NOT NULL,
    to_trader REAL NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  )`,
  `CREATE TABLE IF NOT EXISTS referral_claims (tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, ts INTEGER NOT NULL, who TEXT NOT NULL, amount REAL NOT NULL, PRIMARY KEY (tx_hash, log_index))`,
];

export async function initSchema(): Promise<void> {
  await db.execute('PRAGMA journal_mode = WAL');
  await db.batch(SCHEMA, 'write');
  // Columns added after the first release, for a database that already exists.
  await addColumns('orders', {
    closed_at: 'INTEGER',
    closed_expired: 'INTEGER NOT NULL DEFAULT 0',
    filled_out: "TEXT NOT NULL DEFAULT '0'",
    fills: 'INTEGER NOT NULL DEFAULT 0',
    // What the order waits for, as LimitOrders.sol numbers its kinds. A sale group's legs share `grp`, its first leg's id.
    kind: 'INTEGER NOT NULL DEFAULT 0',
    trigger_wei: "TEXT NOT NULL DEFAULT '0'",
    trail_bps: 'INTEGER NOT NULL DEFAULT 0',
    interval_s: 'INTEGER NOT NULL DEFAULT 0',
    slices: 'INTEGER NOT NULL DEFAULT 0',
    grp: 'INTEGER',
  });
  await addColumns('tokens', { graduated_at: 'INTEGER', liquidity: 'REAL NOT NULL DEFAULT 0', launchpad: 'TEXT', description: 'TEXT', links: 'TEXT', fee_bps: 'INTEGER NOT NULL DEFAULT 100', fee_route: 'INTEGER NOT NULL DEFAULT 0', anti_snipe: 'INTEGER NOT NULL DEFAULT 0', holders_bps: 'INTEGER NOT NULL DEFAULT 0', burn_bps: 'INTEGER NOT NULL DEFAULT 0' });
  await db.execute('CREATE INDEX IF NOT EXISTS tokens_launchpad ON tokens(launchpad)');
}

async function addColumns(table: string, columns: Record<string, string>): Promise<void> {
  const have = new Set((await all(`PRAGMA table_info(${table})`)).map((r) => String(r.name)));
  for (const [name, type] of Object.entries(columns)) {
    if (!have.has(name)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export async function getState(key: string): Promise<string | null> {
  const row = await one('SELECT value FROM state WHERE key = ?', [key]);
  return row ? String(row.value) : null;
}
