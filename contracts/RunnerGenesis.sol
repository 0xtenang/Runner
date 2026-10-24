// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title  RUNNER Genesis
 * @notice 9,999 sneaker NFTs for the RUNNER run-to-earn app (runearn.fun).
 *
 *  • Open sale, no reveal: buyers choose a token id (1–9999) and pay its price.
 *    Rarity — and therefore price — is derived from the id with the same
 *    formula the app uses (js/collection.js rarityOf):
 *        Common 0.005 ETH · Uncommon 0.015 · Rare 0.04 · Epic 0.1
 *    Mint payments go straight to the treasury (the dev wallet).
 *  • 5% creator royalty (ERC-2981) to the royalty receiver (the dev wallet).
 *  • ERC-721C compatible (ICreatorToken): the owner can attach a transfer
 *    validator — e.g. OpenSea's StrictAuthorizedTransferSecurityRegistry via
 *    OpenSea Studio → Creator earnings — so the royalty is ENFORCED on
 *    OpenSea and other compliant marketplaces.
 *  • OpenSea collection page: `owner()` (the dev wallet) can manage it, and
 *    `contractURI()` (ERC-7572) points to the collection metadata
 *    (description, image, website, socials).
 *
 *  Self-contained ERC-721 (+ metadata, + per-owner enumeration) so it
 *  compiles as a single file without external libraries.
 */
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

interface ITransferValidator {
    // Called with a normal (state-changing) call: some registries record or
    // consume authorizations while validating.
    function validateTransfer(address caller, address from, address to, uint256 tokenId) external;
}

contract RunnerGenesis {
    // ------------------------------------------------------------ constants
    string public constant name = "RUNNER Genesis";
    string public constant symbol = "RGEN";
    uint256 public constant MAX_SUPPLY = 9999;
    /// @notice Creator royalty in basis points (500 = 5%). Fixed for every token.
    uint96 public constant ROYALTY_BPS = 500;

    // ------------------------------------------------------------ storage
    address public owner;
    address public pendingOwner;          // two-step handover: set by the owner, accepted by the new owner
    address payable public treasury;
    address public royaltyReceiver;
    address private _transferValidator;
    bool public paused;
    uint256 public totalSupply;
    string private _baseTokenURI;
    string private _contractURI;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(address => uint256[]) private _ownedTokens;
    mapping(uint256 => uint256) private _ownedIndex;

    // ------------------------------------------------------------ events / errors
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed holder, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed holder, address indexed operator, bool approved);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event TreasuryChanged(address indexed treasury);
    event RoyaltyReceiverChanged(address indexed receiver);
    event PausedChanged(bool paused);
    event BaseURIChanged(string baseURI);
    event ContractURIUpdated();                                              // ERC-7572
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);       // ERC-4906
    event TransferValidatorUpdated(address oldValidator, address newValidator); // ERC-721C

    error NotOwner();
    error InvalidToken();
    error AlreadyMinted();
    error WrongPrice();
    error MintingPaused();
    error NotAuthorized();
    error ZeroAddress();
    error PaymentFailed();
    error UnsafeRecipient();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /**
     * @param initialOwner   Gets admin rights and OpenSea collection control (the dev wallet).
     * @param treasury_      Receives mint payments (the dev wallet).
     * @param royaltyReceiver_ Receives the 5% royalty (the dev wallet).
     */
    constructor(
        address initialOwner,
        address payable treasury_,
        address royaltyReceiver_,
        string memory baseTokenURI,
        string memory contractURI_
    ) {
        if (initialOwner == address(0) || treasury_ == address(0) || royaltyReceiver_ == address(0)) revert ZeroAddress();
        owner = initialOwner;
        treasury = treasury_;
        royaltyReceiver = royaltyReceiver_;
        _baseTokenURI = baseTokenURI;
        _contractURI = contractURI_;
        emit OwnershipTransferred(address(0), initialOwner);
        emit TreasuryChanged(treasury_);
        emit RoyaltyReceiverChanged(royaltyReceiver_);
    }

    // ------------------------------------------------------------ rarity & price
    /// @return 0 Common, 1 Uncommon, 2 Rare, 3 Epic (2% epic, 8% rare, 20% uncommon, 70% common).
    function rarityOf(uint256 tokenId) public pure returns (uint8) {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert InvalidToken();
        uint256 x = (tokenId * 2654435761 + 24301) & 0xffffffff;
        x ^= (x << 13) & 0xffffffff;
        x ^= x >> 17;
        x ^= (x << 5) & 0xffffffff;
        uint256 r = x % 10000;
        if (r < 200) return 3;
        if (r < 1000) return 2;
        if (r < 3000) return 1;
        return 0;
    }

    function priceOf(uint256 tokenId) public pure returns (uint256) {
        uint8 r = rarityOf(tokenId);
        if (r == 3) return 0.1 ether;
        if (r == 2) return 0.04 ether;
        if (r == 1) return 0.015 ether;
        return 0.005 ether;
    }

    // ------------------------------------------------------------ minting
    /// @notice Buy a specific sneaker by paying exactly its price.
    function mint(uint256 tokenId) external payable {
        if (paused) revert MintingPaused();
        if (msg.value != priceOf(tokenId)) revert WrongPrice(); // also validates the id
        if (_owners[tokenId] != address(0)) revert AlreadyMinted();
        _mint(msg.sender, tokenId);
        _checkReceiver(msg.sender, address(0), msg.sender, tokenId, ""); // contracts must accept ERC-721s
        (bool ok, ) = treasury.call{value: msg.value}("");
        if (!ok) revert PaymentFailed();
    }

    // ------------------------------------------------------------ views for the app
    function exists(uint256 tokenId) public view returns (bool) {
        return _owners[tokenId] != address(0);
    }

    /// @notice Which of `ids` are already minted (for showing availability).
    function mintedBatch(uint256[] calldata ids) external view returns (bool[] memory minted) {
        minted = new bool[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) minted[i] = _owners[ids[i]] != address(0);
    }

    /// @notice All token ids held by `holder`.
    function tokensOfOwner(address holder) external view returns (uint256[] memory) {
        return _ownedTokens[holder];
    }

    // ------------------------------------------------------------ royalties (ERC-2981)
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount) {
        return (royaltyReceiver, (salePrice * ROYALTY_BPS) / 10000);
    }

    // ------------------------------------------------------------ ERC-721C (ICreatorToken)
    function getTransferValidator() external view returns (address) {
        return _transferValidator;
    }

    /// @return functionSignature validateTransfer(address,address,address,uint256)
    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        return (ITransferValidator.validateTransfer.selector, false);
    }

    /// @notice Attach (or remove with address(0)) a transfer validator to enforce royalties.
    function setTransferValidator(address validator) external onlyOwner {
        emit TransferValidatorUpdated(_transferValidator, validator);
        _transferValidator = validator;
    }

    // ------------------------------------------------------------ metadata
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return string.concat(_baseTokenURI, _toString(tokenId));
    }

    /// @notice Collection-level metadata for marketplaces (ERC-7572 / OpenSea).
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    // ------------------------------------------------------------ ERC-721
    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return _balances[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address o = _owners[tokenId];
        if (o == address(0)) revert InvalidToken();
        return o;
    }

    function approve(address to, uint256 tokenId) external {
        address o = ownerOf(tokenId);
        if (msg.sender != o && !_operatorApprovals[o][msg.sender]) revert NotAuthorized();
        _tokenApprovals[tokenId] = to;
        emit Approval(o, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address holder, address operator) external view returns (bool) {
        return _operatorApprovals[holder][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        // Royalty-enforcement hook first: every check below reads state after it, so even a
        // validator that calls back into this contract can't make a stale check pass.
        address validator = _transferValidator;
        if (validator != address(0)) ITransferValidator(validator).validateTransfer(msg.sender, from, to, tokenId);
        address o = ownerOf(tokenId);
        if (o != from) revert NotAuthorized();
        if (msg.sender != o && _tokenApprovals[tokenId] != msg.sender && !_operatorApprovals[o][msg.sender]) revert NotAuthorized();
        if (to == address(0)) revert ZeroAddress();
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        _checkReceiver(msg.sender, from, to, tokenId, data);
    }

    /// A contract recipient must answer onERC721Received, or it could never move the token.
    function _checkReceiver(address operator, address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length > 0) {
            try IERC721Receiver(to).onERC721Received(operator, from, tokenId, data) returns (bytes4 ret) {
                if (ret != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient();
            } catch {
                revert UnsafeRecipient();
            }
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7  // ERC-165
            || interfaceId == 0x80ac58cd  // ERC-721
            || interfaceId == 0x5b5e139f  // ERC-721 Metadata
            || interfaceId == 0x2a55205a  // ERC-2981 royalties
            || interfaceId == 0x49064906  // ERC-4906 metadata updates
            || interfaceId == 0xad0d7f6c; // ICreatorToken (ERC-721C)
    }

    // ------------------------------------------------------------ admin
    function setTreasury(address payable newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryChanged(newTreasury);
    }

    function setRoyaltyReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        royaltyReceiver = newReceiver;
        emit RoyaltyReceiverChanged(newReceiver);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedChanged(value);
    }

    function setBaseURI(string calldata baseTokenURI) external onlyOwner {
        _baseTokenURI = baseTokenURI;
        emit BaseURIChanged(baseTokenURI);
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    function setContractURI(string calldata contractURI_) external onlyOwner {
        _contractURI = contractURI_;
        emit ContractURIUpdated();
    }

    /// @notice Step 1 of 2: propose a new owner. Nothing changes until they call
    ///         acceptOwnership(), so a mistyped address can't take the collection.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of 2: the proposed owner takes over.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotAuthorized();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Recover ETH sent to the contract by mistake (mint payments never stay here).
    function withdraw() external onlyOwner {
        (bool ok, ) = treasury.call{value: address(this).balance}("");
        if (!ok) revert PaymentFailed();
    }

    // ------------------------------------------------------------ internals
    function _mint(address to, uint256 tokenId) private {
        _owners[tokenId] = to;
        _balances[to] += 1;
        _addToOwner(to, tokenId);
        totalSupply += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) private {
        delete _tokenApprovals[tokenId];
        _removeFromOwner(from, tokenId);
        _addToOwner(to, tokenId);
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _addToOwner(address to, uint256 tokenId) private {
        _ownedIndex[tokenId] = _ownedTokens[to].length;
        _ownedTokens[to].push(tokenId);
    }

    function _removeFromOwner(address from, uint256 tokenId) private {
        uint256[] storage list = _ownedTokens[from];
        uint256 i = _ownedIndex[tokenId];
        uint256 last = list[list.length - 1];
        list[i] = last;
        _ownedIndex[last] = i;
        list.pop();
        delete _ownedIndex[tokenId];
    }

    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) len++;
        bytes memory b = new bytes(len);
        while (v != 0) {
            b[--len] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(b);
    }
}
