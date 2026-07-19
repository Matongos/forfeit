import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { monadTestnet } from 'viem/chains';
import abi from './abi.json';
import deployment from './deployment.json';

export const CONTRACT = deployment.address as `0x${string}`;
export const ABI = abi;
export const CHAIN = monadTestnet;
export const EXPLORER = 'https://testnet.monadexplorer.com';

export const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });

export function walletClient() {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error('No wallet found — install MetaMask');
  return createWalletClient({ chain: monadTestnet, transport: custom(eth) });
}

export type Commitment = {
  owner: `0x${string}`;
  beneficiary: `0x${string}`;
  stake: bigint;
  window: number;
  minGap: number;
  required: number;
  done: number;
  lastCheckIn: bigint;
  refereeMode: boolean;
  status: number; // 0 Active, 1 Completed, 2 Slashed
  habit: string;
};

export async function readCommitment(id: bigint): Promise<Commitment> {
  const r = (await publicClient.readContract({
    address: CONTRACT,
    abi: ABI,
    functionName: 'commitments',
    args: [id],
  })) as any[];
  return {
    owner: r[0], beneficiary: r[1], stake: r[2], window: Number(r[3]),
    minGap: Number(r[4]), required: Number(r[5]), done: Number(r[6]),
    lastCheckIn: r[7], refereeMode: r[8], status: Number(r[9]), habit: r[10],
  };
}

export async function nextId(): Promise<bigint> {
  return (await publicClient.readContract({
    address: CONTRACT, abi: ABI, functionName: 'nextId',
  })) as bigint;
}

export function short(a: string) {
  return a.slice(0, 6) + '…' + a.slice(-4);
}
