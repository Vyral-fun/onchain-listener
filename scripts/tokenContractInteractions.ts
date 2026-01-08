import { abi } from "../scripts/abi/erc20.json";
import { ethers } from "ethers";

const priv_key = process.env.PRIVATE_KEY || "";
const rpcUrl = Bun.env.BASE_SEPOLIA_PROVIDER_URL;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(priv_key, provider);

const tokenContract = "0xf1966A1d1a6098c80341f38DCE1a54F8D67e8c87";
const addresses = [
  "0xDA01D79Ca36b493C7906F3C032D2365Fb3470aEC",
  "0x3743840EfBB116c8f01A562bB08C5620b84f5361",
  "0x8D012ECAdD409C0A6F6c9377256a189512f2aE40",
  "0xd9d0Ab6D58Cc17402A47A62fc5D285d620af46D5",
];
const spenders = [
  "0xdcb6256afd4e9bf395B846F9Ee78C7EE9c20Cd2e",
  "0x30B16cbA105e5298dc2c27B9d7727b80e7754e4D",
  "0x0e1538df7327e9e3e5f21783e5ba9818920d1e59",
  "0x32cd2b4d634a05cabb32c5ecf718a7e04038096b",
  "0x28806e23d425df24f2c68ec281aa99bb2b40aeea",
  "0x61df20e43f2f7af76ea8f6df5c143c4088583023",
  "0x8dfe5c2fd3f08c27a5388fa2547041ea729539a9",
  "0x35e8e9a777b9f089bf97d7046721cbb23690e437",
  "0x68f7f0bbe31ce25da76e4f37b1b677dd9a3b67be",
  "0x582c7f81381dd1906a37627ae2caa156b9aeb3de",
  "0x0b0b47d6e6eeaa7f2ed6b417d441c35389e5c1f5",
  "0xa7266d144bfca5a335f8b6fc359481c0cce13fd4",
  "0xe0eaeef9d981de641d9aa51e5a93411dfb549961",
  "0x8b021e8f34f52b4f01f0bcbfbbd4bd558ff16e31",
];
const recipients = [
  "0xDA01D79Ca36b493C7906F3C032D2365Fb3470aEC",
  "0xd20Fecd8A9C662f0737Ce390765675615B50Ed6a",
  "0xF3Ecf7Eb3f2F9D5445bA63ED27B23b82C959Ef02",
  "0x87bce64f516Fe92b6FCaF9B4015D03f40161A62a",
];

async function mintTokens() {
  const contract = new ethers.Contract(
    tokenContract,
    abi,
    wallet
  ) as ethers.Contract & {
    mint(to: string): Promise<ethers.TransactionResponse>;
    decimals(): Promise<number>;
  };

  const decimals = await contract.decimals();

  for (const recipient of recipients) {
    try {
      const tx = await contract.mint(recipient);
      console.log(
        `Minted tokens to ${recipient}. Transaction Hash: ${tx.hash}`
      );
      await tx.wait();
      console.log(`Minting confirmed for ${recipient}`);
    } catch (error) {
      console.error(`Failed to mint tokens to ${recipient}:`, error);
    }
  }
}

async function transferTokens() {
  const contract = new ethers.Contract(
    tokenContract,
    abi,
    wallet
  ) as ethers.Contract & {
    transfer(
      to: string,
      amount: ethers.BigNumberish
    ): Promise<ethers.TransactionResponse>;
    decimals(): Promise<number>;
  };

  const decimals = await contract.decimals();
  const amount = ethers.parseUnits("10.0", decimals);

  for (const address of addresses) {
    try {
      const tx = await contract.transfer(address, amount);
      console.log(
        `Transferred 10 tokens to ${address}. Transaction Hash: ${tx.hash}`
      );
      await tx.wait();
      console.log(`Transaction confirmed for ${address}`);
    } catch (error) {
      console.error(`Failed to transfer tokens to ${address}:`, error);
    }
  }
}

async function approveTokens() {
  const contract = new ethers.Contract(
    tokenContract,
    abi,
    wallet
  ) as ethers.Contract & {
    approve(
      spender: string,
      amount: ethers.BigNumberish
    ): Promise<ethers.TransactionResponse>;
    decimals(): Promise<number>;
  };

  const decimals = await contract.decimals();
  const amount = ethers.parseUnits("50.0", decimals);

  for (const spender of spenders) {
    try {
      const tx = await contract.approve(spender, amount);
      console.log(
        `Approved 50 tokens for ${spender}. Transaction Hash: ${tx.hash}`
      );
      await tx.wait();
      console.log(`Approval confirmed for ${spender}`);
    } catch (error) {
      console.error(`Failed to approve tokens for ${spender}:`, error);
    }
  }
}

async function main() {
  await transferTokens();
  await approveTokens();
  await mintTokens();
}

main().catch((error) => {
  console.error("Error in token contract interactions:", error);
  process.exit(1);
});
