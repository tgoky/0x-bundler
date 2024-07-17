// import { ethers } from "ethers";
// import fs from "fs";
// import path from "path";
// import dotenv from "dotenv";
// import uniswapRouterAbi from '../ABI/UniswapRouter.json';

// // Load environment variables
// dotenv.config();

// // Helper function to get environment variables
// const getEnvVar = (varName: string, defaultValue?: string): string => {
//   const value = process.env[varName];
//   if (!value && !defaultValue) {
//     throw new Error(`Environment variable ${varName} is not defined`);
//   }
//   return value || defaultValue!;
// };

// // Load config
// const configPath = path.join(__dirname, "..", "lib", "config.json");
// const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// // Uniswap contract addresses (these are for Uniswap V2 on Ethereum mainnet)
// const UNISWAP_V2_ROUTER02_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
// // WETH address for Sepolia testnet
// const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

// async function main() {
//   // Set up provider and wallet
//   const provider = new ethers.JsonRpcProvider(getEnvVar('SEPOLIA_URL'));
//   const contractDeployer = new ethers.Wallet(getEnvVar('CONTRACT_DEPLOYER_PK'), provider);

//   // Contract instances
//   const tokenContract = new ethers.Contract(getEnvVar('CONTRACT_ADDRESS'), [
//     // Only the ERC-20 methods needed for this script
//     "function approve(address spender, uint256 amount) public returns (bool)",
//     "function balanceOf(address account) public view returns (uint256)"
//   ], contractDeployer);

//   const uniswapRouter = new ethers.Contract(UNISWAP_V2_ROUTER02_ADDRESS, uniswapRouterAbi, contractDeployer);

//   // Step 1: Approve Uniswap router to spend the liquidity tokens
//   console.log("Approving Uniswap router to spend liquidity tokens...");
//   const liquidityTokenAddress = await uniswapRouter.getPair(getEnvVar('CONTRACT_ADDRESS'), WETH_ADDRESS);
//   const liquidityTokenContract = new ethers.Contract(liquidityTokenAddress, [
//     "function approve(address spender, uint256 amount) public returns (bool)",
//     "function balanceOf(address account) public view returns (uint256)"
//   ], contractDeployer);

//   const liquidityAmount = ethers.parseUnits(config.liquidityToRemove, 18);
//   const approveTx = await liquidityTokenContract.approve(UNISWAP_V2_ROUTER02_ADDRESS, liquidityAmount);
//   await approveTx.wait();
//   console.log("Approved Uniswap router to spend liquidity tokens");

//   // Step 2: Remove liquidity from the Uniswap pool
//   console.log("Removing liquidity from the Uniswap pool...");
//   const removeLiquidityTx = await uniswapRouter.removeLiquidityETH(
//     getEnvVar('CONTRACT_ADDRESS'),
//     liquidityAmount,
//     0, // minimum amount of tokens to receive
//     0, // minimum amount of ETH to receive
//     contractDeployer.address,
//     Math.floor(Date.now() / 1000) + 60 * 10 // deadline 10 minutes from now
//   );
//   await removeLiquidityTx.wait();
//   console.log(`Removed ${config.liquidityToRemove} liquidity from the Uniswap pool`);

//   console.log("Liquidity removal process completed.");
// }

// main().catch(error => {
//   console.error("Error in liquidity removal process:", error);
//   process.exit(1);
// });
