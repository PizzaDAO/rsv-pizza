// soppressata-72251: master crypto-industry taxonomy (TS port of the curated
// stracciatella-72140 dictionary). Maps an email domain -> { company, bucket }
// so one classifier powers per-partner BizDev report lenses at /api/bizdev.
// Local-only, curated, no network. Counts are a FLOOR — most guests use freemail.
// `(inferred)` = keyword match on an unknown domain (confidence: 'medium').
//
// NOTE: this is intentionally separate from `emailDomains.ts` (which only
// derives org domains for the consolidated report). They MUST NOT diverge on
// the personal-email exclusion semantics — see FREEMAIL/INTERNAL below, which
// is the superset of `emailDomains.PERSONAL_EMAIL_PROVIDERS`. If you add a
// freemail provider in one place, mirror it here (and vice-versa).

export const TAXONOMY_VERSION = 1;

export type IndustryConfidence = 'high' | 'medium';

export interface DomainClassification {
  company: string;
  bucket: string;
  confidence: IndustryConfidence;
}

// id -> label
export const BUCKETS: Record<string, string> = {
  'exchanges': 'Exchanges',
  'chains-l2-infra': 'Chains, L2s & infrastructure',
  'wallets-custody': 'Wallets & custody',
  'defi': 'DeFi protocols',
  'stablecoins-payments': 'Stablecoins & payments',
  'funds-and-vc': 'Funds & VC',
  'asset-managers': 'Asset managers / ETF issuers',
  'mining': 'Bitcoin mining',
  'dats': 'Digital Asset Treasuries',
  'bitcoin-native': 'Bitcoin-native protocols & companies',
  'identity-naming': 'Identity & naming',
  'developer-tooling': 'Developer tooling & data',
  'security-audit': 'Security & audit',
  'advocacy-policy': 'Advocacy & policy',
  'adtech-publishers-privacy': 'Ad-tech, publishers & privacy',
  'public-goods-regen': 'Public goods & regen',
  'media': 'Media',
  'gaming-nft': 'Gaming & NFT',
  'daos-communities': 'DAOs & communities',
};

// Exact registrable-domain -> { company, bucket }. HIGH confidence.
export const DOMAIN_MAP: Record<string, { company: string; bucket: string }> = {
  // ===== exchanges =====
  'coinbase.com': { company: 'Coinbase', bucket: 'exchanges' },
  'binance.com': { company: 'Binance', bucket: 'exchanges' },
  'kraken.com': { company: 'Kraken', bucket: 'exchanges' },
  'bybit.com': { company: 'Bybit', bucket: 'exchanges' },
  'bitvavo.com': { company: 'Bitvavo', bucket: 'exchanges' },
  'okx.com': { company: 'OKX', bucket: 'exchanges' },
  'gemini.com': { company: 'Gemini', bucket: 'exchanges' },
  'crypto.com': { company: 'Crypto.com', bucket: 'exchanges' },
  'kucoin.com': { company: 'KuCoin', bucket: 'exchanges' },
  'bitstamp.net': { company: 'Bitstamp', bucket: 'exchanges' },
  'bitfinex.com': { company: 'Bitfinex', bucket: 'exchanges' },
  'gate.io': { company: 'Gate.io', bucket: 'exchanges' },
  'mexc.com': { company: 'MEXC', bucket: 'exchanges' },
  'bitget.com': { company: 'Bitget', bucket: 'exchanges' },
  'luno.com': { company: 'Luno', bucket: 'exchanges' },
  'bitso.com': { company: 'Bitso', bucket: 'exchanges' },
  'ripio.com': { company: 'Ripio', bucket: 'exchanges' },
  'buenbit.com': { company: 'Buenbit', bucket: 'exchanges' },
  'mercadobitcoin.com.br': { company: 'Mercado Bitcoin', bucket: 'exchanges' },

  // ===== chains, L2s & infra =====
  'ethereum.org': { company: 'Ethereum Foundation', bucket: 'chains-l2-infra' },
  'optimism.io': { company: 'Optimism', bucket: 'chains-l2-infra' },
  'arbitrum.foundation': { company: 'Arbitrum', bucket: 'chains-l2-infra' },
  'offchainlabs.com': { company: 'Offchain Labs (Arbitrum)', bucket: 'chains-l2-infra' },
  'polygon.technology': { company: 'Polygon', bucket: 'chains-l2-infra' },
  'matterlabs.dev': { company: 'Matter Labs (zkSync)', bucket: 'chains-l2-infra' },
  'base.org': { company: 'Base', bucket: 'chains-l2-infra' },
  'consensys.net': { company: 'Consensys', bucket: 'chains-l2-infra' },
  'consensys.io': { company: 'Consensys', bucket: 'chains-l2-infra' },
  'infura.io': { company: 'Infura', bucket: 'chains-l2-infra' },
  'alchemy.com': { company: 'Alchemy', bucket: 'chains-l2-infra' },
  'quicknode.com': { company: 'QuickNode', bucket: 'chains-l2-infra' },
  'chainlinklabs.com': { company: 'Chainlink Labs', bucket: 'chains-l2-infra' },
  'thegraph.com': { company: 'The Graph', bucket: 'chains-l2-infra' },
  'avalabs.org': { company: 'Ava Labs (Avalanche)', bucket: 'chains-l2-infra' },
  'solana.org': { company: 'Solana Foundation', bucket: 'chains-l2-infra' },
  'solana.com': { company: 'Solana', bucket: 'chains-l2-infra' },
  'near.org': { company: 'NEAR', bucket: 'chains-l2-infra' },
  'aptoslabs.com': { company: 'Aptos', bucket: 'chains-l2-infra' },
  'mystenlabs.com': { company: 'Mysten Labs (Sui)', bucket: 'chains-l2-infra' },
  'celo.org': { company: 'Celo', bucket: 'chains-l2-infra' },
  'confluxnetwork.org': { company: 'Conflux', bucket: 'chains-l2-infra' },
  'scroll.io': { company: 'Scroll', bucket: 'chains-l2-infra' },
  'starkware.co': { company: 'StarkWare', bucket: 'chains-l2-infra' },

  // ===== wallets & custody =====
  'metamask.io': { company: 'MetaMask', bucket: 'wallets-custody' },
  'ledger.com': { company: 'Ledger', bucket: 'wallets-custody' },
  'ledger.fr': { company: 'Ledger', bucket: 'wallets-custody' },
  'tangem.com': { company: 'Tangem', bucket: 'wallets-custody' },
  'trezor.io': { company: 'Trezor', bucket: 'wallets-custody' },
  'safe.global': { company: 'Safe', bucket: 'wallets-custody' },
  'fireblocks.com': { company: 'Fireblocks', bucket: 'wallets-custody' },
  'rainbow.me': { company: 'Rainbow', bucket: 'wallets-custody' },
  'argent.xyz': { company: 'Argent', bucket: 'wallets-custody' },
  'zerion.io': { company: 'Zerion', bucket: 'wallets-custody' },
  'phantom.app': { company: 'Phantom', bucket: 'wallets-custody' },
  'trustwallet.com': { company: 'Trust Wallet', bucket: 'wallets-custody' },
  'bitgo.com': { company: 'BitGo', bucket: 'wallets-custody' },
  'copper.co': { company: 'Copper', bucket: 'wallets-custody' },
  'anchorage.com': { company: 'Anchorage Digital', bucket: 'wallets-custody' },
  'reown.com': { company: 'Reown (WalletConnect)', bucket: 'wallets-custody' },

  // ===== DeFi =====
  'uniswap.org': { company: 'Uniswap', bucket: 'defi' },
  'aave.com': { company: 'Aave', bucket: 'defi' },
  'makerdao.com': { company: 'MakerDAO / Sky', bucket: 'defi' },
  'sky.money': { company: 'Sky (MakerDAO)', bucket: 'defi' },
  'compound.finance': { company: 'Compound', bucket: 'defi' },
  'curve.fi': { company: 'Curve', bucket: 'defi' },
  'lido.fi': { company: 'Lido', bucket: 'defi' },
  'rocketpool.net': { company: 'Rocket Pool', bucket: 'defi' },
  '1inch.io': { company: '1inch', bucket: 'defi' },
  'gmx.io': { company: 'GMX', bucket: 'defi' },
  'synthetix.io': { company: 'Synthetix', bucket: 'defi' },
  'dydx.exchange': { company: 'dYdX', bucket: 'defi' },
  'ondo.finance': { company: 'Ondo Finance', bucket: 'defi' },
  'pendle.finance': { company: 'Pendle', bucket: 'defi' },

  // ===== stablecoins & payments =====
  'tether.to': { company: 'Tether', bucket: 'stablecoins-payments' },
  'circle.com': { company: 'Circle (USDC)', bucket: 'stablecoins-payments' },
  'paxos.com': { company: 'Paxos', bucket: 'stablecoins-payments' },
  'moonpay.com': { company: 'MoonPay', bucket: 'stablecoins-payments' },
  'ramp.network': { company: 'Ramp', bucket: 'stablecoins-payments' },
  'transak.com': { company: 'Transak', bucket: 'stablecoins-payments' },
  'stripe.com': { company: 'Stripe', bucket: 'stablecoins-payments' },
  'bridge.xyz': { company: 'Bridge', bucket: 'stablecoins-payments' },
  'request.finance': { company: 'Request Finance', bucket: 'stablecoins-payments' },
  'takenos.com': { company: 'Takenos', bucket: 'stablecoins-payments' },
  'lemon.me': { company: 'Lemon', bucket: 'stablecoins-payments' },

  // ===== identity & naming =====
  'ens.domains': { company: 'ENS', bucket: 'identity-naming' },
  'unstoppabledomains.com': { company: 'Unstoppable Domains', bucket: 'identity-naming' },
  'lens.xyz': { company: 'Lens', bucket: 'identity-naming' },
  'farcaster.xyz': { company: 'Farcaster', bucket: 'identity-naming' },
  'merklemanufactory.com': { company: 'Farcaster (Merkle Manufactory)', bucket: 'identity-naming' },
  'spruceid.com': { company: 'SpruceID', bucket: 'identity-naming' },

  // ===== developer tooling & data =====
  'tenderly.co': { company: 'Tenderly', bucket: 'developer-tooling' },
  'openzeppelin.com': { company: 'OpenZeppelin', bucket: 'developer-tooling' },
  'thirdweb.com': { company: 'thirdweb', bucket: 'developer-tooling' },
  'moralis.io': { company: 'Moralis', bucket: 'developer-tooling' },
  'dune.com': { company: 'Dune', bucket: 'developer-tooling' },
  'flipsidecrypto.xyz': { company: 'Flipside Crypto', bucket: 'developer-tooling' },
  'etherscan.io': { company: 'Etherscan', bucket: 'developer-tooling' },
  'blockscout.com': { company: 'Blockscout', bucket: 'developer-tooling' },
  'nomicfoundation.org': { company: 'Nomic Foundation (Hardhat)', bucket: 'developer-tooling' },

  // ===== security & audit =====
  'trailofbits.com': { company: 'Trail of Bits', bucket: 'security-audit' },
  'certik.com': { company: 'CertiK', bucket: 'security-audit' },
  'quantstamp.com': { company: 'Quantstamp', bucket: 'security-audit' },
  'halborn.com': { company: 'Halborn', bucket: 'security-audit' },
  'hacken.io': { company: 'Hacken', bucket: 'security-audit' },
  'slowmist.com': { company: 'SlowMist', bucket: 'security-audit' },

  // ===== advocacy & policy =====
  'standwithcrypto.org': { company: 'Stand With Crypto', bucket: 'advocacy-policy' },
  'coincenter.org': { company: 'Coin Center', bucket: 'advocacy-policy' },
  'theblockchainassociation.org': { company: 'Blockchain Association', bucket: 'advocacy-policy' },
  'digitalchamber.org': { company: 'Digital Chamber', bucket: 'advocacy-policy' },
  'defieducationfund.org': { company: 'DeFi Education Fund', bucket: 'advocacy-policy' },

  // ===== ad-tech, publishers & privacy =====
  'brave.com': { company: 'Brave', bucket: 'adtech-publishers-privacy' },
  'basicattentiontoken.org': { company: 'Basic Attention Token', bucket: 'adtech-publishers-privacy' },

  // ===== public goods & regen =====
  'octant.build': { company: 'Octant', bucket: 'public-goods-regen' },
  'golem.network': { company: 'Golem Foundation', bucket: 'public-goods-regen' },
  'gitcoin.co': { company: 'Gitcoin', bucket: 'public-goods-regen' },
  'giveth.io': { company: 'Giveth', bucket: 'public-goods-regen' },

  // ===== media =====
  'coindesk.com': { company: 'CoinDesk', bucket: 'media' },
  'cointelegraph.com': { company: 'Cointelegraph', bucket: 'media' },
  'theblock.co': { company: 'The Block', bucket: 'media' },
  'decrypt.co': { company: 'Decrypt', bucket: 'media' },
  'bankless.com': { company: 'Bankless', bucket: 'media' },

  // ===== gaming & NFT =====
  'opensea.io': { company: 'OpenSea', bucket: 'gaming-nft' },
  'dapperlabs.com': { company: 'Dapper Labs', bucket: 'gaming-nft' },
  'immutable.com': { company: 'Immutable', bucket: 'gaming-nft' },
  'yuga.com': { company: 'Yuga Labs', bucket: 'gaming-nft' },
  'animocabrands.com': { company: 'Animoca Brands', bucket: 'gaming-nft' },
  'skymavis.com': { company: 'Sky Mavis (Axie)', bucket: 'gaming-nft' },
  'magiceden.io': { company: 'Magic Eden', bucket: 'gaming-nft' },

  // ===== DAOs & communities =====
  'ownthedoge.com': { company: 'Own The Doge', bucket: 'daos-communities' },
  'aragon.org': { company: 'Aragon', bucket: 'daos-communities' },

  // ===== funds & VC (carried from Rootstock + promotions) =====
  'a16z.com': { company: 'a16z', bucket: 'funds-and-vc' },
  'a16zcrypto.com': { company: 'a16z crypto', bucket: 'funds-and-vc' },
  'paradigm.xyz': { company: 'Paradigm', bucket: 'funds-and-vc' },
  'panteracapital.com': { company: 'Pantera Capital', bucket: 'funds-and-vc' },
  'polychain.capital': { company: 'Polychain Capital', bucket: 'funds-and-vc' },
  'multicoin.capital': { company: 'Multicoin Capital', bucket: 'funds-and-vc' },
  'electriccapital.com': { company: 'Electric Capital', bucket: 'funds-and-vc' },
  'dragonfly.xyz': { company: 'Dragonfly', bucket: 'funds-and-vc' },
  'variant.fund': { company: 'Variant', bucket: 'funds-and-vc' },
  'framework.ventures': { company: 'Framework Ventures', bucket: 'funds-and-vc' },
  'galaxy.com': { company: 'Galaxy', bucket: 'funds-and-vc' },
  'castleisland.vc': { company: 'Castle Island Ventures', bucket: 'funds-and-vc' },
  'stillmark.com': { company: 'Stillmark', bucket: 'funds-and-vc' },
  'ten31.vc': { company: 'Ten31', bucket: 'funds-and-vc' },
  'trammellvp.com': { company: 'Trammell Venture Partners', bucket: 'funds-and-vc' },
  'fulgur.ventures': { company: 'Fulgur Ventures', bucket: 'funds-and-vc' },
  'brevanhoward.com': { company: 'Brevan Howard', bucket: 'funds-and-vc' },
  'thielcapital.com': { company: 'Thiel Capital', bucket: 'funds-and-vc' },
  'iconiqcapital.com': { company: 'Iconiq Capital', bucket: 'funds-and-vc' },
  'outlierventures.io': { company: 'Outlier Ventures', bucket: 'funds-and-vc' },
  'arringtoncapital.com': { company: 'Arrington Capital', bucket: 'funds-and-vc' },
  'defiance.capital': { company: 'DeFiance Capital', bucket: 'funds-and-vc' },
  'shima.capital': { company: 'Shima Capital', bucket: 'funds-and-vc' },
  'whitestarcapital.com': { company: 'White Star Capital', bucket: 'funds-and-vc' },
  'targetglobal.vc': { company: 'Target Global', bucket: 'funds-and-vc' },
  'draper.vc': { company: 'Draper', bucket: 'funds-and-vc' },
  'bloccelerate.vc': { company: 'Bloccelerate VC', bucket: 'funds-and-vc' },
  'fracton.ventures': { company: 'Fracton Ventures', bucket: 'funds-and-vc' },
  'redbeard.ventures': { company: 'Redbeard Ventures', bucket: 'funds-and-vc' },
  'blockchange.vc': { company: 'Blockchange Ventures', bucket: 'funds-and-vc' },
  'cmcc.vc': { company: 'CMCC Global', bucket: 'funds-and-vc' },
  'ngc.fund': { company: 'NGC Ventures', bucket: 'funds-and-vc' },
  'cyphercapital.com': { company: 'Cypher Capital', bucket: 'funds-and-vc' },
  'cosimo.fund': { company: 'Cosimo Ventures', bucket: 'funds-and-vc' },
  'whitelioncapital.com': { company: 'Whitelion Capital', bucket: 'funds-and-vc' },
  'polymorphic.capital': { company: 'Polymorphic Capital', bucket: 'funds-and-vc' },
  'blockonventures.com': { company: 'BlockOn Ventures', bucket: 'funds-and-vc' },
  'kosmos.vc': { company: 'Kosmos Ventures', bucket: 'funds-and-vc' },
  'gft.vc': { company: 'GFT Ventures', bucket: 'funds-and-vc' },
  'matchstick.vc': { company: 'Matchstick Ventures', bucket: 'funds-and-vc' },
  'onebit.ventures': { company: 'OneBit Ventures', bucket: 'funds-and-vc' },
  'onigiri.vc': { company: 'Onigiri Capital', bucket: 'funds-and-vc' },
  'trive.vc': { company: 'Trive Ventures', bucket: 'funds-and-vc' },

  // ===== asset managers (carried) =====
  'blackrock.com': { company: 'BlackRock', bucket: 'asset-managers' },
  'fidelity.com': { company: 'Fidelity', bucket: 'asset-managers' },
  'fidelitydigitalassets.com': { company: 'Fidelity Digital Assets', bucket: 'asset-managers' },
  'vaneck.com': { company: 'VanEck', bucket: 'asset-managers' },
  'grayscale.com': { company: 'Grayscale', bucket: 'asset-managers' },
  'bitwiseinvestments.com': { company: 'Bitwise', bucket: 'asset-managers' },
  'bitwise.com': { company: 'Bitwise', bucket: 'asset-managers' },
  'ark-invest.com': { company: 'ARK Invest', bucket: 'asset-managers' },
  'franklintempleton.com': { company: 'Franklin Templeton', bucket: 'asset-managers' },
  'invesco.com': { company: 'Invesco', bucket: 'asset-managers' },
  'wisdomtree.com': { company: 'WisdomTree', bucket: 'asset-managers' },
  '21shares.com': { company: '21Shares', bucket: 'asset-managers' },
  'coinshares.com': { company: 'CoinShares', bucket: 'asset-managers' },
  'hashdex.com': { company: 'Hashdex', bucket: 'asset-managers' },
  'nydig.com': { company: 'NYDIG', bucket: 'asset-managers' },

  // ===== mining (carried) =====
  'mara.com': { company: 'Marathon Digital (MARA)', bucket: 'mining' },
  'marathondh.com': { company: 'Marathon Digital (MARA)', bucket: 'mining' },
  'riotplatforms.com': { company: 'Riot Platforms', bucket: 'mining' },
  'corescientific.com': { company: 'Core Scientific', bucket: 'mining' },
  'cleanspark.com': { company: 'CleanSpark', bucket: 'mining' },
  'terawulf.com': { company: 'TeraWulf', bucket: 'mining' },
  'ciphermining.com': { company: 'Cipher Mining', bucket: 'mining' },
  'bitfarms.com': { company: 'Bitfarms', bucket: 'mining' },
  'hut8.com': { company: 'Hut 8', bucket: 'mining' },
  'iren.com': { company: 'IREN (Iris Energy)', bucket: 'mining' },
  'irisenergy.co': { company: 'IREN (Iris Energy)', bucket: 'mining' },
  'bitdeer.com': { company: 'Bitdeer', bucket: 'mining' },
  'foundrydigital.com': { company: 'Foundry', bucket: 'mining' },
  'luxor.tech': { company: 'Luxor Technology', bucket: 'mining' },
  'braiins.com': { company: 'Braiins / Slush Pool', bucket: 'mining' },
  'compassmining.io': { company: 'Compass Mining', bucket: 'mining' },

  // ===== DATs (carried) =====
  'strategy.com': { company: 'Strategy (MicroStrategy)', bucket: 'dats' },
  'microstrategy.com': { company: 'Strategy (MicroStrategy)', bucket: 'dats' },
  'metaplanet.jp': { company: 'Metaplanet', bucket: 'dats' },
  'semlerscientific.com': { company: 'Semler Scientific', bucket: 'dats' },
  'block.xyz': { company: 'Block, Inc.', bucket: 'dats' },

  // ===== bitcoin-native (carried) =====
  'rootstock.io': { company: 'Rootstock', bucket: 'bitcoin-native' },
  'rsk.co': { company: 'Rootstock (RSK)', bucket: 'bitcoin-native' },
  'iovlabs.org': { company: 'IOV Labs / RIF', bucket: 'bitcoin-native' },
  'blockstream.com': { company: 'Blockstream', bucket: 'bitcoin-native' },
  'lightning.engineering': { company: 'Lightning Labs', bucket: 'bitcoin-native' },
  'spiral.xyz': { company: 'Spiral', bucket: 'bitcoin-native' },
  'chaincode.com': { company: 'Chaincode Labs', bucket: 'bitcoin-native' },
  'brink.dev': { company: 'Brink', bucket: 'bitcoin-native' },
  'strike.me': { company: 'Strike', bucket: 'bitcoin-native' },
  'river.com': { company: 'River', bucket: 'bitcoin-native' },
  'swanbitcoin.com': { company: 'Swan Bitcoin', bucket: 'bitcoin-native' },
  'unchained.com': { company: 'Unchained', bucket: 'bitcoin-native' },
  'casa.io': { company: 'Casa', bucket: 'bitcoin-native' },
  'voltage.cloud': { company: 'Voltage', bucket: 'bitcoin-native' },
  'hiro.so': { company: 'Hiro / Stacks', bucket: 'bitcoin-native' },
  'babylonlabs.io': { company: 'Babylon', bucket: 'bitcoin-native' },
  'hrf.org': { company: 'Human Rights Foundation', bucket: 'bitcoin-native' },
  'opensats.org': { company: 'OpenSats', bucket: 'bitcoin-native' },
  'bitcoinmagazine.com': { company: 'Bitcoin Magazine', bucket: 'bitcoin-native' },
  'mimo.capital': { company: 'Mimo (Rootstock)', bucket: 'bitcoin-native' },
};

// Substring/regex fallback for UNKNOWN domains. MEDIUM confidence. First match
// wins, so order most-specific first. Negative lookarounds kill known false
// positives.
export const KEYWORD_RULES: { pattern: RegExp; bucket: string }[] = [
  { pattern: /mining|miner(?!va)|hashrate|hashpower/i, bucket: 'mining' },
  { pattern: /asset[\s._-]?(management|mgmt)|advisors/i, bucket: 'asset-managers' },
  { pattern: /treasury/i, bucket: 'dats' },
  { pattern: /\bwallet/i, bucket: 'wallets-custody' },
  { pattern: /bitcoin|lightning|\bbtc\b|\bsats\b/i, bucket: 'bitcoin-native' },
  { pattern: /(?<!ad)ventures?|capital|partners(?!hip)|family[\s._-]?office|endowment|\.vc$|\.fund$/i,
    bucket: 'funds-and-vc' },
];

// Personal / free webmail — names no company. Never classify.
export const FREEMAIL: Set<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'pm.me', 'aol.com', 'gmx.com', 'gmx.de', 'mail.com', 'zoho.com', 'yandex.com', 'fastmail.com',
  'hey.com', 'duck.com', 'tutanota.com', 'qq.com', '163.com', '126.com', 'foxmail.com',
  'naver.com', 'hotmail.co.uk', 'yahoo.co.uk', 'yahoo.co.jp', 'web.de', 't-online.de',
  'orange.fr', 'free.fr', 'hotmail.fr', 'yahoo.fr', 'gmail.con', 'outlook.es', 'hotmail.es',
  'seznam.cz', 'mail.ru', 'list.ru', 'bk.ru', 'inbox.ru', 'rambler.ru', 'ya.ru',
  'privaterelay.appleid.com', 'passmail.net', 'passinbox.com', 'simplelogin.com', 'relay.firefox.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net', 'bellsouth.net',
  'charter.net', 'earthlink.net', 'roadrunner.com', 'optonline.net', 'frontier.com',
  'gmx.net', 'freenet.de', 'arcor.de', 'laposte.net', 'sfr.fr', 'wanadoo.fr', 'bbox.fr',
  'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl', 'abv.bg', 'libero.it', 'virgilio.it', 'tin.it',
  'alice.it', 'terra.com.br', 'uol.com.br', 'bol.com.br', 'hotmail.com.br', 'yahoo.com.br',
  'yahoo.com.ar', 'yahoo.com.mx', 'yahoo.es', 'yahoo.de', 'yahoo.it', 'yahoo.ca', 'yahoo.in',
  'yahoo.com.ph', 'yahoo.gr', 'rediffmail.com', 'sina.com', 'sohu.com', 'aliyun.com',
  'outlook.fr', 'outlook.de', 'outlook.com.br', 'outlook.it', 'hotmail.de', 'hotmail.it',
  'hotmail.com.ar', 'hotmail.com.mx', 'live.fr', 'live.com.mx', 'live.com.ar', 'live.co.uk',
]);

// Non-company junk (test fixtures + PizzaDAO's own).
export const INTERNAL: Set<string> = new Set([
  'test.com', 'test.test', 'example.com', 'example.org', 'rarepizzas.com', 'pizzadao.com',
]);

// Readable names for keyword-inferred domains we couldn't verify (stay MEDIUM /
// `(inferred)`). Carried from the Rootstock report; extend freely.
export const DISPLAY_NAMES: Record<string, string> = {
  'elkcapitalmarkets.com': 'Elk Capital Markets', 'penrosepartners.com': 'Penrose Partners',
  'silverminecapital.com': 'Silvermine Capital', 'allo.capital': 'Allo Capital',
  'arcanum.capital': 'Arcanum Capital', 'brd.capital': 'BRD Capital',
  'digitalfamilyoffice.io': 'Digital Family Office', 'funders.vc': 'Funders VC',
  'iftcfamilyoffice.com': 'IFTC Family Office', 'lightnodeventures.com': 'Lightnode Ventures',
  'newchiccapital.com': 'Newchic Capital', 'smartpay.com.vc': 'SmartPay',
  '2punkscapital.com': '2Punks Capital', '5dcapital.org': '5D Capital', 'alchemist.fund': 'Alchemist',
  'allenfamilyoffice.com': 'Allen Family Office', 'arbalestpartners.com': 'Arbalest Partners',
  'armanhammercapital.com': 'Arman Hammer Capital', 'basalcapital.xyz': 'Basal Capital',
  'baytechcapital.com': 'Baytech Capital', 'beyondventures.hk': 'Beyond Ventures',
  'quantixcapital.xyz': 'Quantix Capital', 'blockcrestcapital.com': 'Blockcrest Capital',
  'blockstreet.capital': 'Blockstreet Capital', 'boltscapital.com': 'Bolts Capital',
  'brownricecapital.com': 'Brown Rice Capital', 'btcfrontier.fund': 'BTC Frontier Fund',
  'buzzbridge.capital': 'Buzzbridge Capital', 'calocapital.io': 'Calo Capital',
  'capitaltao.com': 'Capital Tao', 'cmventure.net': 'CM Venture', 'cofounder.fund': 'Cofounder Fund',
  'cryptobytecapital.com': 'CryptoByte Capital', 'dhvp.vc': 'DHVP', 'dira.capital': 'Dira Capital',
  'dmtech.vc': 'DM Tech Ventures', 'dwfventuresllc.com': 'DWF Ventures', 'edge-capital-fund.com': 'Edge Capital',
  'eh.capital': 'EH Capital', 'exitliquiditycapital.com': 'Exit Liquidity Capital',
  'forasventures.com': 'Foras Ventures', 'gain.ventures': 'Gain Ventures',
  'haliburtoncapitalgroup.com': 'Haliburton Capital Group', 'inception.capital': 'Inception Capital',
  'izwanpartners.com': 'Izwan Partners', 'keyplayercapital.com': 'Key Player Capital',
  'kitpartners.asia': 'KIT Partners', 'lecrypcapital.com': 'Lecryp Capital',
  'montoyacapital.org': 'Montoya Capital', 'morgancapital.org': 'Morgan Capital',
  'mossyventures.com': 'Mossy Ventures', 'mpipartners.com': 'MPI Partners', 'nakama.fund': 'Nakama Fund',
  'neotechcapital.com': 'Neotech Capital', 'odysseyventures.llc': 'Odyssey Ventures',
  'omair.vc': 'Omair Ventures', 'orbitventures.com': 'Orbit Ventures', 'palcapital.com': 'PAL Capital',
  'pentathlon.vc': 'Pentathlon Ventures', 'protaventures.com': 'Prota Ventures', 'rayo.capital': 'Rayo Capital',
  'rivendell.capital': 'Rivendell Capital', 'rspartners.my': 'RS Partners', 'sdv.vc': 'SDV Ventures',
  'sigone.capital': 'SigOne Capital', 'silvercircle.vc': 'Silver Circle Ventures',
  'solanuscapital.com': 'Solanus Capital', 'specialist.vc': 'Specialist VC', 'strt.vc': 'STRT Ventures',
  'tanzent.capital': 'Tanzent Capital', 'topmarketcapital.co.bw': 'Top Market Capital',
  'truescopeventures.com': 'Truescope Ventures', 'tulipa.capital': 'Tulipa Capital',
  'vacacapital.com': 'Vaca Capital', 'vcventures.co.in': 'VC Ventures', 'veloqpartners.com': 'Veloq Partners',
  'x10xcapital.com': 'X10X Capital', 'xgcapitalstrategies.com': 'XG Capital Strategies',
  'y10k.capital': 'Y10K Capital', 'yellowumbrellaventures.com': 'Yellow Umbrella Ventures',
  'zerogcapital.com': 'ZeroG Capital',
  'alchemistminers.com': 'Alchemist Miners', 'ordinalminers.com': 'Ordinal Miners',
  'solminer.io': 'SolMiner', 'wildrosemining.com': 'Wild Rose Mining',
  'avataradvisors.com': 'Avatar Advisors', 'futuretechadvisors.com': 'FutureTech Advisors',
  'matrix-advisors.com': 'Matrix Advisors', 'northsoundadvisors.com': 'Northsound Advisors',
  'redpointadvisors.com': 'Redpoint Advisors', 'americabitcoinatm.com': 'America Bitcoin ATM',
  'aureobitcoin.com': 'Aureo Bitcoin', 'bigbackbitcoin.com': 'Big Back Bitcoin',
  'bitcoin.ar': 'Bitcoin Argentina', 'bitcoinbay.ca': 'Bitcoin Bay', 'bitcoinbrisbane.com.au': 'Bitcoin Brisbane',
  'bitcoinbuilders.xyz': 'Bitcoin Builders', 'bitcoindominicana.com': 'Bitcoin Dominicana',
  'bitcoinertalent.com': 'Bitcoiner Talent', 'bitcoinindiatour.com': 'Bitcoin India Tour',
  'lightning.news': 'Lightning News', 'mandebitcoin.com': 'Mande Bitcoin', 'thebitcoinmint.com': 'The Bitcoin Mint',
};

/** Classify an email domain. Returns { company, bucket, confidence } or null. */
export function classifyDomain(rawDomain: string | null | undefined): DomainClassification | null {
  if (!rawDomain) return null;
  const domain = String(rawDomain).trim().toLowerCase().replace(/\.$/, '');
  if (!domain || !domain.includes('.')) return null;
  if (FREEMAIL.has(domain) || INTERNAL.has(domain)) return null;

  if (DOMAIN_MAP[domain]) return { ...DOMAIN_MAP[domain], confidence: 'high' };
  for (const mapped of Object.keys(DOMAIN_MAP)) {
    if (domain.endsWith('.' + mapped)) return { ...DOMAIN_MAP[mapped], confidence: 'high' };
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(domain)) {
      return { company: DISPLAY_NAMES[domain] || domain, bucket: rule.bucket, confidence: 'medium' };
    }
  }
  return null;
}
