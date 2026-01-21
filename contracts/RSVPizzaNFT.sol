// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RSVPizzaNFT
 * @dev ERC721 NFT contract for RSV.Pizza event attendance proof
 *
 * Features:
 * - One NFT per wallet per event (eventId-based tracking)
 * - Minter can mint on behalf of attendees (gasless for users)
 * - Owner can update metadata (e.g., if event details change)
 * - Supports mintOrUpdate pattern for idempotent minting
 * - Fully transferable (standard ERC721)
 * - Collection metadata via contractURI
 *
 * Deployment:
 * 1. Deploy to Base mainnet using Foundry, Hardhat, or Remix
 * 2. Transfer ownership to minter wallet or keep as deployer
 * 3. Set contract address in environment variables
 */
contract RSVPizzaNFT is ERC721, Ownable {
    uint256 private _tokenIdCounter;

    // Token ID for each (address, eventId) combination
    // keccak256(address, eventId) => tokenId
    mapping(bytes32 => uint256) private _eventAttendanceToTokenId;

    // Track if (address, eventId) has been minted
    mapping(bytes32 => bool) private _hasMinted;

    // Token URI storage
    mapping(uint256 => string) private _tokenURIs;

    // Store eventId for each token (for querying)
    mapping(uint256 => string) private _tokenEventIds;

    // Contract-level metadata URI (for OpenSea collection info)
    string private _contractMetadataURI;

    // Events
    event TokenMinted(address indexed to, string indexed eventId, uint256 indexed tokenId, string uri);
    event TokenUpdated(uint256 indexed tokenId, string newUri);
    event ContractURIUpdated(string newUri);

    constructor() ERC721("RSV.Pizza", "RSVP") Ownable(msg.sender) {
        // Token IDs start at 1
        _tokenIdCounter = 1;
    }

    /**
     * @dev Get the key for address + eventId combination
     */
    function _getAttendanceKey(address attendee, string memory eventId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(attendee, eventId));
    }

    /**
     * @dev Mints a new NFT or updates existing one for the address + event
     * @param to The address to mint/update the NFT for
     * @param eventId The event identifier (party ID)
     * @param uri The metadata URI for the NFT
     * @return The token ID
     */
    function mintOrUpdate(address to, string memory eventId, string memory uri) public onlyOwner returns (uint256) {
        require(to != address(0), "Cannot mint to zero address");
        require(bytes(eventId).length > 0, "Event ID required");

        bytes32 key = _getAttendanceKey(to, eventId);

        if (_hasMinted[key]) {
            // Update existing token
            uint256 existingTokenId = _eventAttendanceToTokenId[key];
            _tokenURIs[existingTokenId] = uri;
            emit TokenUpdated(existingTokenId, uri);
            return existingTokenId;
        } else {
            // Mint new token
            uint256 tokenId = _tokenIdCounter;
            _tokenIdCounter++;

            _safeMint(to, tokenId);
            _tokenURIs[tokenId] = uri;
            _tokenEventIds[tokenId] = eventId;
            _eventAttendanceToTokenId[key] = tokenId;
            _hasMinted[key] = true;

            emit TokenMinted(to, eventId, tokenId, uri);
            return tokenId;
        }
    }

    /**
     * @dev Check if an address has a token for a specific event
     * @param owner The address to check
     * @param eventId The event identifier
     * @return True if the address has a token for this event
     */
    function hasToken(address owner, string memory eventId) public view returns (bool) {
        bytes32 key = _getAttendanceKey(owner, eventId);
        return _hasMinted[key];
    }

    /**
     * @dev Get the token ID for an address + event combination
     * @param owner The address to query
     * @param eventId The event identifier
     * @return The token ID (reverts if no token)
     */
    function tokenOfOwner(address owner, string memory eventId) public view returns (uint256) {
        bytes32 key = _getAttendanceKey(owner, eventId);
        require(_hasMinted[key], "No token for this address and event");
        return _eventAttendanceToTokenId[key];
    }

    /**
     * @dev Get the event ID for a token
     * @param tokenId The token ID to query
     * @return The event ID
     */
    function eventOfToken(uint256 tokenId) public view returns (string memory) {
        _requireOwned(tokenId);
        return _tokenEventIds[tokenId];
    }

    /**
     * @dev Returns the tokenURI for a given token
     * @param tokenId The token ID to query
     * @return The metadata URI for the token
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    /**
     * @dev Returns the current token count (total supply)
     * @return The total number of tokens minted
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter - 1;
    }

    /**
     * @dev Update token URI for an existing token (owner only)
     * @param tokenId The token ID to update
     * @param uri The new metadata URI
     */
    function updateTokenURI(uint256 tokenId, string memory uri) public onlyOwner {
        _requireOwned(tokenId);
        _tokenURIs[tokenId] = uri;
        emit TokenUpdated(tokenId, uri);
    }

    /**
     * @dev Returns the contract-level metadata URI (for OpenSea collection info)
     * @return The contract metadata URI
     */
    function contractURI() public view returns (string memory) {
        return _contractMetadataURI;
    }

    /**
     * @dev Set the contract-level metadata URI (owner only)
     * @param uri The new contract metadata URI
     */
    function setContractURI(string memory uri) public onlyOwner {
        _contractMetadataURI = uri;
        emit ContractURIUpdated(uri);
    }

}
