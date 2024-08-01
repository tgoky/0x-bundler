import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import uniswapRouterAbi from '../ABI/UniswapRouter.json';
import erc20Abi from '../ABI/ERC20.json';
import { ethers } from "ethers";
import path from "path";
import fs from "fs";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";

// Setup
const provider = new ethers.providers.InfuraProvider("sepolia", "https://sepolia.infura.io/v3/23a20fc28538440eb019569a29bb7339");
const executorWallet = new ethers.Wallet("jujjj", provider);

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

// Flashbots auth signer
const authSigner = ethers.Wallet.createRandom();

async function main() {
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, 'https://relay.flashbots.net');

  const tokenAddress = "0x008CDc4D855e47725D29f20Fb819eB54957464C6";
  const uniswapRouterAddress = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";

  const amountToApprove = ethers.utils.parseEther(config.desiredTokenAmount);
  const liquidityAmount = ethers.utils.parseEther(config.liquidityAmount);
  const sniperPrivateKeys = ["SniperPrivateKey1", "SniperPrivateKey2", "SniperPrivateKey3"]; // Replace with actual keys
  const buyAmounts = ["0.0005", "0.0005", "0.0005"]; // ETH amounts each sniper wallet will use to buy tokens

  // Initialize contract instances
  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, executorWallet);
  const uniswapRouterContract = new ethers.Contract(uniswapRouterAddress, uniswapRouterAbi, executorWallet);

  // Approve the Uniswap Router to spend tokens
  const approveTx = await tokenContract.populateTransaction.approve(uniswapRouterAddress, amountToApprove);

  // Prepare the liquidity transaction
  const liquidityTx = await uniswapRouterContract.populateTransaction.addLiquidityETH(
    tokenAddress,
    amountToApprove,
    ethers.utils.parseEther(config.amountTokenMin),
    ethers.utils.parseEther(config.amountETHMin),
    executorWallet.address,
    Math.floor(Date.now() / 1000) + 60 * 20,
    {
      value: liquidityAmount,
      gasLimit: ethers.utils.hexlify(300000) 
    }
  );

  // Define sniper wallets and fund amounts
  const fundAmount = ethers.utils.parseEther("0.1"); // Adjust as needed

  // Prepare funding transactions for sniper wallets
  const fundingTxs = sniperPrivateKeys.map((privateKey) => {
    const sniperWallet = new ethers.Wallet(privateKey, provider);
    return {
      to: sniperWallet.address,
      value: fundAmount,
      gasLimit: ethers.utils.hexlify(21000)
    };
  });

  // Prepare buy transactions for each sniper wallet
  const buyTxs = sniperPrivateKeys.map((privateKey, index) => {
    const sniperWallet = new ethers.Wallet(privateKey, provider);
    return uniswapRouterContract.populateTransaction.swapExactETHForTokens(
      ethers.utils.parseEther("0"),
      [config.wethAddress, tokenAddress],
      sniperWallet.address,
      Math.floor(Date.now() / 1000) + 60 * 20,
      {
        value: ethers.utils.parseEther(buyAmounts[index]),
        gasLimit: ethers.utils.hexlify(300000)
      }
    );
  });

  // Bundle the transactions
  const signedTransactions = await flashbotsProvider.signBundle([
    { signer: executorWallet, transaction: approveTx },
    { signer: executorWallet, transaction: liquidityTx },
    ...fundingTxs.map(tx => ({ signer: executorWallet, transaction: tx })),
    ...buyTxs.map(tx => ({ signer: executorWallet, transaction: tx }))
  ]);

  const targetBlockNumber = await provider.getBlockNumber() + 1;
  const response = await flashbotsProvider.sendBundle(signedTransactions, targetBlockNumber);

  if ('error' in response) {
    console.error(response.error.message);
  } else {
    console.log('Bundle sent successfully:', response);
  }
}

// Execute the main function
main().catch(error => {
  console.error('Error executing script:', error);
});
