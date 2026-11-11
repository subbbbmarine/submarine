/**
 * A wallet's blocky picture, the same one MetaMask and Etherscan draw for an address: eight by eight squares mirrored down
 * the middle, in three colours, all from the address. A port of the ethereum-blockies algorithm (MIT), kept byte for byte
 * so a wallet looks the same here as in the extension.
 */
export interface Blocky {
  size: number;
  /** One per square, row by row: 0 the background, 1 the main colour, 2 the spots. */
  cells: number[];
  color: string;
  bg: string;
  spot: string;
}

export function blocky(address: string, size = 8): Blocky {
  const seed = address.toLowerCase();
  const s = [0, 0, 0, 0];
  for (let i = 0; i < seed.length; i++) s[i % 4] = (s[i % 4]! << 5) - s[i % 4]! + seed.charCodeAt(i);
  const rand = () => {
    const t = s[0]! ^ (s[0]! << 11);
    s[0] = s[1]!;
    s[1] = s[2]!;
    s[2] = s[3]!;
    s[3] = s[3]! ^ (s[3]! >> 19) ^ t ^ (t >> 8);
    return (s[3]! >>> 0) / ((1 << 31) >>> 0);
  };
  const colour = () => {
    const h = Math.floor(rand() * 360);
    const sat = rand() * 60 + 40;
    const light = (rand() + rand() + rand() + rand()) * 25;
    return `hsl(${h},${sat}%,${light}%)`;
  };
  const color = colour();
  const bg = colour();
  const spot = colour();
  const half = Math.ceil(size / 2);
  const mirror = size - half;
  const cells: number[] = [];
  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < half; x++) row[x] = Math.floor(rand() * 2.3);
    cells.push(...row, ...row.slice(0, mirror).reverse());
  }
  return { size, cells, color, bg, spot };
}
