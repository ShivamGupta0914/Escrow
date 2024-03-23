import { ethers, upgrades } from "hardhat";

async function main() {

  const escrowFactory = await ethers.getContractFactory("Escrow");

  console.log("Escrow contract is deploying........");
  const escrow = await upgrades.deployProxy(escrowFactory, { initializer: 'initialize', unsafeAllow: ['constructor'] });

  console.log("escrow deployed at address: ", await escrow.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});