import { ethers } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import uniswapRouterAbi from '../ABI/UniswapRouter.json';

dotenv.config();

const getEnvVar = (varName: string, defaultValue?: string): string => {
  const value = process.env[varName];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${varName} is not defined`);
  }
  return value || defaultValue!;
};

const configPath = path.join(__dirname, "..", "lib", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const UNISWAP_V2_ROUTER02_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const SEPOLIA_CHAIN_ID = 11155111;

async function getGasPrices(provider: ethers.providers.JsonRpcProvider) {
  try {
    const gasPrice = await provider.getGasPrice();
    const maxPriorityFeePerGas = ethers.utils.parseUnits('2', 'gwei'); // Default priority fee
    return {
      maxFeePerGas: gasPrice.add(maxPriorityFeePerGas),
      maxPriorityFeePerGas,
    };
  } catch (error) {
    console.error("Failed to fetch gas prices:", error);
    throw error;
  }
}

async function main() {
  const mainnetUrl = 'https://rpc-sepolia.flashbots.net/';
  const contractDeployerPk = getEnvVar('CONTRACT_DEPLOYER_PK');
  const fundingWalletPk = getEnvVar('FUNDING_WALLET_PK');
  const sniperWallet1Pk = getEnvVar('SNIPER_WALLET_1_PK');
  const sniperWallet2Pk = getEnvVar('SNIPER_WALLET_2_PK');
  const contractAddress = '0x51784B9a69BdB87eb5d079Ff5EC55D762a696619';

  console.log(`Connecting to mainnet at ${mainnetUrl}...`);
  const provider = new ethers.providers.JsonRpcProvider(mainnetUrl);

  try {
    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name}`);
  } catch (error) {
    console.error("Failed to connect to the mainnet:", error);
    return;
  }

  let maxFeePerGas, maxPriorityFeePerGas;
  try {
    ({ maxFeePerGas, maxPriorityFeePerGas } = await getGasPrices(provider));
    console.log("Fetched gas prices:", { maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: maxPriorityFeePerGas.toString() });
  } catch (error) {
    console.error("Error fetching gas prices:", error);
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

  let contractDeployerNonce = await provider.getTransactionCount(contractDeployer.address, "pending");
  let fundingWalletNonce = await provider.getTransactionCount(fundingWallet.address, "pending");

  const sniperWalletsNonces = await Promise.all(sniperWallets.map(wallet => provider.getTransactionCount(wallet.address, "pending")));

  console.log("Nonces:", { contractDeployerNonce, fundingWalletNonce, sniperWalletsNonces });

  const approveTx = {
    data: tokenContract.interface.encodeFunctionData("approve", [UNISWAP_V2_ROUTER02_ADDRESS, ethers.constants.MaxUint256]),
    to: contractAddress,
    from: contractDeployer.address,
    type: 2,
    nonce: contractDeployerNonce,
    gasLimit: ethers.utils.hexlify(300000), // Adjust the gas limit as needed
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: SEPOLIA_CHAIN_ID
  };

  const addLiquidityTx = {
    data: uniswapRouter.interface.encodeFunctionData("addLiquidityETH", [
      contractAddress,
      ethers.utils.parseUnits('1', 'ether'), // Token amount
      ethers.utils.parseUnits('1', 'ether'), // Min tokens
      ethers.utils.parseUnits('1', 'ether'), // Min ETH
      contractDeployer.address,
      Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes from the current time
    ]),
    to: UNISWAP_V2_ROUTER02_ADDRESS,
    from: contractDeployer.address,
    value: ethers.utils.parseUnits('1', 'ether'),
    type: 2,
    nonce: contractDeployerNonce + 1,
    gasLimit: ethers.utils.hexlify(300000), // Adjust the gas limit as needed
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: SEPOLIA_CHAIN_ID
  };

  console.log("Transactions prepared:", { approveTx, addLiquidityTx });

  const fundAndTransferTxs = [
    {
      signer: fundingWallet,
      transaction: {
        to: sniperWallets[0].address,
        value: ethers.utils.parseUnits('0.1', 'ether'),
        nonce: fundingWalletNonce,
        type: 2,
        gasLimit: ethers.utils.hexlify(21000),
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: SEPOLIA_CHAIN_ID
      }
    },
    {
      signer: sniperWallets[0],
      transaction: {
        to: contractAddress,
        value: ethers.utils.parseUnits('0.1', 'ether'),
        nonce: sniperWalletsNonces[0],
        type: 2,
        gasLimit: ethers.utils.hexlify(21000),
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: SEPOLIA_CHAIN_ID
      }
    },
    {
      signer: fundingWallet,
      transaction: {
        to: sniperWallets[1].address,
        value: ethers.utils.parseUnits('0.1', 'ether'),
        nonce: fundingWalletNonce + 1,
        type: 2,
        gasLimit: ethers.utils.hexlify(21000),
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: SEPOLIA_CHAIN_ID
      }
    },
    {
      signer: sniperWallets[1],
      transaction: {
        to: contractAddress,
        value: ethers.utils.parseUnits('0.1', 'ether'),
        nonce: sniperWalletsNonces[1],
        type: 2,
        gasLimit: ethers.utils.hexlify(21000),
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: SEPOLIA_CHAIN_ID
      }
    }
  ];

  console.log("Fund and transfer transactions prepared:", fundAndTransferTxs);

  const currentBlockNumber = await provider.getBlockNumber();
  console.log("Current block number:", currentBlockNumber);

  const bundleTransactions = [
    { transaction: approveTx, signer: contractDeployer },
    { transaction: addLiquidityTx, signer: contractDeployer },
    ...fundAndTransferTxs.map(tx => ({ transaction: tx.transaction, signer: tx.signer }))
  ];

  try {
    const signedBundle = await flashbotsProvider.signBundle(bundleTransactions);
    const bundleSubmission = await flashbotsProvider.simulate(signedBundle, currentBlockNumber + 1);
    console.log("Bundle submission:", bundleSubmission);
  } catch (error) {
    console.error("Error simulating bundle:", error);
  }
}

main().catch(console.error);
