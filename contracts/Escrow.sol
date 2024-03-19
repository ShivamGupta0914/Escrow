// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {SafeERC20Upgradeable, IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {EscrowLibSignature} from "./Libs/EscrowLibSignature.sol";

contract Escrow is Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {
    using ECDSA for bytes32;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @notice Thrown when signature is invalid.
     */
    error SignatureMisMatch();

    /**
     * @notice Thrown when funds are already for a particular id.
     */
    error FundsAlreadyReleased();

    /**
     * @notice Thrown when beneficiaryHash received during deposit is zero.
     */
    error InvalidBeneficiaryHash();

    /**
     * @notice Thrown when input address is zero address.
     */
    error ZeroAddressNotAllowed();

    /**
     * @notice Thrown when input value is zero value.
     */
    error ZeroValueNotAllowed();

    /**
     * @notice Thrown when caller of release funds is not the beneficiary assigned to that particular deposit.
     */
    error UnauthorizedBeneficiary();

    /**
     * @notice Thrown when signature has been expired.
     */
    error SignatureExpired();

    /**
     * @notice Thrown when ETH transfer fails.
     */
    error EthTransferFailed();

    /**
     * @notice Thrown when input amount mismatches with the ether value.
     */
    error InputAmountMisMatch();

    /**
     * @notice Thrown when input address is not zero when ethers are deposited.
     */
    error IncorrectTokenAddress();

    /**
     * @notice Emitted when a new deposit is made.
     */
    event DepositCreated(
        uint256 indexed id,
        address indexed depositor,
        address indexed token,
        bool isEthDeposited,
        uint256 amount
    );

    /**
     * @notice Emitted when funds are released from an escrow.
     */
    event FundsReleased(
        uint256 indexed id,
        address indexed beneficiary,
        address indexed receiver,
        address token,
        uint256 amount
    );

    /**
     * @notice Emitted when tokens are swept from the contract.
     */
    event SweepToken(
        address indexed token,
        address indexed receiver,
        uint256 amount
    );

    /**
     * @notice Emitted when ETH is swept from the contract.
     */
    event SweepEth(address indexed receiver, uint256 amount);

    struct Deposit {
        uint256 amount;
        bytes32 beneficiaryHash;
        IERC20Upgradeable token;
        bool isEthDeposited;
        bool released;
    }

    /**
     * @notice Index for the current deposit.
     */
    uint256 public index;

    /**
     * @notice Stores the unique deposits
     */
    mapping(uint256 id => Deposit) public deposits;

    /**
     * @notice Stores the beneficiary address corresponding to the deposit id.
     */
    mapping(uint256 id => address) public getBeneficiary;

    /**
     * @notice To receive Native when msg.data is empty
     */
    receive() external payable {}

    /**
     * @notice To receive Native when msg.data is not empty
     */
    fallback() external payable {}

    /**
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        // Note that the contract is upgradeable. Use initialize() or reinitializers
        // to set the state variables.
        _disableInitializers();
    }

    /**
     * @notice Initializes the deployer to owner
     */
    function initialize() external initializer {
        __Ownable2Step_init();
        __ReentrancyGuard_init();
    }

    /**
     * @notice Creates a new deposit with the specified beneficiary and amount.
     * @param beneficiaryHash The intended beneficiary address hash (hidden from the chain).
     * @param token Address of the token.
     * @param amount The amount of tokens or ETH to deposit.
     * @custom:error ZeroValueNotAllowed is thrown if input amount is zero.
     * @custom:error InvalidBeneficiaryHash is thrown if input beneficiaryHash is zero bytes or it is hash of zero address.
     * @custom:error InputAmountMisMatch is thrown if input amount mismatches with the ether value.
     * @custom:error IncorrectTokenAddress is thrown if input address is not zero when ethers are deposited.
     * @custom:event DepositCreated emits on success.
     */
    function deposit(
        bytes32 beneficiaryHash,
        IERC20Upgradeable token,
        uint256 amount
    ) external payable returns (uint256 id) {
        ensureNonzeroValue(amount);
        if (
            beneficiaryHash == bytes32(0) ||
            beneficiaryHash == keccak256(abi.encodePacked(address(0)))
        ) {
            revert InvalidBeneficiaryHash();
        }

        bool isEthDeposited;
        if (msg.value > 0) {
            if (msg.value != amount) {
                revert InputAmountMisMatch();
            }

            if (address(token) != address(0)) {
                revert IncorrectTokenAddress();
            }

            isEthDeposited = true;
        } else {
            token.safeTransferFrom(msg.sender, address(this), amount);
        }

        id = index++;
        deposits[id] = Deposit({
            amount: amount,
            beneficiaryHash: beneficiaryHash,
            token: token,
            isEthDeposited: isEthDeposited,
            released: false
        });

        emit DepositCreated(
            id,
            msg.sender,
            address(token),
            isEthDeposited,
            amount
        );
    }

    /**
     * @notice Releases the funds from a deposit to the provided beneficiary.
     * @param id The ID of the deposit from which funds are to be released.
     * @param receiver Address of the funds receiver.
     * @custom:error UnauthorizedBeneficiary is caller is not the beneficiary of that deposit id.
     * @custom:event FundsReleased emits on success.
     */
    function releaseFunds(uint256 id, address receiver) external nonReentrant {
        bytes32 beneficiaryHash = keccak256(abi.encodePacked(msg.sender));
        if (beneficiaryHash != deposits[id].beneficiaryHash) {
            revert UnauthorizedBeneficiary();
        }

        _releaseFunds(id, receiver, msg.sender);
    }

    /**
     * @notice Allows the release of funds on behalf of beneficiary with a valid signature before a deadline.
     * @dev Verifies the signature against the hashed information provided; if valid and before the deadline, it releases the designated funds.
     * @param signature The digital signature provided by the beneficiary, proving their consent to release funds.
     * @param info Struct containing the beneficiary's information, including the ID of the deposit, the intended receiver's address, and the deadline for the operation.
     * @custom:error ZeroAddressNotAllowed is thrown if receiver address is zero address.
     * @custom:error SignatureExpired is thrown if operation was attempted after the deadline specified in `info`.
     * @custom:event FundsReleased emits on success.
     */
    function permitReleaseFunds(
        bytes memory signature,
        EscrowLibSignature.BeneficiaryInfo memory info
    ) external nonReentrant {
        ensureNonzeroAddress(info.receiver);
        if (block.timestamp > info.deadline) {
            revert SignatureExpired();
        }

        address beneficiary = _verifySignature(signature, info);
        _releaseFunds(info.id, info.receiver, beneficiary);
    }

    /**
     * @notice Sweeps ETH from the contract and sends them to the owner.
     * @custom:event SweepEth is emitted when assets are swept from the contract.
     */
    function sweepEth() external onlyOwner {
        uint256 balance = address(this).balance;

        if (balance > 0) {
            address owner_ = owner();
            _safeTransferETH(owner_, balance);
            emit SweepEth(owner_, balance);
        }
    }

    /**
     * @notice Sweeps the input token address tokens from the contract and sends them to the owner.
     * @param token Address of the token.
     * @custom:event SweepToken emits on success.
     */
    function sweepToken(IERC20Upgradeable token) external onlyOwner {
        uint256 balance = token.balanceOf(address(this));

        if (balance > 0) {
            address owner_ = owner();
            token.safeTransfer(owner_, balance);
            emit SweepToken(address(token), owner_, balance);
        }
    }

    // ---------------------Internal functions---------------------------- //

    /**
     * @dev Releases the funds from an deposit to the provided beneficiary.
     * @param id Index of the deposit.
     * @param receiver Address of the token or eth receiver.
     * @param beneficiary Address of the beneficiary.
     * @custom:error FundsAlreadyReleased is thrown if input deposit id funds have already been released.
     * @custom:event FundsReleased emits on success.
     */
    function _releaseFunds(
        uint256 id,
        address receiver,
        address beneficiary
    ) internal {
        if (deposits[id].released) {
            revert FundsAlreadyReleased();
        }

        uint256 amount = deposits[id].amount;
        IERC20Upgradeable token = deposits[id].token;
        deposits[id].released = true;
        deposits[id].amount = 0;

        if (deposits[id].isEthDeposited) {
            _safeTransferETH(receiver, amount);
        } else {
            token.safeTransfer(receiver, amount);
        }

        getBeneficiary[id] = beneficiary;
        emit FundsReleased(id, beneficiary, receiver, address(token), amount);
    }

    /**
     * @dev transfer ETH to an address, revert if it fails.
     * @param to recipient of the transfer.
     * @param value the amount to send.
     * @custom:error EthTransferFailed is thrown if the ETH transfer fails.
     */
    function _safeTransferETH(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}(new bytes(0));

        if (!success) {
            revert EthTransferFailed();
        }
    }

    /**
     * @dev Verifies that the input signature belongs to the beneficiary of that deposit or not.
     * @param signature The digital signature provided by the beneficiary, proving their consent to release funds.
     * @param info Struct containing the beneficiary's information, including the ID of the deposit, the intended receiver's address, and the deadline for the operation.
     * @return beneficiary Address of the beneficiary.
     * @custom:error SignatureMisMatch is thrown if the signature does not match the expected signature generated from the beneficiary's information.
     */
    function _verifySignature(
        bytes memory signature,
        EscrowLibSignature.BeneficiaryInfo memory info
    ) internal view returns (address beneficiary) {
        bytes32 hash = EscrowLibSignature._getHash(info);
        beneficiary = ECDSA.recover(hash, signature);

        bytes32 beneficiaryHash = keccak256(abi.encodePacked(beneficiary));
        if (beneficiaryHash != deposits[info.id].beneficiaryHash) {
            revert SignatureMisMatch();
        }
    }

    // ---------------------Private functions---------------------------- //

    /**
     * @dev Checks if the provided address is nonzero, reverts otherwise.
     * @param address_ The address to check.
     * @custom:error ZeroAddressNotAllowed is thrown if the provided address is a zero address.
     */
    function ensureNonzeroAddress(address address_) private pure {
        if (address_ == address(0)) {
            revert ZeroAddressNotAllowed();
        }
    }

    /**
     * @dev Checks if the provided value is nonzero, reverts otherwise.
     * @param value_ The value to check.
     * @custom:error ZeroValueNotAllowed is thrown if the provided vllue is zero.
     */
    function ensureNonzeroValue(uint256 value_) private pure {
        if (value_ == 0) {
            revert ZeroValueNotAllowed();
        }
    }
}
