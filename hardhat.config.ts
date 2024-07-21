import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.0",
  networks: {
    mainnet: {
      url: 'https://rpc-sepolia.flashbots.net/',
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 1,
    },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },
};

export default config;
