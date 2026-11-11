// Connects another launchpad to the terminal. See launchpads/README.md.
//   node scripts/launchpad.mjs add 0xTheirContract "Their Name" [--abi file.json] [--id their-name] [--force]
//   node scripts/launchpad.mjs check their-name [--real] [--zro 0.0002]
// `add` writes launchpads/<id>.json from an ABI and says what it couldn't work out. Without an ABI it writes a file that only
// names the launchpad, and lists what the contract has been doing. `check` reads a file against the chain and spends nothing.
// With --real it launches, buys and sells for tiny amounts from the test wallet, and confirms each event reads as the file says.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatEther, http, parseAbiItem, parseEther, toFunctionSelector, toEventSelector, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8546';
const chain = { id: CHAIN_ID, name: 'Zero', nativeCurrency: { name: 'ZRO', symbol: 'ZRO', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const client = createPublicClient({ chain, transport: http(RPC, { timeout: 15_000 }) });

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = rest[i + 1];
  rest.splice(i, next && !next.startsWith('--') ? 2 : 1);
  return next && !next.startsWith('--') ? next : true;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fileOf = (id) => join(ROOT, 'launchpads', `${id}.json`);

// ------------------------------------------------------------------ add

const has = (re, s) => re.test(s ?? '');
const inputSignature = (i) => (i.type.startsWith('tuple') ? null : `${i.type}${i.indexed ? ' indexed' : ''}${i.name ? ` ${i.name}` : ''}`);
const signature = (item) => {
  const inputs = item.inputs.map(inputSignature);
  if (inputs.includes(null)) return null;
  if (item.type === 'event') return `event ${item.name}(${inputs.join(', ')})`;
  const outs = (item.outputs ?? []).map((o) => `${o.type}${o.name ? ` ${o.name}` : ''}`).join(', ');
  const mutability = item.stateMutability === 'nonpayable' ? '' : ` ${item.stateMutability}`;
  return `function ${item.name}(${inputs.join(', ')})${mutability}${outs ? ` returns (${outs})` : ''}`;
};

/** What to put for one argument of a call, going by its type and name. Null means it couldn't tell. */
function argFor(input, side, used) {
  const { type, name } = input;
  if (type === 'string') {
    if (has(/symbol|ticker/i, name)) return '{symbol}';
    if (has(/name/i, name) && !has(/uri/i, name)) return '{name}';
    if (has(/desc/i, name)) return '{description}';
    if (has(/image|logo|icon/i, name)) return '{image}';
    return has(/uri|meta/i, name) ? '{uri}' : null;
  }
  if (type === 'address') {
    if (side !== 'launch' && !used.has('{token}')) return '{token}';
    if (has(/ref|invit|partner|affiliate/i, name)) return zeroAddress;
    return '{to}';
  }
  if (/^u?int/.test(type)) {
    if (has(/deadline|expir|until/i, name)) return '{deadline}';
    if (has(/min|limit|slippage|out/i, name)) return '{minOut}';
    if (side === 'launch') return has(/buy|amount|value|initial|dev/i, name) ? '{firstBuy}' : null;
    if (side === 'buy') return has(/amount|funds|value|zro|eth|in/i, name) ? '{zro}' : null;
    return '{amount}';
  }
  return null;
}

function callFrom(item, side) {
  const text = signature(item);
  if (!text) return { unclear: [`${item.name} takes a tuple, which a file can't describe yet`] };
  const used = new Set();
  const unclear = [];
  const args = item.inputs.map((input) => {
    const arg = argFor(input, side, used);
    if (arg === null) {
      unclear.push(`${item.name}: what goes in "${input.name || input.type}"?`);
      return `TODO ${input.name || input.type}`;
    }
    used.add(arg);
    return arg;
  });
  return { call: { function: text, args }, unclear };
}

function eventFrom(item, kind) {
  const text = signature(item);
  if (!text) return { unclear: [`${item.name} has a tuple, which a file can't describe yet`] };
  const fields = item.inputs;
  const named = (re, types) => fields.find((f) => types.includes(f.type) && has(re, f.name))?.name;
  const unclear = [];
  const out = { event: text };
  const nameless = fields.some((f) => !f.name);
  if (nameless) return { unclear: [`${item.name} has unnamed fields, so it can't be mapped`] };
  const addresses = fields.filter((f) => f.type === 'address').map((f) => f.name);
  out.token = named(/token|mint|coin/i, ['address']) ?? addresses[0];
  if (kind === 'created') {
    const creator = named(/creator|dev|owner|deployer|sender|from/i, ['address']);
    if (creator) out.creator = creator;
    const uri = named(/uri|image|logo|meta/i, ['string']);
    if (uri) out.uri = uri;
  } else if (kind !== 'graduated') {
    out.trader = named(/buyer|seller|trader|user|account|sender|maker|recipient|^to$/i, ['address']) ?? addresses.find((a) => a !== out.token);
    const uints = fields.filter((f) => /^uint/.test(f.type)).map((f) => f.name);
    out.zro = uints.find((n) => has(/zro|eth|native|paid|cost|funds|received|proceed|value/i, n) && !has(/reserve|raised|price|fee/i, n));
    out.tokens = uints.find((n) => n !== out.zro && has(/token|amount|got|qty|shares/i, n) && !has(/reserve|raised|price|fee/i, n));
    const raised = uints.find((n) => has(/raised|collected|realeth|realzro/i, n));
    if (raised) out.raised = raised;
    const reserveZro = uints.find((n) => has(/(reserve|virtual).*(zro|eth)|(zro|eth).*reserve/i, n));
    const reserveToken = uints.find((n) => has(/(reserve|virtual).*token|token.*reserve/i, n));
    if (reserveZro && reserveToken) Object.assign(out, { reserveZro, reserveToken });
    if (kind === 'trade') {
      out.isBuy = named(/buy|side/i, ['bool']) ?? fields.find((f) => f.type === 'bool')?.name;
      if (!out.isBuy) unclear.push(`${item.name}: which field says it's a buy?`);
    }
    for (const key of ['trader', 'zro', 'tokens']) if (!out[key]) unclear.push(`${item.name}: which field is "${key}"?`);
  }
  if (!out.token) unclear.push(`${item.name}: which field is the token?`);
  return { map: out, unclear };
}

const pick = (items, re, not) => items.find((i) => has(re, i.name) && !has(not ?? /$^/, i.name));

function draftFromAbi(abi, pad) {
  const unclear = [];
  const fns = abi.filter((i) => i.type === 'function');
  const writes = fns.filter((f) => f.stateMutability === 'payable' || f.stateMutability === 'nonpayable');
  const reads = fns.filter((f) => f.stateMutability === 'view' || f.stateMutability === 'pure');
  const events = abi.filter((i) => i.type === 'event');

  const launch = writes.find((f) => has(/create|launch|deploy|new.*token|mint.*token/i, f.name) && f.inputs.filter((x) => x.type === 'string').length >= 2);
  const buy = pick(writes.filter((f) => f.stateMutability === 'payable' && f !== launch), /buy|purchase|swap.*(eth|zro).*token/i);
  const sell = pick(writes.filter((f) => f.stateMutability === 'nonpayable'), /sell|dump|swap.*token.*(eth|zro)/i);
  const quoteBuy = pick(reads, /(quote|preview|get|try|calc|estimate).*(buy|purchase|tokensout|amountout)/i);
  const quoteSell = pick(reads, /(quote|preview|get|try|calc|estimate).*(sell|dump|zroout|ethout)/i);

  const add = (key, item, side) => {
    if (!item) return unclear.push(`No function looks like "${key}". Without it, ${key === 'launch' ? "it isn't offered on the Launch page" : key.startsWith('quote') ? 'trades go with no minimum' : "its tokens can't be traded from here"}.`);
    const { call, unclear: more } = callFrom(item, side);
    unclear.push(...more);
    if (!call) return;
    pad[key] = call;
    if (key.startsWith('quote') && item.outputs.length > 1) {
      const at = item.outputs.findIndex((o) => has(key === 'quoteBuy' ? /token|amount|out/i : /zro|eth|funds|amount|out/i, o.name));
      pad[key].output = Math.max(at, 0);
      unclear.push(`${item.name} returns several values, and output ${pad[key].output} (${item.outputs[pad[key].output].name}) was chosen.`);
    }
    if (key === 'launch') {
      const meta = call.args.includes('{uri}');
      pad.launch.fields = ['name', 'symbol', ...(meta || call.args.includes('{image}') ? ['image'] : []), ...(meta || call.args.includes('{description}') ? ['description'] : []), ...(meta ? ['links'] : []), ...(item.stateMutability === 'payable' || call.args.includes('{firstBuy}') ? ['firstBuy'] : [])];
      const fee = reads.find((f) => has(/(launch|creat|deploy).*fee|fee.*(launch|creat)/i, f.name) && f.inputs.length === 0);
      if (fee) pad.launch.fee = { read: signature(fee) };
    }
  };
  add('launch', launch, 'launch');
  add('buy', buy, 'buy');
  add('sell', sell, 'sell');
  // A quote takes its input the same way whichever side it's on.
  add('quoteBuy', quoteBuy, 'sell');
  add('quoteSell', quoteSell, 'sell');

  pad.events = {};
  const addEvent = (kind, item) => {
    if (!item) return false;
    const { map, unclear: more } = eventFrom(item, kind);
    unclear.push(...more);
    if (map) pad.events[kind] = map;
    return true;
  };
  addEvent('created', pick(events, /created|launched|born|newtoken|deployed/i));
  const bought = addEvent('buy', pick(events, /bought|purchase|buy/i));
  const sold = addEvent('sell', pick(events, /sold|sell|dump/i));
  if (!bought || !sold) {
    if (!addEvent('trade', pick(events, /trade|swap/i))) unclear.push('No event looks like a trade, so its tokens will have no prices or charts.');
  }
  addEvent('graduated', pick(events, /graduat|complete|migrat|listed|bonded|launched.?on/i));
  return unclear;
}

async function seenOnChain(address) {
  const head = await client.getBlockNumber();
  const topics = new Set();
  const txs = new Set();
  let first = null;
  for (let to = head, i = 0; i < 300 && txs.size < 30; i++, to -= 1000n) {
    if (to < 1000n) break;
    const logs = await client.request({ method: 'eth_getLogs', params: [{ address, fromBlock: `0x${(to - 999n).toString(16)}`, toBlock: `0x${to.toString(16)}` }] });
    for (const l of logs) {
      topics.add(l.topics[0]);
      txs.add(l.transactionHash);
      const at = Number(BigInt(l.blockNumber));
      first = first === null ? at : Math.min(first, at);
    }
  }
  const selectors = new Set();
  await Promise.all([...txs].map(async (hash) => {
    const t = await client.getTransaction({ hash }).catch(() => null);
    if (t?.to?.toLowerCase() === address.toLowerCase()) selectors.add(t.input.slice(0, 10));
  }));
  return { topics: [...topics], selectors: [...selectors], first };
}

async function add() {
  const force = flag('force');
  const abiPath = flag('abi');
  const idFlag = flag('id');
  const [address, name] = rest;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '') || !name) throw new Error('Give the contract address and a name: add 0x... "Their Name"');
  const id = idFlag ?? slug(name);
  const path = fileOf(id);
  if (existsSync(path) && !force) throw new Error(`launchpads/${id}.json already exists. Add --force to replace it.`);
  const code = await client.getCode({ address });
  if (!code || code === '0x') throw new Error(`There's no contract at ${address} on chain ${CHAIN_ID}.`);

  const seen = await seenOnChain(address);
  const pad = { id, name, chainId: CHAIN_ID, contract: address, description: `Run by ${name}, with its own curve and fees.` };
  if (seen.first) pad.startBlock = seen.first;

  let unclear = [];
  if (abiPath) {
    const parsed = JSON.parse(readFileSync(abiPath, 'utf8'));
    unclear = draftFromAbi(Array.isArray(parsed) ? parsed : parsed.abi, pad);
  } else {
    unclear.push('No ABI given, so this only names the launchpad and labels its tokens. Launching, trading and prices need its ABI: add --abi file.json --force.');
    console.log(`Seen on the chain lately: ${seen.selectors.length} functions called (${seen.selectors.join(', ') || 'none'}), ${seen.topics.length} events.`);
  }
  writeFileSync(path, `${JSON.stringify(pad, null, 2)}\n`);
  console.log(`Wrote launchpads/${id}.json`);
  if (unclear.length) {
    console.log(`\nTo look at:`);
    for (const u of unclear) console.log(`  - ${u}`);
  }
  console.log(`\nNext: node scripts/launchpad.mjs check ${id}`);
}

// ------------------------------------------------------------------ check

const FILLS = new Set(['name', 'symbol', 'uri', 'image', 'description', 'firstBuy', 'token', 'zro', 'amount', 'minOut', 'to', 'deadline']);
let failed = 0;
const ok = (s) => console.log(`  ok    ${s}`);
const bad = (s) => {
  failed++;
  console.log(`  FAIL  ${s}`);
};
const note = (s) => console.log(`  note  ${s}`);

function fillArgs(spec, values) {
  const item = parseAbiItem(spec.function);
  return { item, args: spec.args.map((a, i) => {
    const raw = typeof a === 'string' && /^\{\w+\}$/.test(a) ? values[a.slice(1, -1)] : a;
    const type = item.inputs[i]?.type ?? '';
    if (/^u?int/.test(type)) return BigInt(raw);
    if (type === 'bool') return raw === true || raw === 'true';
    return raw;
  }) };
}

function checkShape(pad) {
  for (const key of ['launch', 'buy', 'sell', 'quoteBuy', 'quoteSell']) {
    const spec = pad[key];
    if (!spec) {
      note(`no "${key}"`);
      continue;
    }
    try {
      const item = parseAbiItem(spec.function);
      if (item.inputs.length !== spec.args.length) throw new Error(`${item.inputs.length} inputs but ${spec.args.length} args`);
      const unknown = spec.args.filter((a) => typeof a === 'string' && (/^\{\w+\}$/.test(a) ? !FILLS.has(a.slice(1, -1)) : a.startsWith('TODO')));
      if (unknown.length) throw new Error(`can't fill ${unknown.join(', ')}`);
      ok(`${key}: ${item.name} (${toFunctionSelector(item)})`);
    } catch (err) {
      bad(`${key}: ${err.shortMessage ?? err.message}`);
    }
  }
  for (const [kind, map] of Object.entries(pad.events ?? {})) {
    try {
      const item = parseAbiItem(map.event);
      const names = item.inputs.map((i) => i.name);
      const need = ['token', ...(['buy', 'sell', 'trade'].includes(kind) ? ['trader', 'zro', 'tokens'] : []), ...(kind === 'trade' ? ['isBuy'] : [])];
      for (const key of need) if (!map[key]) throw new Error(`needs "${key}"`);
      for (const key of ['token', 'trader', 'creator', 'uri', 'zro', 'tokens', 'isBuy', 'raised', 'reserveZro', 'reserveToken']) if (map[key] && !names.includes(map[key])) throw new Error(`"${map[key]}" isn't a field of it`);
      ok(`event ${kind}: ${item.name} (${toEventSelector(item).slice(0, 10)})`);
    } catch (err) {
      bad(`event ${kind}: ${err.shortMessage ?? err.message}`);
    }
  }
  if (!pad.events || !Object.keys(pad.events).length) note('no events, so its tokens get no prices or charts');
}

/** Finds the decoded event the file describes among a receipt's logs. */
function readEvent(pad, kind, logs) {
  const map = pad.events?.[kind];
  if (!map) return null;
  const item = parseAbiItem(map.event);
  const topic = toEventSelector(item);
  const log = logs.find((l) => l.address.toLowerCase() === pad.contract.toLowerCase() && l.topics[0] === topic);
  if (!log) return { map, missing: true };
  return { map, args: decodeEventLog({ abi: [item], data: log.data, topics: log.topics }).args };
}

async function realRun(pad, zroText) {
  const key = readFileSync(join(ROOT, '.local', 'tester-devnet.key'), 'utf8').trim();
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ chain, account, transport: http(RPC, { timeout: 15_000 }) });
  const gasPrice = await client.getGasPrice();
  const zro = parseEther(zroText);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const receiptOf = async (hash) => {
    for (let i = 0; i < 80; i++) {
      const r = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (r) return r;
      await new Promise((d) => setTimeout(d, 300));
    }
    throw new Error(`No receipt for ${hash}`);
  };
  const send = async (to, data, value = 0n) => {
    const gas = await client.estimateGas({ account: account.address, to, data, value });
    const hash = await wallet.sendTransaction({ to, data, value, gas: (gas * 12n) / 10n, gasPrice });
    return receiptOf(hash);
  };
  const callOf = (spec, values) => {
    const { item, args } = fillArgs(spec, values);
    return encodeFunctionData({ abi: [item], args });
  };
  const expect = (what, read, want) => {
    if (!read) return note(`${what}: the file names no event for this`);
    if (read.missing) return bad(`${what}: the event never appeared`);
    for (const [field, value] of Object.entries(want)) {
      const name = read.map[field];
      if (!name) continue;
      const got = read.args[name];
      const same = typeof value === 'function' ? value(got) : String(got).toLowerCase() === String(value).toLowerCase();
      if (same) ok(`${what}: ${field} is ${typeof got === 'bigint' && field !== 'tokens' ? formatEther(got) : got}`);
      else bad(`${what}: ${field} read as ${got}, which isn't right`);
    }
  };

  console.log(`\nReal run from ${account.address}, ${zroText} ZRO:`);
  if (!pad.launch) return bad('no "launch" to run');
  const fields = pad.launch.fields ?? [];
  const fee = pad.launch.fee ? (typeof pad.launch.fee === 'string' ? parseEther(pad.launch.fee) : await client.readContract({ address: pad.contract, abi: [parseAbiItem(pad.launch.fee.read)], functionName: parseAbiItem(pad.launch.fee.read).name })) : 0n;
  const firstBuy = fields.includes('firstBuy') ? zro : 0n;
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  const launched = await send(pad.contract, callOf(pad.launch, { name: `Check ${stamp}`, symbol: `C${stamp}`, uri: '', image: '', description: '', firstBuy, minOut: 0n, to: account.address, deadline }), firstBuy + fee);
  if (launched.status !== 'success') return bad('launch reverted');
  ok(`launch went through, gas ${launched.gasUsed}`);
  const mint = launched.logs.find((l) => l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' && /^0x0+$/.test(l.topics[1]));
  const token = mint?.address;
  if (!token) return bad('no token mint in the launch');
  ok(`token ${token}`);
  expect('created', readEvent(pad, 'created', launched.logs), { token, creator: account.address });

  const reading = (kindA, logs) => readEvent(pad, kindA, logs) ?? readEvent(pad, 'trade', logs);
  if (pad.buy) {
    const quote = pad.quoteBuy ? await client.readContract({ address: pad.contract, abi: [fillArgs(pad.quoteBuy, { token, amount: zro, zro }).item], functionName: fillArgs(pad.quoteBuy, { token, amount: zro, zro }).item.name, args: fillArgs(pad.quoteBuy, { token, amount: zro, zro }).args }) : null;
    const quoted = quote === null ? null : BigInt(Array.isArray(quote) ? quote[pad.quoteBuy.output ?? 0] : quote);
    if (quoted !== null) (quoted > 0n ? ok : bad)(`quoteBuy says ${formatEther(quoted)} tokens for ${zroText} ZRO`);
    const bought = await send(pad.contract, callOf(pad.buy, { token, zro, amount: zro, minOut: quoted === null ? 0n : (quoted * 95n) / 100n, to: account.address, deadline }), zro);
    if (bought.status !== 'success') return bad('buy reverted');
    ok(`buy went through, gas ${bought.gasUsed}`);
    expect('buy event', reading('buy', bought.logs), { token, trader: account.address, zro: (v) => v > 0n && v <= zro, tokens: (v) => v > 0n, isBuy: (v) => v === true });
  } else note('no "buy" to run');

  const abiErc20 = [parseAbiItem('function balanceOf(address) view returns (uint256)'), parseAbiItem('function approve(address,uint256) returns (bool)')];
  const held = await client.readContract({ address: token, abi: abiErc20, functionName: 'balanceOf', args: [account.address] });
  if (pad.sell && held > 0n) {
    const amount = held / 2n;
    const spender = pad.sell.spender ?? pad.contract;
    const approved = await send(token, encodeFunctionData({ abi: abiErc20, functionName: 'approve', args: [spender, amount] }));
    if (approved.status !== 'success') return bad('approve reverted');
    const quote = pad.quoteSell ? await client.readContract({ address: pad.contract, abi: [fillArgs(pad.quoteSell, { token, amount }).item], functionName: fillArgs(pad.quoteSell, { token, amount }).item.name, args: fillArgs(pad.quoteSell, { token, amount }).args }) : null;
    const quoted = quote === null ? null : BigInt(Array.isArray(quote) ? quote[pad.quoteSell.output ?? 0] : quote);
    if (quoted !== null) (quoted > 0n ? ok : bad)(`quoteSell says ${formatEther(quoted)} ZRO for half`);
    const sold = await send(pad.contract, callOf(pad.sell, { token, amount, minOut: quoted === null ? 0n : (quoted * 95n) / 100n, to: account.address, deadline }));
    if (sold.status !== 'success') return bad('sale reverted');
    ok(`sale went through, gas ${sold.gasUsed}`);
    expect('sell event', reading('sell', sold.logs), { token, trader: account.address, zro: (v) => v > 0n, tokens: amount, isBuy: (v) => v === false });
  } else note(pad.sell ? 'nothing held to sell' : 'no "sell" to run');
}

async function check() {
  const real = flag('real');
  const zroText = flag('zro') ?? '0.0002';
  const [which] = rest;
  if (!which) throw new Error('Give a launchpad: check their-name');
  const path = existsSync(which) ? which : fileOf(which);
  if (!existsSync(path)) throw new Error(`No file at ${path}`);
  const pad = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`${pad.name} (${pad.id}), chain ${pad.chainId}, ${pad.contract}`);
  if (pad.chainId !== CHAIN_ID) note(`this file is for chain ${pad.chainId} and this check reads chain ${CHAIN_ID}`);
  const code = await client.getCode({ address: pad.contract });
  if (!code || code === '0x') bad('no contract at that address');
  else ok(`contract found, ${(code.length - 2) / 2} bytes`);
  checkShape(pad);
  if (real && !failed) await realRun(pad, zroText);
  else if (!real) console.log('\nThat checked the file. --real also launches, buys and sells for tiny amounts and reads the events.');
  console.log(failed ? `\n${failed} problem${failed > 1 ? 's' : ''}.` : '\nAll good.');
  process.exit(failed ? 1 : 0);
}

const run = { add, check }[command];
if (!run) {
  console.log('Use: node scripts/launchpad.mjs add 0x... "Name" [--abi file.json]   or   node scripts/launchpad.mjs check id [--real]');
  process.exit(1);
}
run().then(
  () => process.exit(0),
  (err) => {
    console.error(err.shortMessage ?? err.message);
    process.exit(1);
  },
);
