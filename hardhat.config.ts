import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import "@openzeppelin/hardhat-upgrades";
console.log(11)
dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const SEPOLIA_API_KEY = process.env.SEPOLIA_API_KEY;
const BSC_TESTNET_API_KEY = process.env.BSC_TESTNET_API_KEY;
const SEPOLIA_ETHERSCAN_API_KEY = process.env.SEPOLIA_ETHERSCAN_API_KEY;
const BSC_TESTNET_ETHESCAN_API_KEY = process.env.BSC_TESTNET_ETHESCAN_API_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${SEPOLIA_API_KEY}`,
      accounts: DEPLOYER_PRIVATE_KEY ? [`0x${DEPLOYER_PRIVATE_KEY}`] : [],

    },
    bsctestnet: {
      url: BSC_TESTNET_API_KEY,
      chainId: 97,
      live: true,
      gasPrice: 20000000000,
      accounts: DEPLOYER_PRIVATE_KEY ? [`0x${DEPLOYER_PRIVATE_KEY}`] : [],
    },
  },
  etherscan: {
    customChains: [
      {
        network: "bsctestnet",
        chainId: 97,
        urls: {
          apiURL: "https://api-testnet.bscscan.com/api",
          browserURL: "https://testnet.bscscan.com",
        },
      },
    ],
    apiKey: {
      sepolia: SEPOLIA_ETHERSCAN_API_KEY,
      bsctestnet: BSC_TESTNET_ETHESCAN_API_KEY,
    }
  }
};
