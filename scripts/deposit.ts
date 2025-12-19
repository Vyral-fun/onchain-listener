import { ethers } from "ethers";
import { abi } from "../src/escrowV2.json";
import { abi as proxyAbi } from "../src/proxy.json";

const priv_key = process.env.PRIVATE_KEY || "";

async function debugCreateRequest() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const wallet = new ethers.Wallet(priv_key, provider);
  const asset = "0xf1966A1d1a6098c80341f38DCE1a54F8D67e8c87";
  const contractAddress = "0x32cD2B4d634A05CABb32c5ECf718A7e04038096B";
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  const erc20 = new ethers.Contract(
    asset,
    [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function balanceOf(address account) view returns (uint256)",
      "function transfer(address to, uint256 amount) returns (bool)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ],
    wallet
  );

  const budget = ethers.parseEther("0.9");
  const fee = ethers.parseEther("0.1");
  const jobId = "randomId";
  const total = budget + fee;

  console.log("Approving tokens...");
  const approveTx = await erc20.approve(contractAddress, total);
  console.log("Approve tx:", approveTx.hash);
  await approveTx.wait();
  console.log("Approval confirmed");

  try {
    const callData = contract.interface.encodeFunctionData("createRequest", [
      budget,
      fee,
      asset,
      jobId,
    ]);

    const result = await provider.send("eth_call", [
      {
        to: contractAddress,
        from: wallet.address,
        data: callData,
        value: "0x0",
      },
      "latest",
    ]);

    console.log("Campaign created:", result);
  } catch (e: any) {
    console.error("eth_call failed");
    console.error("Full error:", JSON.stringify(e, null, 2));

    if (e.error?.data) {
      console.log("Found error data:", e.error.data);

      if (e.error.data.startsWith("0x")) {
        const errorData = e.error.data;
        console.log("Error selector:", errorData.slice(0, 10));

        const knownErrors = {
          "0x3264aa67": "AssetNotSupported()",
          "0x8d2f6c31": "BudgetMustBeGreaterThanZero()",
          "0xad3a8b9e": "InsufficientNativeBalance()",
          "0x8ca42a5f": "NoEthValueShouldBeSent()",
          "0xf4844814": "InsufficientBudget()",
          "0x0a8d6e2c": "YapRequestNotActive()",
          "0x80ba4b94": "InvalidYapRequestId()",
          "0x2b813bc0": "OnlyAdminsCanDistributeRewards()",
        };

        const selector = errorData.slice(0, 10);
        if (knownErrors[selector]) {
          console.log("MATCHED ERROR:", knownErrors[selector]);
        } else {
          console.log("Unknown error selector");
        }
      }
    }
  }

  console.log("Method 2: Contract State Check");
  try {
    const totalRequests = await contract.getTotalYapRequests();
    console.log("Total yap requests:", totalRequests.toString());

    const isSupported = await contract.isAssetSupported(asset);
    console.log("Asset supported:", isSupported);

    const minBudget = await contract.getMinimumBudget(asset);
    console.log("Min budget:", ethers.formatEther(minBudget));

    try {
      const proxyContract = new ethers.Contract(
        contractAddress,
        proxyAbi,
        wallet
      );
      const impl = await proxyContract.get_implementation();
      console.log("Proxy detected, implementation:", impl);
    } catch {
      console.log("Not a proxy or get_implementation not available");
    }
  } catch (e: any) {
    console.error("State check failed:", e.message);
  }

  console.log("Method 3: Token Contract Check");

  try {
    const balance = await erc20.balanceOf(wallet.address);
    const allowance = await erc20.allowance(wallet.address, contractAddress);
    const total = budget + fee;

    console.log("✓ Your balance:", ethers.formatEther(balance));
    console.log("✓ Current allowance:", ethers.formatEther(allowance));
    console.log("✓ Needed:", ethers.formatEther(total));

    if (allowance < total) {
      console.log("\n⚠️  INSUFFICIENT ALLOWANCE!");
      console.log(
        "Need to approve:",
        ethers.formatEther(total - allowance),
        "more tokens"
      );

      console.log("\n🔧 Approving tokens...");
      const approveTx = await erc20.approve(contractAddress, total);
      console.log("Approve tx:", approveTx.hash);
      await approveTx.wait();
      console.log("✓ Approval confirmed");

      const newAllowance = await erc20.allowance(
        wallet.address,
        contractAddress
      );
      console.log("✓ New allowance:", ethers.formatEther(newAllowance));
    }
  } catch (e: any) {
    console.error("❌ Token check failed:", e.message);
  }
}

debugCreateRequest();
