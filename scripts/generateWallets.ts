import { ethers, Wallet } from "ethers";
import fs from "fs";
import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  Hbar,
} from "@hashgraph/sdk";

const priv_key = process.env.PRIVATE_KEY || "";
const rpcUrl = process.env.HEDERA_PROVIDER_URL || "";

function generateWallets(count: number) {
  const wallets = [];

  for (let i = 0; i < count; i++) {
    const wallet = Wallet.createRandom();
    wallets.push({
      address: wallet.address,
      privateKey: wallet.privateKey,
    });
  }

  fs.writeFileSync("wallets.json", JSON.stringify(wallets, null, 2));
  console.log(wallets);
}

async function createHederaAccount(client: Client, evmAddress: string) {
  const tx = await new AccountCreateTransaction()
    .setAlias(evmAddress)
    .setInitialBalance(new Hbar(0.1))
    .execute(client);

  const receipt = await tx.getReceipt(client);
  console.log(
    `Created Hedera account ${receipt.accountId} for EVM address ${evmAddress}`
  );
}

async function makeTransfers() {
  const client = Client.forTestnet();
  const operatorKey = PrivateKey.fromStringECDSA(priv_key);
  client.setOperator("0.0.7780278", operatorKey);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const masterWallet = new Wallet(priv_key, provider);

  const wallets = JSON.parse(fs.readFileSync("wallets.json", "utf-8"));
  const firstTen = wallets.slice(0, 10);

  for (const wallet of firstTen) {
    await createHederaAccount(client, wallet.address);

    console.log(`Transferred 0.1 HBAR to ${wallet.address}`);
  }
}

async function main() {
  await makeTransfers();
}

main().catch((error) => {
  console.error("Error in main: ", error);
  process.exit(1);
});
