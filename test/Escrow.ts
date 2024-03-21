import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, upgrades } from "hardhat";
import { TypedDataDomain, TypedDataField } from "ethers";
import { Escrow, MockToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { parseUnits } from "ethers";

const zero_address = "0x0000000000000000000000000000000000000000";
const domainName = "Escrow";
const domainVersion = "1.0.0";
const chainId = 31337 // this is for the chain's ID. value is 31337 for hardhat
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const SEPOLIA_API_KEY = process.env.SEPOLIA_API_KEY;
const BSC_TESTNET_API_KEY = process.env.BSC_TESTNET_API_KEY;
const SEPOLIA_ETHERSCAN_API_KEY = process.env.SEPOLIA_ETHERSCAN_API_KEY;
const BSC_TESTNET_ETHESCAN_API_KEY = process.env.BSC_TESTNET_ETHESCAN_API_KEY;
console.log(DEPLOYER_PRIVATE_KEY, SEPOLIA_API_KEY, BSC_TESTNET_API_KEY, SEPOLIA_ETHERSCAN_API_KEY, BSC_TESTNET_ETHESCAN_API_KEY);

async function createPermit(signer: SignerWithAddress, id: number, deadline: number, receiver: string): Promise<string> {
    const beneficiaryInfo = { id, deadline, receiver };
    const BeneficiaryInfo = [
        { name: "id", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "receiver", type: "address" },
    ];

    const domain: TypedDataDomain = {
        name: domainName,
        version: domainVersion,
        chainId: chainId
    }

    const types: Record<string, TypedDataField[]> = {
        BeneficiaryInfo: BeneficiaryInfo
    }
    const value = beneficiaryInfo;
    return await signer.signTypedData(domain, types, value);
}

describe("Escrow", () => {
    let token: MockToken;
    let token2: MockToken;
    let escrow: Escrow;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let user4: SignerWithAddress;
    let beneficiary: SignerWithAddress;
    let deployer: SignerWithAddress;

    async function deployEscrow() {
        const [deployer, , user2, user3, user4] = await ethers.getSigners();

        const tokenFactory = await ethers.getContractFactory("MockToken");
        const token = await tokenFactory.deploy("MyToken", "MTK", 18);

        const token2 = await tokenFactory.deploy("MyToken1", "MTK2", 18);

        const escrowFactory = await ethers.getContractFactory("Escrow");
        const escrow = await upgrades.deployProxy(escrowFactory, { initializer: 'initialize', unsafeAllow: ['constructor'] });

        return { token, token2, escrow, deployer, user2, user3, user4 };
    }

    beforeEach(async () => {
        ({ token, token2, escrow, deployer, user2, user3, user4 } = await loadFixture(deployEscrow));
        beneficiary = user3;
        await token.faucet(parseUnits("1000", 18));
        await token2.faucet(parseUnits("1000", 18));
    });

    describe("deposit", () => {
        it("should revert when zero amount is passed", async () => {
            const hash = ethers.solidityPackedKeccak256(["address"], [beneficiary.address]);

            const tx = escrow.deposit(hash, token, 0);
            await expect(tx).to.be.revertedWithCustomError(escrow, "ZeroValueNotAllowed");
        });

        it("should revert when beneficiary is zero address", async () => {
            const hash = ethers.solidityPackedKeccak256(["address"], [zero_address]);

            const tx = escrow.deposit(hash, zero_address, parseUnits("1", 18), { value: ethers.parseEther("1") });
            await expect(tx).to.be.revertedWithCustomError(escrow, "InvalidBeneficiaryHash");
        });

        it("should revert when zero bytes hash is passed", async () => {
            const zeroHash = "0x" + "0".repeat(64);

            const tx = escrow.deposit(zeroHash, token, 10);
            await expect(tx).to.be.revertedWithCustomError(escrow, "InvalidBeneficiaryHash");
        });

        it("should revert when eth value differs from the input amount value", async () => {
            const hash = ethers.solidityPackedKeccak256(["address"], [beneficiary.address]);

            const tx = escrow.deposit(hash, zero_address, parseUnits("1", 17), { value: ethers.parseEther("1") });
            await expect(tx).to.be.revertedWithCustomError(escrow, "InputAmountMisMatch");
        });

        it("should revert when eth is deposited and token address is passed is non-zero", async () => {
            const hash = ethers.solidityPackedKeccak256(["address"], [beneficiary.address]);

            const tx = escrow.deposit(hash, token, parseUnits("1", 18), { value: ethers.parseEther("1") });
            await expect(tx).to.be.revertedWithCustomError(escrow, "IncorrectTokenAddress");
        });

        it("should execute successfully", async () => {
            let amount = parseUnits("100", 18);
            await token.approve(await escrow.getAddress(), amount);
            await token2.approve(await escrow.getAddress(), amount);

            const hash = ethers.solidityPackedKeccak256(["address"], [beneficiary.address]);
            let tx = await escrow.deposit(hash, token, amount);

            await expect(tx).to.emit(escrow, "DepositCreated").withArgs(0, deployer.address, await token.getAddress(), false, amount);

            const deposit1 = await escrow.deposits(0);

            expect(deposit1.amount).to.equal(amount);
            expect(deposit1.beneficiaryHash).to.equal(hash);
            expect(deposit1.isEthDeposited).to.equal(false);
            expect(deposit1.released).to.equal(false);

            tx = await escrow.deposit(hash, token2, amount);
            await expect(tx).to.emit(escrow, "DepositCreated").withArgs(1, deployer.address, await token2.getAddress(), false, amount);

            const deposit2 = await escrow.deposits(1);

            expect(deposit2.amount).to.equal(amount);
            expect(deposit2.beneficiaryHash).to.equal(hash);
            expect(deposit2.isEthDeposited).to.equal(false);
            expect(deposit2.released).to.equal(false);

            amount = parseUnits("1", 18);
            tx = await escrow.deposit(hash, zero_address, amount, { value: ethers.parseEther("1") });

            await expect(tx).to.emit(escrow, "DepositCreated").withArgs(2, deployer.address, zero_address, true, amount);
            const deposit3 = await escrow.deposits(2);

            expect(deposit3.amount).to.equal(amount);
            expect(deposit3.beneficiaryHash).to.equal(hash);
            expect(deposit3.isEthDeposited).to.equal(true);
            expect(deposit3.released).to.equal(false);
            expect(await escrow.getBeneficiary(0)).to.equal(zero_address);
        });
    });

    describe("releaseFunds", () => {
        const amount = parseUnits("100", 18);
        const ethAmount = parseUnits("1", 18);

        beforeEach(async () => {
            await token.approve(await escrow.getAddress(), amount);

            const hash = ethers.solidityPackedKeccak256(["address"], [beneficiary.address]);
            await escrow.deposit(hash, token, amount);

            await escrow.deposit(hash, zero_address, ethAmount, { value: ethers.parseEther("1") });
        });

        it("should revert when called by unauthorized beneficiary", async () => {
            const tx = escrow.connect(user2).releaseFunds(0, user2.address);
            await expect(tx).to.be.revertedWithCustomError(escrow, "UnauthorizedBeneficiary");
        });

        it("should revert when funds are already released", async () => {
            await escrow.connect(beneficiary).releaseFunds(0, user2.address);

            const tx = escrow.connect(beneficiary).releaseFunds(0, user2.address);
            await expect(tx).to.be.revertedWithCustomError(escrow, "FundsAlreadyReleased");
        });

        it("should execute successfully for erc20 tokens", async () => {
            const user2BalanceBefore = await token.balanceOf(user2.address);
            expect(await escrow.getBeneficiary(0)).to.equal(zero_address);

            const tx = await escrow.connect(beneficiary).releaseFunds(0, user2.address);
            await expect(tx).to.emit(escrow, "FundsReleased").withArgs(0, beneficiary.address, user2.address, await token.getAddress(), amount);

            const user2BalanceAfter = await token.balanceOf(user2.address);

            expect(user2BalanceAfter - user2BalanceBefore).to.equal(amount);
            expect(await escrow.getBeneficiary(0)).to.equal(beneficiary.address);

            const deposit = await escrow.deposits(0);
            expect(deposit.released).to.equal(true);
        });

        it("should execute successfully for eth", async () => {
            const user2BalanceBefore = await ethers.provider.getBalance(user2.address);
            expect(await escrow.getBeneficiary(1)).to.equal(zero_address);

            const tx = await escrow.connect(beneficiary).releaseFunds(1, user2.address);
            await expect(tx).to.emit(escrow, "FundsReleased").withArgs(1, beneficiary.address, user2.address, zero_address, ethAmount);

            const user2BalanceAfter = await ethers.provider.getBalance(user2.address);

            expect(user2BalanceAfter - user2BalanceBefore).to.equal(ethAmount);
            expect(await escrow.getBeneficiary(1)).to.equal(beneficiary.address);

            const deposit = await escrow.deposits(1);
            expect(deposit.released).to.equal(true);
        });
    });

    describe("permitReleaseFunds", () => {
        const amount = parseUnits("100", 18);
        const ethAmount = parseUnits("1", 18);


        beforeEach(async () => {
            await token.approve(await escrow.getAddress(), amount);

            const hash = ethers.solidityPackedKeccak256(["address"], [beneficiary.address]);
            await escrow.deposit(hash, token, amount);

            await escrow.deposit(hash, zero_address, ethAmount, { value: ethers.parseEther("1") });
        });

        it("should revert when receiver address is zero address", async () => {
            const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
            const deadline = timestamp + 1000;
            const sig = await createPermit(beneficiary, 0, deadline, zero_address);

            const BeneficiaryInfo = {
                id: 0,
                deadline: deadline,
                receiver: zero_address
            }

            const tx = escrow.connect(user4).permitReleaseFunds(sig, BeneficiaryInfo);
            await expect(tx).to.be.revertedWithCustomError(escrow, "ZeroAddressNotAllowed");
        });

        it("should revert when signature mismatches", async () => {
            const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
            const deadline = timestamp + 1000;
            const sig = await createPermit(beneficiary, 0, deadline, user2.address);

            const BeneficiaryInfo = {
                id: 0,
                deadline: deadline - 1,
                receiver: user2.address
            }
            const tx = escrow.connect(user4).permitReleaseFunds(sig, BeneficiaryInfo);
            await expect(tx).to.be.revertedWithCustomError(escrow, "SignatureMisMatch");

        });

        it("should revert when  deadline is passed", async () => {
            const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
            const deadline = timestamp - 1;
            const sig = await createPermit(beneficiary, 0, deadline, user2.address);

            const BeneficiaryInfo = {
                id: 0,
                deadline: deadline,
                receiver: user2.address
            }

            const tx = escrow.connect(user4).permitReleaseFunds(sig, BeneficiaryInfo);
            await expect(tx).to.be.revertedWithCustomError(escrow, "SignatureExpired");
        });

        it("should revert when funds are already released", async () => {
            const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
            const deadline = timestamp + 1000;
            const sig = await createPermit(beneficiary, 0, deadline, user2.address);

            const BeneficiaryInfo = {
                id: 0,
                deadline: deadline,
                receiver: user2.address
            }
            await escrow.connect(user4).permitReleaseFunds(sig, BeneficiaryInfo);

            const tx = escrow.connect(user4).permitReleaseFunds(sig, BeneficiaryInfo);
            await expect(tx).to.be.revertedWithCustomError(escrow, "FundsAlreadyReleased");
        });

        it("should execute successfully for ERC20", async () => {
            const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
            const deadline = timestamp + 1000;
            const sig = await createPermit(beneficiary, 0, deadline, user2.address);

            const BeneficiaryInfo = {
                id: 0,
                deadline: deadline,
                receiver: user2.address
            }

            const user2BalanceBefore = await token.balanceOf(user2.address);
            const contractBalanceBefore = await token.balanceOf(await escrow.getAddress());
            const tx = await escrow.connect(user4).permitReleaseFunds(sig, BeneficiaryInfo);
            const user2BalanceAfter = await token.balanceOf(user2.address);
            const contractBalanceAfter = await token.balanceOf(await escrow.getAddress());

            expect(user2BalanceAfter - user2BalanceBefore).to.equal(amount);
            expect(contractBalanceBefore - contractBalanceAfter).to.equal(amount);

            const deposit = await escrow.deposits(0);
            expect(deposit.amount).to.equal(0);
            expect(deposit.released).to.equal(true);
            expect(await escrow.getBeneficiary(0)).to.equal(beneficiary.address);

            await expect(tx).to.emit(escrow, "FundsReleased").withArgs(0, beneficiary.address, user2.address, await token.getAddress(), amount);
        });

        it("should execute successfully for eth", async () => {
            const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
            const deadline = timestamp + 1000;

            const sig = await createPermit(beneficiary, 1, deadline, user2.address);

            const BeneficiaryInfo = {
                id: 1,
                deadline: deadline,
                receiver: user2.address
            }

            const user2BalanceBefore = await ethers.provider.getBalance(user2.address);
            const contractBalanceBefore = await ethers.provider.getBalance(await escrow.getAddress());
            const tx = await escrow.connect(user4).permitReleaseFunds(sig, BeneficiaryInfo);
            const user2BalanceAfter = await ethers.provider.getBalance(user2.address);
            const contractBalanceAfter = await ethers.provider.getBalance(await escrow.getAddress());

            expect(user2BalanceAfter - user2BalanceBefore).to.equal(ethAmount);
            expect(contractBalanceBefore - contractBalanceAfter).to.equal(ethAmount);

            const deposit = await escrow.deposits(1);
            expect(deposit.amount).to.equal(0);
            expect(deposit.released).to.equal(true);
            expect(await escrow.getBeneficiary(1)).to.equal(beneficiary.address);

            await expect(tx).to.emit(escrow, "FundsReleased").withArgs(1, beneficiary.address, user2.address, zero_address, ethAmount);
        });
    });


    describe("sweepEth", () => {
        it("should revert when called by non owener", async () => {
            await expect(escrow.connect(user2).sweepEth()).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );
        });

        it("should execute successfully", async () => {
            await deployer.sendTransaction({ to: await escrow.getAddress(), value: ethers.parseEther("10") });

            const previousBalance = await ethers.provider.getBalance(deployer.address);
            await escrow.sweepEth();

            expect(await ethers.provider.getBalance(deployer.address)).to.be.greaterThan(previousBalance);
        });
    });

    describe("SweepToken", () => {
        it("should revert when called by non owner", async () => {
            await expect(escrow.connect(user2).sweepToken(await token.getAddress())).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );
        });

        it("should sweep all tokens", async () => {
            await token.transfer(await escrow.getAddress(), parseUnits("2", 18));

            const ownerPreviousBalance = await token.balanceOf(await deployer.getAddress());
            await escrow.sweepToken(await token.getAddress());

            expect(await token.balanceOf(await escrow.getAddress())).to.be.eq(0);
            expect(await token.balanceOf(await deployer.getAddress())).to.be.greaterThan(ownerPreviousBalance);
        });
    });

});
