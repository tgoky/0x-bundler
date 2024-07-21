import { ethers, BigNumber, Wallet } from "ethers";
import {
  FlashbotsBundleProvider,
  FlashbotsBundleRawTransaction,
  FlashbotsBundleResolution,
  FlashbotsBundleTransaction
} from "@flashbots/ethers-provider-bundle";
import { Doc } from "../scripts/types";
import { checkSimulation, gasPriceToGwei, printTransactions } from "../scripts/utils";
import { exit } from "process";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
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
      const errors: Doc = {};
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
    const gasEstimateTotal = gasEstimates.reduce((acc, cur) => acc.add(cur), BigNumber.from(0));

    const bundleTransactions: Array<FlashbotsBundleTransaction | FlashbotsBundleRawTransaction> = [
      {
        transaction: {
          chainId: this.blockchainNetworkId,
          to: this.executorWallet.address,
          gasPrice: gasPrice,
          value: gasEstimateTotal.mul(gasPrice),
          gasLimit: 21000,
        },
        signer: this.sponsorWallet
      },
      ...this.executorTransactions.map((transaction, txNumber) => {
        return {
          transaction: {
            chainId: this.blockchainNetworkId,
            gasPrice: gasPrice,
            gasLimit: gasEstimates[txNumber],
            ...transaction,
          },
          signer: this.executorWallet,
        };
      })
    ];

    console.log("FlashbotsBundleTransaction[]:", bundleTransactions);
    const signedBundle = await flashbotsProvider.signBundle(bundleTransactions);
    await printTransactions(bundleTransactions, signedBundle);
    let simulatedGasPrice = await checkSimulation(flashbotsProvider, signedBundle);

    console.log(`Executor Account: ${this.executorWallet.address}`);
    console.log(`Sponsor Account: ${this.sponsorWallet.address}`);
    console.log(`Simulated Gas Price: ${gasPriceToGwei(simulatedGasPrice)} gwei`);
    console.log(`Gas Price: ${gasPriceToGwei(gasPrice)} gwei`);
    console.log(`Gas Used: ${gasEstimateTotal.toString()}`);
    console.log(`Auth Signer Account${authSignerGenerated ? "(Generated!)" : ""}: ${walletRelay.address}`);
    if (authSignerGenerated) {
      console.log(`Your auth signer account was generated by the program. 
      \nIt's advised to reuse it next time to build up reputation on the flashbots network.
      \nThe generated auth signer private key will be returned with the response of this transactions bundle.
      \nTransactions bundle Response format:
      \n{
        blockNumber: EXAMPLE_NUMBER_OF_BLOCK_TX_BUNDLE_WAS_ADDED_TO, 
        authSignerKey: EXAMPLE_GENERATED_OR_SUPPLIED_AUTH_SIGNER_KEY,
        totalInclusionFails: TOTAL_NUMBER_OF_FAILED_TARGET_BLOCKS
      }\n`);
    }

    let lastBlock = 0;
    let totalInclusionFails = 0;
    let targetBlockNumber = block.number;

    this.getProvider().on("block", async (blockNumber) => {
      if (blockNumber <= lastBlock) return;
      lastBlock = blockNumber;
      if (this.executionStopped) { return; }

      try {
        simulatedGasPrice = await checkSimulation(flashbotsProvider, signedBundle);
      } catch (e: any) {
        if (e.message.includes("nonce too low")) {
          this.exit();
          return {
            blockNumber: targetBlockNumber,
            authSignerKey: authSignerKey,
            totalInclusionFails: totalInclusionFails
          };
        } else {
          this.exit();
          throw new Error(JSON.stringify({
            blockNumber: targetBlockNumber,
            message: e.message,
            totalInclusionFails: totalInclusionFails
          }));
        }
      }

      targetBlockNumber = blockNumber + this.intervalToFutureBlock;
      console.log(`Current Block Number: ${blockNumber}, Target Block Number:${targetBlockNumber}, gasPrice: ${gasPriceToGwei(simulatedGasPrice)} gwei`);

      if (this.executionStopped) { return; }
      try {
        const bundleResponse = await flashbotsProvider.sendBundle(bundleTransactions, targetBlockNumber);

        if ("error" in bundleResponse) {
          console.log("error:", bundleResponse.error.message);
          return;
        }

        const bundleResolution = await bundleResponse.wait();
        if (bundleResolution === FlashbotsBundleResolution.BundleIncluded) {
          this.exit();
          return {
            blockNumber: targetBlockNumber,
            authSignerKey: authSignerKey,
            totalInclusionFails: totalInclusionFails
          };
        } else if (bundleResolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
          totalInclusionFails++;
          console.log(`Not included in ${targetBlockNumber} | Total Inclusion Fails: ${totalInclusionFails}`);
        } else if (bundleResolution === FlashbotsBundleResolution.AccountNonceTooHigh) {
          /* This error sometimes occurs when a transaction has already been submitted.
             Waiting/doing nothing will be better. The checkSimulation of the next block
             listener will make a decision. */
        }
      } catch (e: any) {
        if (!this.executionStopped) {
          this.exit();
          throw new Error(JSON.stringify({
            blockNumber: targetBlockNumber,
            message: e.message,
            totalInclusionFails: totalInclusionFails
          }));
        }
      }
    });
  }
}

const startFlashbot = async () => {
  const flashBot = await FlashBot.Builder()
    .addBlockchainNetworkId(SEPOLIA_CHAIN_ID)
    .addBlockChainRpcProvider(new ethers.providers.JsonRpcProvider(getEnvVar("RPC_URL")))
    .addSponsorPrivateKey(getEnvVar("SPONSOR_PRIVATE_KEY"))
    .addExecutorPrivateKey(getEnvVar("EXECUTOR_PRIVATE_KEY"))
    .addBundleProviderConnectionInfoOrUrl(getEnvVar("FLASHBOTS_RELAY_URL", "https://relay-sepolia.flashbots.net"))
    .build();

    console.log("Token Address:", config.tokenAddress);
    console.log("Desired Token Amount:", config.desiredTokenAmount);
    console.log("Min Token Amount:", config.minTokenAmount);
    console.log("Min ETH Amount:", config.minEthAmount);
    console.log("Recipient:", config.recipient);
    console.log("ETH Amount:", config.ethAmount);
    
    const transactionData = {
      to: UNISWAP_V2_ROUTER02_ADDRESS,
      data: new ethers.utils.Interface(uniswapRouterAbi).encodeFunctionData("addLiquidityETH", [
        config.tokenAddress,
        ethers.utils.parseUnits(config.desiredTokenAmount, 18), // Replace 18 with the correct decimals if different
        ethers.utils.parseUnits(config.minTokenAmount, 18),
        ethers.utils.parseUnits(config.minEthAmount, 18),
        config.recipient,
        Math.floor(Date.now() / 1000) + 60 * 20, // deadline
      ]),
      value: ethers.utils.parseEther(config.ethAmount),
    };

  flashBot.addBundleTx(transactionData);
  await flashBot.execute(getEnvVar("AUTH_SIGNER_PRIVATE_KEY"));
};


startFlashbot().catch((error) => {
  console.error("Error running flashbot:", error);
  exit(1);
});
