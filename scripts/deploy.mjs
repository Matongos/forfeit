// Compile contracts/HabitStake.sol with solc and deploy to Monad testnet.
// Usage: node scripts/deploy.mjs   (reads .wallet.json for the deployer key)
import { readFileSync, writeFileSync } from 'node:fs';
import solc from 'solc';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';

const source = readFileSync('contracts/HabitStake.sol', 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'HabitStake.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join('\n'));
  process.exit(1);
}
const artifact = out.contracts['HabitStake.sol'].HabitStake;
const abi = artifact.abi;
const bytecode = '0x' + artifact.evm.bytecode.object;
writeFileSync('src/lib/abi.json', JSON.stringify(abi, null, 2));
console.log('compiled ok, bytecode', bytecode.length / 2 - 1, 'bytes');

const { pk } = JSON.parse(readFileSync('.wallet.json', 'utf8'));
const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });
const client = createPublicClient({ chain: monadTestnet, transport: http() });

const balance = await client.getBalance({ address: account.address });
console.log('deployer', account.address, 'balance', Number(balance) / 1e18, 'MON');
if (balance === 0n) {
  console.error('Deployer has no MON — fund it at https://faucet.monad.xyz');
  process.exit(1);
}

const hash = await wallet.deployContract({ abi, bytecode });
console.log('deploy tx', hash);
const receipt = await client.waitForTransactionReceipt({ hash });
console.log('deployed at', receipt.contractAddress);
writeFileSync('src/lib/deployment.json', JSON.stringify({
  address: receipt.contractAddress,
  chainId: monadTestnet.id,
  txHash: hash,
}, null, 2));
