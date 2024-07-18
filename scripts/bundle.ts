import { ethers } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import uniswapRouterAbi from '../ABI/UniswapRouter.json';

// Load environment variables
dotenv.config();

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
const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

async function main() {
  const sepoliaUrl = 'https://rpc-sepolia.flashbots.net';
  const contractDeployerPk = getEnvVar('CONTRACT_DEPLOYER_PK');
  const fundingWalletPk = getEnvVar('FUNDING_WALLET_PK');
  const sniperWallet1Pk = getEnvVar('SNIPER_WALLET_1_PK');
  const sniperWallet2Pk = getEnvVar('SNIPER_WALLET_2_PK');
  const contractAddress = '0x51784B9a69BdB87eb5d079Ff5EC55D762a696619'; // Use provided contract address

  // Test network connection
  console.log(`Connecting to Sepolia network at ${sepoliaUrl}...`);
  const provider = new ethers.providers.JsonRpcProvider(sepoliaUrl);
  try {
    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name}`);
  } catch (error) {
    console.error("Failed to connect to the Sepolia network:", error);
    return;
  }

  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, new ethers.Wallet(contractDeployerPk));
  const fundingWallet = new ethers.Wallet(fundingWalletPk, provider);
  const sniperWallets = [
    new ethers.Wallet(sniperWallet1Pk, provider),
    new ethers.Wallet(sniperWallet2Pk, provider)
  ];
  const contractDeployer = new ethers.Wallet(contractDeployerPk, provider);

  const tokenContract = new ethers.Contract(contractAddress, [
    "function approve(address spender, uint256 amount) public returns (bool)",
    "function balanceOf(address account) public view returns (uint256)"
  ], contractDeployer);

  const uniswapRouter = new ethers.Contract(UNISWAP_V2_ROUTER02_ADDRESS, uniswapRouterAbi, contractDeployer);

  console.log("Approving Uniswap router to spend tokens...");
  const approveTx = await tokenContract.approve(UNISWAP_V2_ROUTER02_ADDRESS, ethers.utils.parseUnits(config.liquidityAmount.toString(), 18));
  await approveTx.wait();
  console.log("Approved Uniswap router to spend tokens");

  console.log("Adding liquidity to the Uniswap pool...");
  const addLiquidityTx = await uniswapRouter.addLiquidityETH(
    contractAddress,
    ethers.utils.parseUnits(config.liquidityAmount.toString(), 18),
    0,
    ethers.utils.parseEther(config.liquidityAmount.toString()),
    contractDeployer.address,
    Math.floor(Date.now() / 1000) + 60 * 10,
    { value: ethers.utils.parseEther(config.liquidityAmount.toString()) }
  );
  await addLiquidityTx.wait();
  console.log(`Added ${config.liquidityAmount} ETH to the Uniswap pool`);

  console.log("Funding sniper wallets...");
  for (let i = 0; i < sniperWallets.length; i++) {
    try {
      const tx = await fundingWallet.sendTransaction({
        to: sniperWallets[i].address,
        value: ethers.utils.parseEther(config.desiredBuyAmounts[i].toString())
      });
      await tx.wait();
      console.log(`Funded ${sniperWallets[i].address} with ${config.desiredBuyAmounts[i]} ETH`);

      console.log(`Wallet ${sniperWallets[i].address} buying tokens...`);
      const uniswapRouterSniper = new ethers.Contract(UNISWAP_V2_ROUTER02_ADDRESS, uniswapRouterAbi, sniperWallets[i]);
      const buyTx = await uniswapRouterSniper.swapExactETHForTokens(
        0,
        [WETH_ADDRESS, contractAddress],
        sniperWallets[i].address,
        Math.floor(Date.now() / 1000) + 60 * 10,
        { value: ethers.utils.parseEther(config.desiredBuyAmounts[i].toString()) }
      );
      await buyTx.wait();
      console.log(`Wallet ${sniperWallets[i].address} bought tokens with ${config.desiredBuyAmounts[i]} ETH`);
    } catch (error) {
      console.error(`Error processing wallet ${sniperWallets[i].address}:`, error);
    }
  }

  console.log("Creating Flashbots bundle...");
  const blockNumber = await provider.getBlockNumber();
  const signedBundle = await flashbotsProvider.signBundle([
    {
      signedTransaction: (await approveTx.wait()).transactionHash,
      transaction: {
        ...approveTx,
        type: 0 // Force legacy transaction type
      }
    },
    {
      signer: contractDeployer,
      transaction: {
        ...addLiquidityTx,
        type: 0 // Force legacy transaction type
      }
    }
  ]);

  const bundleReceipt = await flashbotsProvider.sendRawBundle(signedBundle, blockNumber + 1);
  if ('error' in bundleReceipt) {
    console.error(`Flashbots bundle error: ${bundleReceipt.error.message}`);
  } else {
    console.log("Flashbots bundle sent:", bundleReceipt);
  }

  console.log("Bundle process completed.");
}

main().catch(error => {
  console.error("Error in bundle process:", error);
  process.exit(1);
});
