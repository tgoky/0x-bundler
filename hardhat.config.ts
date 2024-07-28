import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.0",
  networks: {
    testnet: {
      url: 'https://sepolia.infura.io/v3/23a20fc28538440eb019569a29bb7339',
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 11155111,
    },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },
};

export default config;
