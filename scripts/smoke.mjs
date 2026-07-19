// End-to-end test of the deployed contract using the deployer key.
import { readFileSync } from 'node:fs';
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';

const abi = JSON.parse(readFileSync('src/lib/abi.json', 'utf8'));
const { address } = JSON.parse(readFileSync('src/lib/deployment.json', 'utf8'));
const { pk } = JSON.parse(readFileSync('.wallet.json', 'utf8'));
const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });
const client = createPublicClient({ chain: monadTestnet, transport: http() });
const friend = privateKeyToAccount(generatePrivateKey()).address;

const call = async (functionName, args, value) => {
  const hash = await wallet.writeContract({ address, abi, functionName, args, value });
  const r = await client.waitForTransactionReceipt({ hash });
  console.log(functionName, r.status, hash);
  return r;
};
const sleep = (s) => new Promise((res) => setTimeout(res, s * 1000));
const read = async (id) => client.readContract({ address, abi, functionName: 'commitments', args: [id] });

// Slip 0: win path — window 60s, gap 5s, 2 check-ins
await call('create', [friend, 60, 5, 2, false, 'smoke-win'], parseEther('0.01'));
await sleep(6); await call('checkIn', [0n]);
await sleep(6); await call('checkIn', [0n]);
await call('withdraw', [0n]);
console.log('slip 0 status (expect 1=Completed):', (await read(0n))[9]);

// Slip 1: lose path — window 10s, let it blow, slash
await call('create', [friend, 10, 1, 2, false, 'smoke-lose'], parseEther('0.01'));
await sleep(12);
await call('slash', [1n]);
console.log('slip 1 status (expect 2=Slashed):', (await read(1n))[9]);
console.log('friend balance:', Number(await client.getBalance({ address: friend })) / 1e18, 'MON');
