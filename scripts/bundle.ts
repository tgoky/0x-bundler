import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import uniswapRouterAbi from '../ABI/UniswapRouter.json';

// Load environment variables
dotenv.config();

// Helper function to get environment variables
const getEnvVar = (varName: string, defaultValue?: string): string => {
  const value = process.env[varName];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${varName} is not defined`);
  }
  return value || defaultValue!;
};

// Load config
const configPath = path.join(__dirname, "..", "lib", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const UNISWAP_V2_ROUTER02_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
// WETH address for Sepolia testnet
const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

async function main() {
  // Set up provider and wallets
  const provider = new ethers.JsonRpcProvider(getEnvVar('SEPOLIA_URL'));
  const fundingWallet = new ethers.Wallet(getEnvVar('FUNDING_WALLET_PK'), provider);
  const sniperWallets = [
    new ethers.Wallet(getEnvVar('SNIPER_WALLET_1_PK'), provider),
    new ethers.Wallet(getEnvVar('SNIPER_WALLET_2_PK'), provider)
  ];
  const contractDeployer = new ethers.Wallet(getEnvVar('CONTRACT_DEPLOYER_PK'), provider);

  // Initialize contract instances
  const tokenContract = new ethers.Contract(getEnvVar('CONTRACT_ADDRESS'), [
    "function approve(address spender, uint256 amount) public returns (bool)",
    "function balanceOf(address account) public view returns (uint256)"
  ], contractDeployer);

  const uniswapRouter = new ethers.Contract(UNISWAP_V2_ROUTER02_ADDRESS, uniswapRouterAbi, contractDeployer);

  // Set custom gas price and gas limit
  const gasPrice = ethers.parseUnits('10', 'gwei'); // 10 gwei
  const gasLimit = 300000; // 300,000 gas

  // Step 1: Approve Uniswap router to spend the tokens
  console.log("Approving Uniswap router to spend tokens...");
  const approveTx = await tokenContract.approve(UNISWAP_V2_ROUTER02_ADDRESS, ethers.parseUnits(config.liquidityAmount, 18));
  await approveTx.wait();
  console.log("Approved Uniswap router to spend tokens");

  // Step 2: Add liquidity to the contract
  console.log("Adding liquidity to the Uniswap pool...");
  const addLiquidityTx = await uniswapRouter.addLiquidityETH(
    getEnvVar('CONTRACT_ADDRESS'),
    ethers.parseUnits(config.liquidityAmount, 18),
    0, // min amount of tokens
    ethers.parseEther(config.liquidityAmount), // amount of ETH to add as liquidity
    contractDeployer.address,
    Math.floor(Date.now() / 1000) + 60 * 10, // deadline 10 minutes from now
    { value: ethers.parseEther(config.liquidityAmount) }
  );
  await addLiquidityTx.wait();
  console.log(`Added ${config.liquidityAmount} ETH to the Uniswap pool`);

  // Step 3: Fund sniper wallets
  console.log("Funding sniper wallets...");
  for (let i = 0; i < sniperWallets.length; i++) {
    try {
      const tx = await fundingWallet.sendTransaction({
        to: sniperWallets[i].address,
        value: ethers.parseEther(config.desiredBuyAmounts[i])
      });
      await tx.wait();
      console.log(`Funded ${sniperWallets[i].address} with ${config.desiredBuyAmounts[i]} ETH`);

      // If successful funding, proceed with buying tokens
      console.log(`Wallet ${sniperWallets[i].address} buying tokens...`);
      const uniswapRouterSniper = new ethers.Contract(UNISWAP_V2_ROUTER02_ADDRESS, uniswapRouterAbi, sniperWallets[i]);
      const buyTx = await uniswapRouterSniper.swapExactETHForTokens(
        0, // accept any amount of Tokens
        [WETH_ADDRESS, getEnvVar('CONTRACT_ADDRESS')], // WETH -> Token
        sniperWallets[i].address,
        Math.floor(Date.now() / 1000) + 60 * 10, // deadline 10 minutes from now
        { value: ethers.parseEther(config.desiredBuyAmounts[i]) }
      );
      await buyTx.wait();
      console.log(`Wallet ${sniperWallets[i].address} bought tokens with ${config.desiredBuyAmounts[i]} ETH`);
    } catch (error) {
      console.error(`Error processing wallet ${sniperWallets[i].address}:`, error);
    }
  }

  console.log("Bundle process completed.");
}

main().catch(error => {
  console.error("Error in bundle process:", error);
  process.exit(1);
});
