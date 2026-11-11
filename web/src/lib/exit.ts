'use client';

import { decodeFunctionResult, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from 'viem';
import { getDeployment } from './api';
import { buyFeeNow, LAUNCHPAD_ABI, ROUTER_ABI } from './config';
import { encodePad, padOf, spenderOf } from './launchpads';
import { quoteBuy, zroUsed } from './prep';
import { publicClient } from './wallet';

/**
 * What selling straight after buying would bring back, tried on the chain's state before a click. The buy and the sale run in
 * one eth_call through the same router a trade uses, from code the node holds for that call only: see
 * contracts/src/periphery/ExitProbe.sol. Nothing is deployed or spent.
 */
export type Exit =
  | { kind: 'ok'; bought: bigint; back: bigint; lossPct: number }
  /** The buy went through and the sale reverted. */
  | { kind: 'stuck'; bought: bigint }
  /** The test itself couldn't run, which says nothing about the token. */
  | { kind: 'unknown' };

/** forge inspect ExitProbe deployedBytecode */
const CODE: Hex = '0x6080604052600436101561001a575b3615610018575f80fd5b005b5f3560e01c63715e6e8f0361000e5760a03660031901126100dc5761003d6100e0565b60243567ffffffffffffffff81116100dc5761005d90369060040161010c565b91906100676100f6565b9160643567ffffffffffffffff81116100dc5761008890369060040161010c565b906084359467ffffffffffffffff86116100dc576100d8966100b16100b997369060040161010c565b969095610242565b6040805193845260208401929092521515908201529081906060820190565b0390f35b5f80fd5b600435906001600160a01b03821682036100dc57565b604435906001600160a01b03821682036100dc57565b9181601f840112156100dc5782359167ffffffffffffffff83116100dc57602083818601950101116100dc57565b908092918237015f815290565b634e487b7160e01b5f52604160045260245ffd5b90601f8019910116810190811067ffffffffffffffff82111761017d57604052565b610147565b3d156101bc573d9067ffffffffffffffff821161017d57604051916101b1601f8201601f19166020018461015b565b82523d5f602084013e565b606090565b908160209103126100dc575190565b6040513d5f823e3d90fd5b91928460208061021f9698979498896040519a8b98848a01378701908282015f8152815193849201905e0101915f83528237015f815203601f19810184528361015b565b565b9190820391821161022e57565b634e487b7160e01b5f52601160045260245ffd5b9395915f8091999692989499819961025f6040518093819361013a565b039034885af161026d610182565b90156103b357506040516370a0823160e01b8152306004820152956020876024816001600160a01b038d165afa9687156103ae575f97610368575b50925f949261032961033c93879687808c9e8982604051610302816102f4602082019563095ea7b360e01b875260248301919091604081019260018060a01b0316815260205f19910152565b03601f19810183528261015b565b51925af15061030f610182565b50610337479b604051948591602083019190602083019252565b03601f19810185528461015b565b6101db565b9082602083519301915af191610350610182565b50826103595750565b61036591935047610221565b91565b5f959390869592985061033c936103996103299260203d6020116103a7575b610391818361015b565b8101906101c1565b9993965093505092946102a8565b503d610387565b6101d0565b602081519101fdfea26469706673582212208002bbc7c54352e45df737535a8dcc5327cc457978fdcec57ddd1dc70a286b4f64736f6c634300081a0033';
/** Any address nothing lives at. */
const PROBE: Address = '0x00000000000000000000000000000000e41770be';
/** A stand-in for the sale's amount, found again in the calldata to split it around. */
const MARK = 0xe41770bee41770bee41770bee41770bee41770bee41770bee41770bee41770ben;
const ABI = parseAbi(['function probe(address venue, bytes buyData, address token, bytes sellHead, bytes sellTail) payable returns (uint256 bought, uint256 back, bool sold)']);
const FROM: Address = '0x000000000000000000000000000000000000dEaD';

/** A round trip losing more than this is called out: two fees and a normal market stay well under it. */
export const LOSSY = 15;

export async function checkExit(token: Address, amount: bigint): Promise<Exit> {
  try {
    const { router } = await getDeployment();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    // On another launchpad the same test runs against its own contract, which is where it matters most.
    const pad = await padOf(token);
    if (!pad) {
      // Our own coins hold what was bought for a block, against sandwiches, so a round trip in one call can never sell. Their
      // code is ours and can't tax or block a sale, so the round trip is worked out from their fees instead. The Infinity pool
      // has no LP fee of its own: a graduated coin pays its token fee each way and nothing else.
      const { launchpad } = await getDeployment();
      const [creator, createdAt, graduated, feeBps, , , antiSnipe] = await publicClient.readContract({ address: launchpad, abi: LAUNCHPAD_ABI, functionName: 'curves', args: [token] });
      if (creator !== zeroAddress) {
        const bought = await quoteBuy(token, amount);
        if (!bought) return { kind: 'unknown' };
        const buyFee = graduated ? feeBps / 10_000 : buyFeeNow(feeBps, antiSnipe, Number(createdAt));
        const keep = (1 - buyFee) * (1 - feeBps / 10_000);
        const spent = await zroUsed(token, amount);
        return { kind: 'ok', bought, back: BigInt(Math.floor(Number(spent) * keep)), lossPct: (1 - keep) * 100 };
      }
    }
    if (pad && (!pad.buy || !pad.sell || spenderOf(pad) !== pad.contract)) return { kind: 'unknown' };
    const fields = { token, zro: amount, minOut: 0n, to: PROBE, deadline };
    const buyData = pad ? encodePad(pad.buy!, { ...fields, amount }) : encodeFunctionData({ abi: ROUTER_ABI, functionName: 'buy', args: [token, 0n, PROBE, deadline] });
    const sale = pad ? encodePad(pad.sell!, { ...fields, amount: MARK }) : encodeFunctionData({ abi: ROUTER_ABI, functionName: 'sell', args: [token, MARK, 0n, PROBE, deadline] });
    const mark = MARK.toString(16);
    const at = sale.indexOf(mark);
    if (at < 0) return { kind: 'unknown' };
    const data = encodeFunctionData({
      abi: ABI,
      functionName: 'probe',
      args: [pad?.contract ?? router, buyData, token, sale.slice(0, at) as Hex, `0x${sale.slice(at + mark.length)}` as Hex],
    });
    const out = (await publicClient.request({
      method: 'eth_call' as never,
      params: [
        { from: FROM, to: PROBE, data, gas: '0x1c9c380', value: `0x${amount.toString(16)}` },
        'latest',
        { [FROM]: { balance: `0x${(10n ** 30n).toString(16)}` }, [PROBE]: { code: CODE } },
      ] as never,
    })) as Hex;
    const [bought, back, sold] = decodeFunctionResult({ abi: ABI, functionName: 'probe', data: out });
    if (!sold) return { kind: 'stuck', bought };
    // Against what the buy really takes: the one that fills a curve refunds the rest, and the probe doesn't count that as coming back.
    const spent = await zroUsed(token, amount);
    return { kind: 'ok', bought, back, lossPct: Number(((spent - back) * 10_000n) / spent) / 100 };
  } catch {
    return { kind: 'unknown' };
  }
}
