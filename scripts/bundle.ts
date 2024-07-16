import { ethers } from "ethers";
import { ethers as hardhatEthers } from "hardhat";
import fs from "fs";
import path from "path";

const configPath = path.join(__dirname, "..", "lib", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

async function main() {
  // Set up provider and wallets
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_URL);
  const fundingWallet = new ethers.Wallet(config.fundingWalletPK, provider);
  const sniperWallets = config.sniperWalletsPKs.map((pk: string) => new ethers.Wallet(pk, provider));
  const contractDeployer = new ethers.Wallet(config.contractDeployerPK, provider);

  // Step 1: Fund sniper wallets
  console.log("Funding sniper wallets...");
  for (let i = 0; i < sniperWallets.length; i++) {
    const tx = await fundingWallet.sendTransaction({
      to: sniperWallets[i].address,
      value: ethers.parseEther(config.desiredBuyAmounts[i])
    });
    await tx.wait();
    console.log(`Funded ${sniperWallets[i].address} with ${config.desiredBuyAmounts[i]} ETH`);
  }

  // Step 2: Add liquidity to the contract
  console.log("Adding liquidity to the contract...");
  const addLiquidityTx = await contractDeployer.sendTransaction({
    to: config.contractAddress,
    value: ethers.parseEther(config.liquidityAmount)
  });
  await addLiquidityTx.wait();
  console.log(`Added ${config.liquidityAmount} ETH to the contract`);

  // Step 3: Sniper wallets buy tokens
  console.log("Sniper wallets buying tokens...");
  for (let i = 0; i < sniperWallets.length; i++) {
    const contract = new ethers.Contract(config.contractAddress, [
      "function buy() public payable"
    ], sniperWallets[i]);

    const buyTx = await contract.buy({ value: ethers.parseEther(config.desiredBuyAmounts[i]) });
    await buyTx.wait();
    console.log(`Wallet ${sniperWallets[i].address} bought tokens with ${config.desiredBuyAmounts[i]} ETH`);
  }

  console.log("Bundle process completed.");
}

main().catch(error => {
  console.error("Error in bundle process:", error);
  process.exit(1);
});
