// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title RUNNER — the run-to-earn token of the RUNNER app.
/// @notice Fixed supply of 1,000,000,000 RUNNER, all created at deployment:
///         • 80% run rewards — held by this contract, paid out only through claim()
///         • 10% liquidity   — to the liquidity wallet
///         • 10% team        — to the team wallet
///         There is no mint function. Supply can only go down (burn).
/// @dev    Runners claim what the RUNNER server has verified they earned. The server signs
///         an EIP-712 message "account has earned `totalEarned` in total"; the contract pays
///         the difference to what was already claimed. A daily cap limits the damage if the
///         server key ever leaks, and the owner can rotate that key or pause claims.
///         The owner can never take tokens out of the reward pool.
contract RunnerToken {
    string public constant name = "RUNNER";
    string public constant symbol = "RUNNER";
    uint8 public constant decimals = 18;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant REWARDS_ALLOCATION = 800_000_000 ether;
    uint256 public constant LIQUIDITY_ALLOCATION = 100_000_000 ether;
    uint256 public constant TEAM_ALLOCATION = 100_000_000 ether;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address account,uint256 totalEarned,uint256 deadline)");
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    uint256 public totalSupply;
    address public owner;
    address public signer;
    bool public claimsPaused;
    uint256 public dailyClaimCap = 1_000_000 ether;
    uint256 public totalClaimed;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public claimed;
    mapping(uint256 => uint256) public claimedOnDay;

    uint256 private immutable _cachedChainId;
    bytes32 private immutable _cachedDomainSeparator;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed holder, address indexed spender, uint256 value);
    event Claimed(address indexed account, uint256 amount, uint256 totalEarned);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SignerChanged(address indexed signer);
    event ClaimsPausedChanged(bool paused);
    event DailyClaimCapChanged(uint256 cap);

    error NotOwner();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ClaimsPaused();
    error Expired();
    error BadSignature();
    error NothingToClaim();
    error DailyCapReached();
    error PoolEmpty();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner, address liquidityWallet, address teamWallet) {
        if (initialOwner == address(0) || liquidityWallet == address(0) || teamWallet == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
        _mint(address(this), REWARDS_ALLOCATION);
        _mint(liquidityWallet, LIQUIDITY_ALLOCATION);
        _mint(teamWallet, TEAM_ALLOCATION);
    }

    // ----------------------------------------------------------------- ERC-20

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        _spendAllowance(from, value);
        _transfer(from, to, value);
        return true;
    }

    /// @notice Destroy your own tokens (used by in-app spending later).
    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }

    function burnFrom(address from, uint256 value) external {
        _spendAllowance(from, value);
        _burn(from, value);
    }

    // ----------------------------------------------------------------- run rewards

    /// @notice RUNNER still waiting in the reward pool.
    function rewardsRemaining() external view returns (uint256) {
        return balanceOf[address(this)];
    }

    /// @notice How much `account` can claim with a server signature for `totalEarned`.
    function claimable(address account, uint256 totalEarned) external view returns (uint256) {
        uint256 done = claimed[account];
        return totalEarned > done ? totalEarned - done : 0;
    }

    /// @notice Pay `account` its verified earnings. Anyone may submit the transaction;
    ///         tokens always go to `account`.
    function claim(address account, uint256 totalEarned, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        if (claimsPaused) revert ClaimsPaused();
        if (block.timestamp > deadline) revert Expired();
        if (account == address(0)) revert ZeroAddress();
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", domainSeparator(), keccak256(abi.encode(CLAIM_TYPEHASH, account, totalEarned, deadline))
        ));
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) revert BadSignature();
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != signer) revert BadSignature();

        uint256 done = claimed[account];
        if (totalEarned <= done) revert NothingToClaim();
        uint256 amount = totalEarned - done;
        uint256 day = block.timestamp / 1 days;
        if (claimedOnDay[day] + amount > dailyClaimCap) revert DailyCapReached();
        if (balanceOf[address(this)] < amount) revert PoolEmpty();

        claimed[account] = totalEarned;
        claimedOnDay[day] += amount;
        totalClaimed += amount;
        _transfer(address(this), account, amount);
        emit Claimed(account, amount, totalEarned);
    }

    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _buildDomainSeparator();
    }

    // ----------------------------------------------------------------- owner

    /// @notice Set the RUNNER server's signing address. Zero disables claims.
    function setSigner(address newSigner) external onlyOwner {
        signer = newSigner;
        emit SignerChanged(newSigner);
    }

    function setClaimsPaused(bool paused_) external onlyOwner {
        claimsPaused = paused_;
        emit ClaimsPausedChanged(paused_);
    }

    function setDailyClaimCap(uint256 cap) external onlyOwner {
        dailyClaimCap = cap;
        emit DailyClaimCapChanged(cap);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ----------------------------------------------------------------- internals

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256("1"), block.chainid, address(this)));
    }

    function _spendAllowance(address from, uint256 value) private {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            unchecked { allowance[from][msg.sender] = allowed - value; }
        }
    }

    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) private {
        totalSupply += value;
        unchecked { balanceOf[to] += value; }
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }
}
