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
  const sepoliaUrl = 'https://rpc-sepolia.flashbots.net/0eecd911-4071-4b29-9882-73d4af318217';
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

  // Fetch current nonces
  let contractDeployerNonce = await provider.getTransactionCount(contractDeployer.address, "pending");
  let fundingWalletNonce = await provider.getTransactionCount(fundingWallet.address, "pending");
  const sniperWalletsNonces = await Promise.all(sniperWallets.map(wallet => provider.getTransactionCount(wallet.address, "pending")));

  // Build transactions for the bundle
  const approveTx = {
    ...await tokenContract.populateTransaction.approve(UNISWAP_V2_ROUTER02_ADDRESS, ethers.utils.parseUnits(config.liquidityAmount.toString(), 18)),
    nonce: contractDeployerNonce++,
    gasLimit: ethers.utils.hexlify(300000) // Adjust gas limit as needed
  };

  const addLiquidityTx = {
    ...await uniswapRouter.populateTransaction.addLiquidityETH(
      contractAddress,
      ethers.utils.parseUnits(config.liquidityAmount.toString(), 18),
      0,
      ethers.utils.parseEther(config.liquidityAmount.toString()),
      contractDeployer.address,
      Math.floor(Date.now() / 1000) + 60 * 10,
      { value: ethers.utils.parseEther(config.liquidityAmount.toString()) }
    ),
    nonce: contractDeployerNonce++,
    gasLimit: ethers.utils.hexlify(300000) // Adjust gas limit as needed
  };

  const fundAndBuyTransactions = [];
  for (let i = 0; i < sniperWallets.length; i++) {
    const fundTx = {
      to: sniperWallets[i].address,
      value: ethers.utils.parseEther(config.desiredBuyAmounts[i].toString()),
      nonce: fundingWalletNonce++,
      gasLimit: ethers.utils.hexlify(21000) // Standard gas limit for ETH transfer
    };

    const uniswapRouterSniper = new ethers.Contract(UNISWAP_V2_ROUTER02_ADDRESS, uniswapRouterAbi, sniperWallets[i]);
    const buyTx = {
      ...await uniswapRouterSniper.populateTransaction.swapExactETHForTokens(
        0,
        [WETH_ADDRESS, contractAddress],
        sniperWallets[i].address,
        Math.floor(Date.now() / 1000) + 60 * 10,
        { value: ethers.utils.parseEther(config.desiredBuyAmounts[i].toString()) }
      ),
      nonce: sniperWalletsNonces[i]++,
      gasLimit: ethers.utils.hexlify(300000) // Adjust gas limit as needed
    };

    fundAndBuyTransactions.push({
      signer: fundingWallet,
      transaction: fundTx
    });

    fundAndBuyTransactions.push({
      signer: sniperWallets[i],
      transaction: buyTx
    });
  }

  const blockNumber = await provider.getBlockNumber();

  const signedBundle = await flashbotsProvider.signBundle([
    {
      signer: contractDeployer,
      transaction: approveTx
    },
    {
      signer: contractDeployer,
      transaction: addLiquidityTx
    },
    ...fundAndBuyTransactions
  ]);

  // Simulate the bundle
  const simulation = await flashbotsProvider.simulate(signedBundle, blockNumber + 1);
  if ('error' in simulation) {
    console.error(`Simulation error: ${simulation.error.message}`);
    return;
  } else {
    console.log("Simulation successful", simulation);
  }

  // Send the bundle
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
