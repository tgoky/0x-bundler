import { providers, Wallet, Contract, PopulatedTransaction, BigNumber, utils } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { parseUnits } from "ethers/lib/utils";
import router from '../ABI/router.json';
import erc from '../ABI/ERC20.json';

// Environment setup
const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
const privateKey = process.env.PRIVATE_KEY || "";
if (!privateKey) {
    throw new Error("Private key is required but not provided.");
}
const account = new Wallet(privateKey, provider);
const authSigner = Wallet.createRandom();
const WETH_ADDRESS = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9';

// Liquidity pool contract address (e.g., Uniswap V2/V3)
const LIQUIDITY_POOL = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const liquidityAbi = router;

// Token address you are adding liquidity for
const TOKEN_ADDRESS = "0xe62765a2E4E8Bf70e7295f5e56447c353A11AA09";
const tokenAbi = erc;

// Wallets to send ETH and buy the token
const wallets = [
    { privateKey: process.env.WALLET1_PRIVATE_KEY, address: process.env.WALLET1_ADDRESS },
    { privateKey: process.env.WALLET2_PRIVATE_KEY, address: process.env.WALLET2_ADDRESS },
    // Add more wallets as necessary
].map(walletData => ({
    privateKey: walletData.privateKey || "",
    address: walletData.address || ""
}));

const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from the current block time

// Specify the required ETH balance for each wallet (gas + transaction value)
const requiredBalance = parseUnits("0.08", "ether");  // Adjust this to the appropriate amount

// Helper function to create wrapped transactions with proper gas settings
async function wrapTx(tx: PopulatedTransaction) {
    const feeData = await provider.getFeeData();
    return {
        ...tx,
        chainId: 11155111,  // Mainnet or replace with desired chain
        type: 2,
        maxFeePerGas: feeData.maxFeePerGas || parseUnits("40", "gwei"), // fallback to 40 gwei
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || parseUnits("2", "gwei"), // fallback to 2 gwei
        gasLimit: BigNumber.from(1_000_000),
    };
}

// Function to encode the swapExactETHForTokens call data
function encodeSwapExactETHForTokens(amountOutMin: BigNumber, path: string[], to: string, deadline: number): string {
    const routerInterface = new utils.Interface(router);
    return routerInterface.encodeFunctionData("swapExactETHForTokens", [
        amountOutMin,
        path,
        to,
        deadline
    ]);
}

// Helper function to ensure the wallet has sufficient ETH to cover gas and transaction costs
async function ensureWalletHasEnoughETH(walletAddress: string, requiredBalance: BigNumber) {
    const balance = await provider.getBalance(walletAddress);
    if (balance.lt(requiredBalance)) {
        const difference = requiredBalance.sub(balance);
        const fundWalletTx: PopulatedTransaction = {
            to: walletAddress,
            value: difference,
            gasLimit: BigNumber.from(21000),  // Standard gas limit for an ETH transfer
        };
        const tx = await account.sendTransaction(await wrapTx(fundWalletTx));
        await tx.wait();  // Wait for the transaction to be mined
        console.log(`Funded ${walletAddress} with ${utils.formatEther(difference)} ETH`);
    } else {
        console.log(`${walletAddress} has sufficient ETH: ${utils.formatEther(balance)}`);
    }
}

async function main() {
    const flashbotsProvider = await FlashbotsBundleProvider.create(
        provider,
        authSigner,
        "https://relay-sepolia.flashbots.net",
        "sepolia"
    );

    const liquidityContract = new Contract(LIQUIDITY_POOL, liquidityAbi, account);
    const tokenContract = new Contract(TOKEN_ADDRESS, tokenAbi, account);

    // Approve the liquidity pool contract to spend your tokens
    const approveTx = await tokenContract.populateTransaction.approve(LIQUIDITY_POOL, parseUnits("1000000000000", 18));

    // Add liquidity transaction
    const addLiquidityTx = await liquidityContract.populateTransaction.addLiquidityETH(
        TOKEN_ADDRESS,
        parseUnits("1000000000000", 18),  // amount of tokens to add as liquidity
        parseUnits("1", 18),    // minimum token amount
        parseUnits("0.0001", 18),    // minimum ETH amount
        account.address,
        deadline,
        { value: parseUnits("0.002", "ether") }  // ETH to pair with tokens in the liquidity pool
    );

    // Ensure each wallet has enough ETH
    for (const walletData of wallets) {
        if (!walletData.privateKey || !walletData.address) {
            throw new Error("Missing wallet private key or address");
        }
        await ensureWalletHasEnoughETH(walletData.address, requiredBalance);
    }

    // Prepare transactions for each wallet
    const transactions = wallets.map(async (walletData) => {
        const wallet = new Wallet(walletData.privateKey, provider);

        // Encode the swap transaction
        const swapData = encodeSwapExactETHForTokens(
            parseUnits("0.00001", "ether"),  // minimum amount of tokens to receive
            [WETH_ADDRESS, TOKEN_ADDRESS],   // Path (e.g., [WETH, Token])
            walletData.address,              // Address to receive tokens
            deadline                        // Deadline
        );

        // Send ETH to the wallet
        const ethTransferTx: PopulatedTransaction = {
            to: walletData.address,
            value: parseUnits("0.0001", "ether"),
            gasLimit: BigNumber.from(21000),  // Standard ETH transfer gas limit
        };

        // Buy token transaction (using a swap function, for example, Uniswap's Router contract)
        const buyTokenTx: PopulatedTransaction = {
            to: TOKEN_ADDRESS,
            data: swapData,  // Replace with actual swap function data
            value: parseUnits("0.00001", "ether"),  // Amount of ETH to use for buying tokens
        };

        return [
            {
                signer: account,
                transaction: await wrapTx(ethTransferTx),
            },
            {
                signer: wallet,
                transaction: await wrapTx(buyTokenTx),
            },
        ];
    });

    const flashbotsBundle = [
        {
            signer: account,
            transaction: await wrapTx(approveTx),
        },
        {
            signer: account,
            transaction: await wrapTx(addLiquidityTx),
        },
        ...(await Promise.all(transactions)).flat(),
    ];

    const signedTransactions = await flashbotsProvider.signBundle(flashbotsBundle);
    const currentBlockNumber = await provider.getBlockNumber();
    const targetBlockNumber = currentBlockNumber + 1;

    const simulation = await flashbotsProvider.simulate(signedTransactions, targetBlockNumber);
    console.log("Simulation:", JSON.stringify(simulation, null, 2));

    // If simulation succeeds, send the bundle
    const flashbotsTransactionResponse = await flashbotsProvider.sendRawBundle(signedTransactions, targetBlockNumber);
    if ("wait" in flashbotsTransactionResponse) {
        const status = await flashbotsTransactionResponse.wait();
        console.log("Bundle status:", status);
    } else {
        console.log("Flashbots transaction error:", flashbotsTransactionResponse);
    }
}

main().catch(console.error);
