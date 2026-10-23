// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title RUNNER — the run-to-earn token of the RUNNER app.
/// @notice Fixed supply of 1,000,000,000 RUNNER, all created at deployment:
///         • 80% run rewards — held by this contract, paid out only through claim()
///         • 10% liquidity   — to the liquidity wallet
///         • 10% team        — to the team wallet
///         There is no mint function. Supply can only go down (burn).
///
///         Trading tax — fixed forever at 4% on buys and sells through registered exchange
///         pools (wallet-to-wallet transfers and run-reward claims are never taxed):
///         • 2% to the protocol wallet
///         • 2% to holders. Each UTC day's holder tax is shared by every wallet that held at
///           least 300,000 RUNNER for that whole day, in proportion to the lowest balance it
///           held that day. A day's share can be claimed for 7 days after the day ends;
///           whatever is left after that goes to the protocol wallet (sweepExpired).
///
/// @dev    Holder rewards use per-wallet daily checkpoints {day, lowest balance that day,
///         balance at the end of the day} and a running total of eligible balances, so
///         nothing ever loops over holders. Run rewards: the RUNNER server signs an EIP-712
///         message "account has earned `totalEarned` in total"; claim() pays the difference
///         to what was already claimed, limited by the fixed emission schedule (10M/day,
///         halving every 30 days, floor 100k/day) counted from startEmission(). The owner can never take
///         tokens out of the run-reward pool or the holder-reward bucket, and cannot change
///         the tax.
contract RunnerToken {
    string public constant name = "RUNNER";
    string public constant symbol = "RUNNER";
    uint8 public constant decimals = 18;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant REWARDS_ALLOCATION = 800_000_000 ether;
    uint256 public constant LIQUIDITY_ALLOCATION = 100_000_000 ether;
    uint256 public constant TEAM_ALLOCATION = 100_000_000 ether;

    uint256 public constant PROTOCOL_TAX_BPS = 200;   // 2%
    uint256 public constant HOLDER_TAX_BPS = 200;     // 2%
    uint256 public constant MIN_HOLDING = 300_000 ether;
    uint256 public constant CLAIM_WINDOW_DAYS = 7;
    /// Run-reward emission schedule, fixed forever: 10,000,000 RUNNER/day when emission
    /// starts, halving every 30 days, never below 100,000/day (until the pool is empty).
    uint256 public constant EMISSION_START = 10_000_000 ether;
    uint256 public constant HALVING_DAYS = 30;
    uint256 public constant EMISSION_FLOOR = 100_000 ether;
    /// Run-reward payout choice: take it now and 20% is burned, or lock it 7 days for 100%.
    uint256 public constant INSTANT_BURN_BPS = 2_000;
    uint256 public constant LOCK_PERIOD = 7 days;
    uint256 public constant MAX_ACTIVE_LOCKS = 30;
    uint256 private constant BPS = 10_000;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address account,uint256 totalEarned,uint256 deadline)");
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Checkpoint {
        uint32 day;          // UTC day number (timestamp / 1 days)
        uint112 minBalance;  // lowest balance held during `day`
        uint112 endBalance;  // balance after the last change on `day`
    }

    struct Lock {
        uint128 amount;
        uint64 unlockAt;
    }

    struct Day {
        uint256 shares;      // sum of eligible lowest balances for the day
        uint128 rewards;     // holder tax collected during the day
        uint128 paidOut;     // claimed by holders + swept to the protocol
        bool started;
    }

    uint256 public totalSupply;
    address public owner;
    address public protocolWallet;
    address public signer;
    bool public claimsPaused;
    uint256 public emissionStartDay;     // 0 = emission not started yet
    uint256 public totalClaimed;
    uint256 public totalLocked;          // locked run rewards inside this contract
    uint256 public totalBurnedInstant;   // burned by instant claims / early releases

    uint256 public eligibleSupply;       // sum of balances >= MIN_HOLDING of non-excluded wallets
    uint256 public holderRewardsHeld;    // holder tax inside this contract, not yet paid out
    uint256 public nextSweepDay;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public claimed;
    mapping(uint256 => uint256) public claimedOnDay;
    mapping(address => bool) public isPair;
    mapping(address => bool) public excludedFromHolderRewards;
    mapping(address => Checkpoint[]) private _checkpoints;
    mapping(uint256 => Day) private _days;
    mapping(address => mapping(uint256 => bool)) public holderClaimedDay;
    mapping(address => Lock[]) private _locks;      // in unlock order
    mapping(address => uint256) private _lockHead;  // first lock not yet paid out

    uint256 private immutable _cachedChainId;
    bytes32 private immutable _cachedDomainSeparator;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed holder, address indexed spender, uint256 value);
    event Claimed(address indexed account, uint256 amount, uint256 totalEarned, bool instant);
    event RewardsLocked(address indexed account, uint256 amount, uint256 unlockAt);
    event RewardsReleased(address indexed account, uint256 amount);
    event RewardsBurned(address indexed account, uint256 amount);
    event HolderRewardsAdded(uint256 indexed day, uint256 amount);
    event HolderRewardsClaimed(address indexed holder, uint256 amount);
    event HolderRewardsExpired(uint256 indexed day, uint256 amount);
    event PairAdded(address indexed pair);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProtocolWalletChanged(address indexed wallet);
    event SignerChanged(address indexed signer);
    event ClaimsPausedChanged(bool paused);
    event EmissionStarted(uint256 day);

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
    error OnlyRunnerCanClaimInstantly();
    error TooManyLocks();
    error NothingToRelease();
    error NotAContract();
    error AlreadyPair();
    error NotAPool();
    error EmissionNotStarted();
    error AlreadyStarted();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner, address liquidityWallet, address teamWallet) {
        if (initialOwner == address(0) || liquidityWallet == address(0) || teamWallet == address(0)) revert ZeroAddress();
        owner = initialOwner;
        protocolWallet = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
        emit ProtocolWalletChanged(initialOwner);
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();

        excludedFromHolderRewards[address(this)] = true;
        uint256 today = _today();
        nextSweepDay = today;
        _startDay(today);
        _mint(address(this), REWARDS_ALLOCATION, today);
        _mint(liquidityWallet, LIQUIDITY_ALLOCATION, today);
        _mint(teamWallet, TEAM_ALLOCATION, today);
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

    // ----------------------------------------------------------------- holder rewards

    /// @notice Holder rewards `holder` can claim right now (days ended within the last 7 days).
    function holderClaimable(address holder) public view returns (uint256 total) {
        uint256 today = _today();
        uint256 first = today > CLAIM_WINDOW_DAYS ? today - CLAIM_WINDOW_DAYS : 0;
        for (uint256 d = first; d < today; d++) {
            if (!holderClaimedDay[holder][d]) total += _holderShareOf(holder, d);
        }
    }

    /// @notice Claim all holder rewards still inside their 7-day window.
    function claimHolderRewards() external returns (uint256 total) {
        uint256 today = _today();
        uint256 first = today > CLAIM_WINDOW_DAYS ? today - CLAIM_WINDOW_DAYS : 0;
        for (uint256 d = first; d < today; d++) {
            if (holderClaimedDay[msg.sender][d]) continue;
            uint256 amount = _holderShareOf(msg.sender, d);
            if (amount == 0) continue;
            holderClaimedDay[msg.sender][d] = true;
            _days[d].paidOut += uint128(amount);
            total += amount;
        }
        if (total == 0) revert NothingToClaim();
        holderRewardsHeld -= total;
        _move(address(this), msg.sender, total, today);
        emit HolderRewardsClaimed(msg.sender, total);
    }

    /// @notice Send unclaimed holder rewards of expired days (older than 7 days) to the
    ///         protocol wallet. Anyone may call; processes at most `maxDays` days.
    function sweepExpired(uint256 maxDays) external returns (uint256 total) {
        uint256 today = _today();
        uint256 d = nextSweepDay;
        uint256 end = d + maxDays;
        while (d + CLAIM_WINDOW_DAYS < today && d < end) {
            Day storage day = _days[d];
            uint256 left = uint256(day.rewards) - day.paidOut;
            if (left > 0) {
                day.paidOut = day.rewards;
                total += left;
                emit HolderRewardsExpired(d, left);
            }
            d++;
        }
        nextSweepDay = d;
        if (total > 0) {
            holderRewardsHeld -= total;
            _move(address(this), protocolWallet, total, today);
        }
    }

    /// @notice A day's totals: eligible shares, holder tax collected, amount paid out.
    function dayInfo(uint256 day) external view returns (uint256 shares, uint256 rewards, uint256 paidOut) {
        Day storage d = _days[day];
        return (d.shares, d.rewards, d.paidOut);
    }

    /// @notice The balance that counts for `holder` on `day` (0 if under 300,000 or excluded).
    function eligibleBalanceOn(address holder, uint256 day) public view returns (uint256) {
        if (excludedFromHolderRewards[holder]) return 0;
        Checkpoint[] storage cps = _checkpoints[holder];
        uint256 lo = 0;
        uint256 hi = cps.length;
        while (lo < hi) {                       // first checkpoint with day > `day`
            uint256 mid = (lo + hi) / 2;
            if (cps[mid].day > day) hi = mid; else lo = mid + 1;
        }
        if (lo == 0) return 0;
        Checkpoint storage cp = cps[lo - 1];
        return _eligible(cp.day == day ? cp.minBalance : cp.endBalance);
    }

    function currentDay() external view returns (uint256) {
        return _today();
    }

    // ----------------------------------------------------------------- run rewards

    /// @notice RUNNER still waiting in the run-reward pool.
    function rewardsRemaining() public view returns (uint256) {
        return balanceOf[address(this)] - holderRewardsHeld - totalLocked;
    }

    /// @notice How much `account` can claim with a server signature for `totalEarned`.
    function claimable(address account, uint256 totalEarned) external view returns (uint256) {
        uint256 done = claimed[account];
        return totalEarned > done ? totalEarned - done : 0;
    }

    /// @notice Pay `account` its verified run earnings, either
    ///         • instant: 80% now, 20% burned — only the runner can choose this, or
    ///         • locked:  100% after 7 days — anyone may submit this for the runner.
    ///         Any of the runner's locks that have finished are paid out in the same call.
    function claim(address account, uint256 totalEarned, uint256 deadline, uint8 v, bytes32 r, bytes32 s, bool instant) external {
        if (claimsPaused) revert ClaimsPaused();
        if (instant && msg.sender != account) revert OnlyRunnerCanClaimInstantly();
        if (emissionStartDay == 0) revert EmissionNotStarted();
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
        uint256 day = _today();
        if (claimedOnDay[day] + amount > emissionOn(day)) revert DailyCapReached();
        if (rewardsRemaining() < amount) revert PoolEmpty();

        claimed[account] = totalEarned;
        claimedOnDay[day] += amount;
        totalClaimed += amount;
        emit Claimed(account, amount, totalEarned, instant);
        _releaseMatured(account, day);
        if (instant) {
            uint256 burnAmount = amount * INSTANT_BURN_BPS / BPS;
            _move(address(this), account, amount - burnAmount, day);
            _burnRewards(account, burnAmount);
        } else {
            Lock[] storage locks = _locks[account];
            if (locks.length - _lockHead[account] >= MAX_ACTIVE_LOCKS) revert TooManyLocks();
            uint256 unlockAt = block.timestamp + LOCK_PERIOD;
            locks.push(Lock(uint128(amount), uint64(unlockAt)));
            totalLocked += amount;
            emit RewardsLocked(account, amount, unlockAt);
        }
    }

    /// @notice Pay out `account`'s locks that have finished their 7 days (100%). Anyone may call.
    function release(address account) external returns (uint256 amount) {
        amount = _releaseMatured(account, _today());
        if (amount == 0) revert NothingToRelease();
    }

    /// @notice Take all your locked rewards now: finished locks pay 100%, unfinished ones
    ///         pay 80% and 20% is burned.
    function releaseEarly() external returns (uint256 paid) {
        uint256 day = _today();
        Lock[] storage locks = _locks[msg.sender];
        uint256 head = _lockHead[msg.sender];
        uint256 n = locks.length;
        uint256 total;
        uint256 burnAmount;
        for (uint256 i = head; i < n; i++) {
            Lock memory l = locks[i];
            total += l.amount;
            if (l.unlockAt > block.timestamp) burnAmount += uint256(l.amount) * INSTANT_BURN_BPS / BPS;
            delete locks[i];
        }
        if (total == 0) revert NothingToRelease();
        _lockHead[msg.sender] = n;
        totalLocked -= total;
        paid = total - burnAmount;
        _move(address(this), msg.sender, paid, day);
        emit RewardsReleased(msg.sender, paid);
        if (burnAmount > 0) _burnRewards(msg.sender, burnAmount);
    }

    /// @notice `account`'s locked run rewards: still locked, ready to release, next unlock time.
    function locksOf(address account) external view returns (uint256 locked, uint256 unlocked, uint256 nextUnlockAt, uint256 activeLocks) {
        Lock[] storage locks = _locks[account];
        uint256 n = locks.length;
        for (uint256 i = _lockHead[account]; i < n; i++) {
            Lock memory l = locks[i];
            if (l.unlockAt <= block.timestamp) unlocked += l.amount;
            else {
                locked += l.amount;
                if (nextUnlockAt == 0) nextUnlockAt = l.unlockAt;
            }
        }
        activeLocks = n - _lockHead[account];
    }

    /// @notice Most RUNNER the run-reward pool can pay out on `day` (0 before emission starts).
    function emissionOn(uint256 day) public view returns (uint256) {
        uint256 start = emissionStartDay;
        if (start == 0 || day < start) return 0;
        uint256 halvings = (day - start) / HALVING_DAYS;
        uint256 amount = halvings >= 64 ? 0 : EMISSION_START >> halvings;
        return amount > EMISSION_FLOOR ? amount : EMISSION_FLOOR;
    }

    /// @notice Today's run-reward emission and how much of it is still unclaimed.
    function emissionToday() external view returns (uint256 limit, uint256 remaining) {
        uint256 day = _today();
        limit = emissionOn(day);
        uint256 used = claimedOnDay[day];
        remaining = limit > used ? limit - used : 0;
    }

    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _buildDomainSeparator();
    }

    // ----------------------------------------------------------------- owner

    /// @notice Register an exchange pool: trades through it pay the 4% tax, and it gets no
    ///         holder rewards. Pools can only be added, never removed, and must be pool
    ///         contracts that hold RUNNER as token0 or token1 — so a wallet (including a
    ///         smart-contract wallet) can never be taxed or cut out of rewards this way.
    function addPair(address pair) external onlyOwner {
        if (pair.code.length == 0) revert NotAContract();
        if (isPair[pair]) revert AlreadyPair();
        if (_poolToken(pair, 0x0dfe1681) != address(this) && _poolToken(pair, 0xd21220a7) != address(this)) revert NotAPool(); // token0(), token1()
        uint256 today = _today();
        _startDay(today);
        _exclude(pair, today);
        isPair[pair] = true;
        emit PairAdded(pair);
    }

    function setProtocolWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        protocolWallet = wallet;
        emit ProtocolWalletChanged(wallet);
    }

    /// @notice Set the RUNNER server's signing address. Zero disables run-reward claims.
    function setSigner(address newSigner) external onlyOwner {
        signer = newSigner;
        emit SignerChanged(newSigner);
    }

    function setClaimsPaused(bool paused_) external onlyOwner {
        claimsPaused = paused_;
        emit ClaimsPausedChanged(paused_);
    }

    /// @notice Start the run-reward emission schedule today. Can only happen once.
    function startEmission() external onlyOwner {
        if (emissionStartDay != 0) revert AlreadyStarted();
        uint256 today = _today();
        emissionStartDay = today;
        emit EmissionStarted(today);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ----------------------------------------------------------------- internals

    function _today() private view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// Reads token0()/token1() from a pool without trusting it to behave (zero on failure).
    function _poolToken(address pool, bytes4 selector) private view returns (address token) {
        (bool ok, bytes memory ret) = pool.staticcall(abi.encodeWithSelector(selector));
        if (ok && ret.length == 32) token = abi.decode(ret, (address));
    }

    function _eligible(uint256 balance) private pure returns (uint256) {
        return balance >= MIN_HOLDING ? balance : 0;
    }

    /// First call on a day freezes that day's share total at the eligible supply, which is
    /// unchanged since the day began because every balance change calls this first.
    function _startDay(uint256 today) private {
        Day storage d = _days[today];
        if (!d.started) {
            d.started = true;
            d.shares = eligibleSupply;
        }
    }

    function _holderShareOf(address holder, uint256 day) private view returns (uint256) {
        Day storage d = _days[day];
        if (d.rewards == 0 || d.shares == 0) return 0;
        uint256 bal = eligibleBalanceOn(holder, day);
        return bal == 0 ? 0 : uint256(d.rewards) * bal / d.shares;
    }

    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 today = _today();
        _startDay(today);
        if ((isPair[from] || isPair[to]) && from != address(this) && to != address(this)) {
            uint256 protocolCut = value * PROTOCOL_TAX_BPS / BPS;
            uint256 holderCut = value * HOLDER_TAX_BPS / BPS;
            _move(from, to, value - protocolCut - holderCut, today);
            if (protocolCut > 0) _move(from, protocolWallet, protocolCut, today);
            if (holderCut > 0) {
                _move(from, address(this), holderCut, today);
                holderRewardsHeld += holderCut;
                _days[today].rewards += uint128(holderCut);
                emit HolderRewardsAdded(today, holderCut);
            }
        } else {
            _move(from, to, value, today);
        }
    }

    /// Moves tokens without tax and keeps holder checkpoints up to date.
    function _move(address from, address to, uint256 value, uint256 today) private {
        uint256 fromBal = balanceOf[from];
        if (fromBal < value) revert InsufficientBalance();
        unchecked { balanceOf[from] = fromBal - value; }
        _track(from, fromBal, fromBal - value, today);
        uint256 toBal = balanceOf[to];
        balanceOf[to] = toBal + value;
        _track(to, toBal, toBal + value, today);
        emit Transfer(from, to, value);
    }

    /// Updates the eligible supply, the wallet's checkpoint for today and today's share total.
    function _track(address account, uint256 oldBal, uint256 newBal, uint256 today) private {
        _startDay(today); // before eligibleSupply changes, on every path (claims included)
        if (excludedFromHolderRewards[account] || oldBal == newBal) return;
        eligibleSupply = eligibleSupply - _eligible(oldBal) + _eligible(newBal);

        Checkpoint[] storage cps = _checkpoints[account];
        uint256 n = cps.length;
        uint256 oldMin;
        uint256 newMin;
        if (n > 0 && cps[n - 1].day == today) {
            Checkpoint storage cp = cps[n - 1];
            oldMin = cp.minBalance;
            newMin = newBal < oldMin ? newBal : oldMin;
            cp.minBalance = uint112(newMin);
            cp.endBalance = uint112(newBal);
        } else {
            oldMin = oldBal;                        // balance held since the day began
            newMin = newBal < oldBal ? newBal : oldBal;
            cps.push(Checkpoint(uint32(today), uint112(newMin), uint112(newBal)));
        }
        uint256 drop = _eligible(oldMin) - _eligible(newMin);
        if (drop > 0) _days[today].shares -= drop;
    }

    /// Removes a wallet from holder rewards from today on.
    function _exclude(address account, uint256 today) private {
        if (excludedFromHolderRewards[account]) return;
        uint256 bal = balanceOf[account];
        Checkpoint[] storage cps = _checkpoints[account];
        uint256 n = cps.length;
        uint256 todayCounted = n > 0 && cps[n - 1].day == today ? cps[n - 1].minBalance : bal;
        _days[today].shares -= _eligible(todayCounted);
        eligibleSupply -= _eligible(bal);
        excludedFromHolderRewards[account] = true;
    }

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

    function _mint(address to, uint256 value, uint256 today) private {
        totalSupply += value;
        uint256 bal = balanceOf[to];
        balanceOf[to] = bal + value;
        _track(to, bal, bal + value, today);
        emit Transfer(address(0), to, value);
    }

    /// Pays out finished locks (they form a prefix: every lock lasts the same 7 days).
    function _releaseMatured(address account, uint256 day) private returns (uint256 amount) {
        Lock[] storage locks = _locks[account];
        uint256 head = _lockHead[account];
        uint256 n = locks.length;
        while (head < n && locks[head].unlockAt <= block.timestamp) {
            amount += locks[head].amount;
            delete locks[head];
            head++;
        }
        if (amount == 0) return 0;
        _lockHead[account] = head;
        totalLocked -= amount;
        _move(address(this), account, amount, day);
        emit RewardsReleased(account, amount);
    }

    /// Burns run rewards from the pool held by this contract (instant claims, early releases).
    function _burnRewards(address account, uint256 amount) private {
        if (amount == 0) return;
        totalBurnedInstant += amount;
        _burn(address(this), amount);
        emit RewardsBurned(account, amount);
    }

    function _burn(address from, uint256 value) private {
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        uint256 today = _today();
        _startDay(today);
        unchecked {
            balanceOf[from] = bal - value;
            totalSupply -= value;
        }
        _track(from, bal, bal - value, today);
        emit Transfer(from, address(0), value);
    }
}
