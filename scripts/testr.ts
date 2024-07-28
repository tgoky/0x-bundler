const { ethers } = require('ethers');
import erc20Abi from '../ABI/ERC20.json';
import uniswapRouterAbi from '../ABI/UniswapRouter.json';
// Replace with your own values
const SEPOLIA_ALCHEMY_URL = "https://sepolia.infura.io/v3/23a20fc28538440eb019569a29bb7339";
const sniperPrivateKey = ""; // Replace with sniper wallet private key
const tokenAddress = "0x54cec23B02E7B9EB2901C3307F652450e0810de7";
const uniswapRouterAddress = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const wethAddress = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const approvalAmount = "1000000"; // Example amount to approve
const buyAmount = "0.001"; // Example ETH amount to buy tokens


const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_ALCHEMY_URL);
const sniperWallet = new ethers.Wallet(sniperPrivateKey, provider);

// Approve the Uniswap Router to spend tokens
async function approveToken() {
  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, sniperWallet);
  const approveTx = await tokenContract.approve(uniswapRouterAddress, ethers.utils.parseEther(approvalAmount));
  await approveTx.wait();
  console.log('Approval successful:', approveTx.hash);
}

// Buy tokens on Uniswap
async function buyTokens() {
  const uniswapRouter = new ethers.Contract(uniswapRouterAddress, uniswapRouterAbi, sniperWallet);
  const buyTx = await uniswapRouter.swapExactETHForTokens(
    ethers.utils.parseEther("0.0001"), // Minimum tokens expected
    [wethAddress, tokenAddress],
    sniperWallet.address,
    Math.floor(Date.now() / 1000) + 60 * 20,
    {
      value: ethers.utils.parseEther(buyAmount)
    }
  );
  await buyTx.wait();
  console.log('Token purchase successful:', buyTx.hash);
}

(async () => {
  try {
    await approveToken();
    await buyTokens();
  } catch (error) {
    console.error('Error:', error);
  }
})();
