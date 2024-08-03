

import { ethers, BigNumber, Wallet } from "ethers";
import {
  FlashbotsBundleProvider,
  FlashbotsBundleTransaction,
  FlashbotsBundleResolution,
} from "@flashbots/ethers-provider-bundle";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
// import uniswapRouterAbi from '../ABI/UniswapRouter.json'; //TESTNET
import erc20Abi from '../ABI/ERC20.json'; // TESTNET
import uniswapRouterAbi from '../ABI/MAINNET/UniswapRouter.json';  // MAINNET ABI


// import erc20Abi from '../ABI/MAINNET/ERC20.json'; // MAINNET 
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

// const UNISWAP_V2_ROUTER02_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const UNISWAP_V2_ROUTER02_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" // MAINNET
// const SEPOLIA_CHAIN_ID = 11155111; TESTNET
const SEPOLIA_CHAIN_ID = 1; // MAINNET 
const BLOCKS_IN_FUTURE = 2;
const GWEI = BigNumber.from(10).pow(9);
const PRIORITY_GAS_PRICE = GWEI.mul(31);

class FlashBotBuilder {
  private bundleProviderConnectionInfoOrUrl?: string | ethers.utils.ConnectionInfo;
  private bundleProviderNetwork?: ethers.providers.Networkish;
  private blockchainNetworkId?: number;
  private blockChainRpcProvider?: ethers.providers.JsonRpcProvider | null;
  private sponsorPrivateKey?: string | null;
  private executorPrivateKey?: string | null;
  private intervalToFutureBlock?: number | null;
  private priorityGasPrice?: BigNumber | null;

  constructor() {}

  addBundleProviderConnectionInfoOrUrl(bundleProviderConnectionInfoOrUrl: string | ethers.utils.ConnectionInfo) {
    this.bundleProviderConnectionInfoOrUrl = bundleProviderConnectionInfoOrUrl;
    return this;
  }

  addBundleProviderNetwork(bundleProviderNetwork: ethers.providers.Networkish) {
    this.bundleProviderNetwork = bundleProviderNetwork;
    return this;
  }

  addBlockchainNetworkId(blockchainNetworkId: number) {
    this.blockchainNetworkId = blockchainNetworkId;
    return this;
  }

  addBlockChainRpcProvider(blockChainRpcProvider: ethers.providers.JsonRpcProvider) {
    this.blockChainRpcProvider = blockChainRpcProvider;
    return this;
  }

  addSponsorPrivateKey(sponsorPrivateKey: string) {
    this.sponsorPrivateKey = sponsorPrivateKey;
    return this;
  }

  addExecutorPrivateKey(executorPrivateKey: string) {
    this.executorPrivateKey = executorPrivateKey;
    return this;
  }

  addIntervalToFutureBlock(intervalToFutureBlock: number) {
    this.intervalToFutureBlock = intervalToFutureBlock;
    return this;
  }

  addPriorityGasPrice(priorityGasPrice: BigNumber) {
    this.priorityGasPrice = priorityGasPrice;
    return this;
  }

  private static nullOrEmpty(value?: string | null) {
    return value === undefined || value === null || value.length === 0;
  }

  build(): Promise<FlashBot> {
    return new Promise((resolve, reject) => {
      const errors: any = {};
      if (!this.blockchainNetworkId || isNaN(this.blockchainNetworkId)) {
        errors.blockchainNetworkId = "Not provided";
      }
      if (!this.blockChainRpcProvider) {
        errors.blockChainRpcProvider = "Not provided";
      }
      if (FlashBotBuilder.nullOrEmpty(this.sponsorPrivateKey)) {
        errors.sponsorPrivateKey = "Not provided";
      }
      if (FlashBotBuilder.nullOrEmpty(this.executorPrivateKey)) {
        errors.executorPrivateKey = "Not provided";
      }

      if (Object.keys(errors).length > 0) {
        reject(new Error(JSON.stringify(errors)));
      } else {
        resolve(
          new FlashBot(
            this.blockchainNetworkId as number,
            this.blockChainRpcProvider as ethers.providers.JsonRpcProvider,
            this.sponsorPrivateKey as string,
            this.executorPrivateKey as string,
            this.intervalToFutureBlock,
            this.priorityGasPrice,
            this.bundleProviderConnectionInfoOrUrl,
            this.bundleProviderNetwork
          )
        );
      }
    });
  }
}

class FlashBot {
  private blockchainNetworkId: number;
  private bundleProviderConnectionInfoOrUrl?: string | ethers.utils.ConnectionInfo;
  private bundleProviderNetwork?: ethers.providers.Networkish;
  private sponsorWallet: Wallet;
  private executorWallet: Wallet;
  private executorTransactions: ethers.providers.TransactionRequest[] = [];
  private blockChainRpcProvider: ethers.providers.JsonRpcProvider;
  private intervalToFutureBlock = BLOCKS_IN_FUTURE;
  private priorityGasPrice = PRIORITY_GAS_PRICE;
  private executionStopped = false;

  constructor(
    blockchainNetworkId: number,
    blockChainRpcProvider: ethers.providers.JsonRpcProvider,
    sponsorPrivateKey: string,
    executorPrivateKey: string,
    intervalToFutureBlock?: number | null,
    priorityGasPrice?: BigNumber | null,
    bundleProviderConnectionInfoOrUrl?: string | ethers.utils.ConnectionInfo,
    bundleProviderNetwork?: ethers.providers.Networkish
  ) {
    this.blockchainNetworkId = blockchainNetworkId;
    this.blockChainRpcProvider = blockChainRpcProvider;
    this.sponsorWallet = new Wallet(sponsorPrivateKey).connect(blockChainRpcProvider);
    this.executorWallet = new Wallet(executorPrivateKey).connect(blockChainRpcProvider);
    if (intervalToFutureBlock) this.intervalToFutureBlock = intervalToFutureBlock;
    if (priorityGasPrice) this.priorityGasPrice = priorityGasPrice;
    this.bundleProviderConnectionInfoOrUrl = bundleProviderConnectionInfoOrUrl;
    this.bundleProviderNetwork = bundleProviderNetwork;
  }

  static Builder() {
    return new FlashBotBuilder();
  }

  getSponsorWallet() {
    return this.sponsorWallet;
  }

  getExecutorWallet() {
    return this.executorWallet;
  }

  getProvider() {
    return this.blockChainRpcProvider;
  }

  addBundleTx(tx: ethers.providers.TransactionRequest) {
    this.executorTransactions.push(tx);
    return this;
  }

  addMultipleBundleTx(txList: ethers.providers.TransactionRequest[]) {
    this.executorTransactions = this.executorTransactions.concat(txList);
    return this;
  }

  exit() {
    this.executionStopped = true;
    this.getProvider().removeAllListeners("block");
  }

  async execute(authSignerKey?: string) {
    if (this.executorTransactions.length == 0) {
      throw new Error("Empty transactions bundle");
    }
  
    let walletRelay: Wallet;
    let authSignerGenerated = false;
    if (!authSignerKey) {
      walletRelay = Wallet.createRandom();
      authSignerKey = walletRelay.privateKey;
      authSignerGenerated = true;
    } else {
      walletRelay = new Wallet(authSignerKey);
    }
  
    const flashbotsProvider = await FlashbotsBundleProvider.create(
      this.getProvider(),
      walletRelay,
      this.bundleProviderConnectionInfoOrUrl,
      this.bundleProviderNetwork
    );
  
    const block = await this.getProvider().getBlock("latest");
    const gasPrice = this.priorityGasPrice.add(block.baseFeePerGas || 0);
    const gasEstimates = await Promise.all(this.executorTransactions.map(tx =>
      this.getProvider().estimateGas({
        ...tx,
        from: tx.from === undefined ? this.executorWallet.address : tx.from
      })
    ));
    // const gasEstimateTotal = gasEstimates.reduce((acc, cur) => acc.add(cur), BigNumber.from(0));
  
    const bundleTransactions: Array<FlashbotsBundleTransaction> = this.executorTransactions.map((transaction, txNumber) => {
      return {
        transaction: {
          chainId: this.blockchainNetworkId,
          gasPrice: gasPrice,
          gasLimit: gasEstimates[txNumber],
          ...transaction,
        },
        signer: this.executorWallet,
      };
    });
    
  
    console.log("FlashbotsBundleTransaction[]:", bundleTransactions);
    const signedBundle = await flashbotsProvider.signBundle(bundleTransactions);
    console.log("Signed Bundle:", signedBundle);
  
    const simulation = await flashbotsProvider.simulate(signedBundle, block.number + 1);
    if ("error" in simulation) {
      console.warn(`Simulation Error: ${simulation.error.message}`);
      return;
    }
  
    console.log("Simulation Successful:", simulation);
  
    if (!this.executionStopped) {
      this.getProvider().on("block", async (blockNumber) => {
        if (!this.executionStopped) {
          const bundleResponse = await flashbotsProvider.sendBundle(
            bundleTransactions,
            blockNumber + this.intervalToFutureBlock
          );
          console.log(bundleResponse);
  
          if (bundleResponse && "bundleTransactions" in bundleResponse) {
            const resolution = await bundleResponse.wait();
            if (resolution === FlashbotsBundleResolution.BundleIncluded) {
              console.log(`Bundle included in block ${blockNumber + this.intervalToFutureBlock}`);
              this.exit(); 
            } else if (resolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
              console.log(`Block ${blockNumber + this.intervalToFutureBlock} passed without bundle inclusion`);
            }
          } else {
            console.warn("Bundle response is null or missing result");
          }
        }
      });
    } else {
      if (authSignerGenerated) {
        console.log(`Please keep the following private key: ${authSignerKey}`);
      }
      process.exit(0);
    }
  }
}

(async () => {
  try {
    const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY;
    const sniperWallets = config.sniperWallets;
    const buyAmounts = config.desiredBuyAmounts;
    const builder = FlashBot.Builder();
    const flashBot = await builder
      .addBlockchainNetworkId(SEPOLIA_CHAIN_ID)
      .addBlockChainRpcProvider(new ethers.providers.JsonRpcProvider(getEnvVar("SEPOLIA_ALCHEMY_URL")))
      .addSponsorPrivateKey(getEnvVar("FUNDING_WALLET_PRIVATE_KEY"))
      .addExecutorPrivateKey(getEnvVar("DEPLOYER_PRIVATE_KEY"))
      .addIntervalToFutureBlock(1)
      .addPriorityGasPrice(PRIORITY_GAS_PRICE)
      .addBundleProviderConnectionInfoOrUrl(getEnvVar("FLASHBOTS_BUNDLE_PROVIDER_URL"))
      .addBundleProviderNetwork({ chainId: SEPOLIA_CHAIN_ID, name: "sepolia" })
      .build();

    const tokenAddress = config.tokenAddress;

    // Prepare the approval transaction
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, flashBot.getExecutorWallet());
    const approveTx = await tokenContract.populateTransaction.approve(
      UNISWAP_V2_ROUTER02_ADDRESS,
      ethers.utils.parseEther("100000000") // Replace with desired approval amount
    );

    // Prepare the liquidity transaction
    const liquidityTx = await (new ethers.Contract(
      UNISWAP_V2_ROUTER02_ADDRESS,
      uniswapRouterAbi,
      flashBot.getExecutorWallet()
    )).populateTransaction.addLiquidityETH(
      tokenAddress,
      ethers.utils.parseEther(config.desiredTokenAmount),
      ethers.utils.parseEther(config.amountTokenMin),
      ethers.utils.parseEther(config.amountETHMin),
      flashBot.getExecutorWallet().address,
      Math.floor(Date.now() / 1000) + 60 * 20,
      {
        value: ethers.utils.parseEther(config.liquidityAmount)
      }
    );

    // Execute the initial bundle with approval and liquidity transactions
    const initialBundleTxs = [approveTx, liquidityTx];
    const initialBundleResponse = await flashBot.addMultipleBundleTx(initialBundleTxs).execute(FLASHBOTS_AUTH_KEY);
    console.log('Initial bundle executed:', initialBundleResponse);

    // Fund sniper wallets
    const fundTxs = sniperWallets.map((privateKey: string, index: string) => ({
      to: new ethers.Wallet(privateKey).address,
      value: ethers.utils.parseEther(buyAmounts[index])
    }));
    const fundBundleResponse = await flashBot.addMultipleBundleTx(fundTxs).execute(FLASHBOTS_AUTH_KEY);
    console.log('Funding bundle executed:', fundBundleResponse);

    // Execute buy transactions for each sniper wallet
    for (let i = 0; i < sniperWallets.length; i++) {
      const sniperWallet = new ethers.Wallet(sniperWallets[i], flashBot.getProvider());
      const buyTx = await (new ethers.Contract(
        UNISWAP_V2_ROUTER02_ADDRESS,
        uniswapRouterAbi,
        sniperWallet
      )).populateTransaction.swapExactETHForTokens(
        ethers.utils.parseEther("0.0005"),
        [config.wethAddress, tokenAddress],
        sniperWallet.address,
        Math.floor(Date.now() / 1000) + 60 * 20,
        {
          value: ethers.utils.parseEther(buyAmounts[i])
        }
      );

      const sniperFlashBot = await builder
        .addExecutorPrivateKey(sniperWallet.privateKey)
        .build();

      const sniperBundleTxs = [buyTx];
      const sniperBundleResponse = await sniperFlashBot.addMultipleBundleTx(sniperBundleTxs).execute(FLASHBOTS_AUTH_KEY);
      console.log(`Sniper wallet ${i + 1} bundle executed:`, sniperBundleResponse);
    }
  } catch (error) {
    console.error('Error:', error);
  }
})();