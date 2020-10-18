const { ethers } = require("ethers");

const provider = new ethers.providers.InfuraProvider();

const abi = [
    "function getInfo(address[] erc20s, address[] erc721s, uint256[] counts, uint256[] erc721TokenIds) view returns (uint256 balance, uint256 blockNumber, tuple(bytes name, bytes symbol, uint256 decimals, uint256 balance)[] erc20Infos, tuple(bytes name, bytes symbol)[] erc721Infos, tuple(uint256 owner, bytes tokenUri)[] erc721TokenInfos)"
]

const contractAddress = "0xEDaDe4c1191312abA34BB98951Ad21c290b282D3";

const contract = new ethers.Contract(contractAddress, abi, provider);

function getDataAddress(data) {
    const Prefix = "0x000000000000000000000000";
    if (data.substring(0, Prefix.length) !== Prefix) {
        console.log("bad topic address: " + data);
        return null;
    }
    return ethers.utils.getAddress(ethers.utils.hexDataSlice(data, 12));
}

function getAddress(data) {
    return getDataAddress(ethers.utils.hexZeroPad(data, 32));
}

function getString(data) {
    if (data === "0x") { return null; }

    try {
        if (ethers.utils.hexDataLength(data) === 32) {
            return ethers.utils.parseBytes32String(data);
        }
        return ethers.utils.toUtf8String(data);
    } catch (error) {
        console.log({ error, data });
    }
    return null
}

async function getTokenInfo(tokenUri) {
    const info = await ethers.utils.fetchJson(tokenUri);
    return {
        name: info.name,
        imageUrl: info.image,
        description: info.description
    };
}

async function getInfo(provider, address) {

    const waiters = [];

    const result = {
        address: address,
        lastUpdatedBlockNumber: -1,
        name: null,
        balance: -1,
        transactionCount: -1,
        erc721Tokens: { },
        erc20Tokens: { },
        errors: [ ]
    };

    const logs = await ethers.utils.resolveProperties({
        from: provider.getLogs({ fromBlock: 0, toBlock: "latest", topics: [
            ethers.utils.id("Transfer(address,address,uint256)"),
            ethers.utils.hexZeroPad(address, 32)
        ] }),
        to: provider.getLogs({ fromBlock: 0, toBlock: "latest", topics: [
            ethers.utils.id("Transfer(address,address,uint256)"),
            null,
            ethers.utils.hexZeroPad(address, 32)
        ] }),
    });

    ["to", "from"].forEach((key) => {
        logs[key].forEach((log) => {
            const dataLength = ethers.utils.hexDataLength(log.data);
            if (dataLength === 32 && log.topics.length === 3) {
                const token = log.address;
                if (!result.erc20Tokens[token]) {
                    result.erc20Tokens[token] = {
                        name: null,
                        symbol: null,
                        decimals: -1,
                        balance: null,
                        blockNumber: -1,
                        history: [ ]
                    };
                }

                result.erc20Tokens[token].history.push({
                    from: getDataAddress(log.topics[1]),
                    to: getDataAddress(log.topics[2]),
                    value: ethers.BigNumber.from(log.data).toString(),
                    blockNumber: log.blockNumber,
                    blockHash: log.blockHash,
                    transaction: log.transactionHash
                });

            } else if (dataLength === 0 && log.topics.length === 4) {
                const token = log.address;
                if (!result.erc721Tokens[token]) {
                    result.erc721Tokens[token] = {
                        name: null,
                        symbol: null,
                        tokens: [ ],
                        blockNumber: -1,
                        history: [ ]
                    };
                }

                result.erc721Tokens[token].history.push({
                    from: getDataAddress(log.topics[1]),
                    to: getDataAddress(log.topics[2]),
                    tokenId: ethers.BigNumber.from(log.topics[3]).toHexString(),
                    blockNumber: log.blockNumber,
                    blockHash: log.blockHash,
                    transaction: log.transactionHash
                });

            } else {
                console.log("WEIRD  =========");
                console.dir(log, { depth: null });
            }
        });
    });

    [ "erc20Tokens", "erc721Tokens" ].forEach((key) => {
        const tokens = result[key];
        Object.keys(tokens).forEach((token) => {
            tokens[token].history.sort((a, b) => {
                return a.blockNumber - b.blockNumber;
            });
        });
    });

    // The ERC-20 query parameters
    const erc20Tokens = Object.keys(result.erc20Tokens);
    erc20Tokens.sort();

    // The ERC-721 query parameters
    let erc721Tokens = Object.keys(result.erc721Tokens)
    const counts = [ ];
    const erc721TokenIds = [ ];
    erc721Tokens.sort();
    erc721Tokens.forEach((token) => {
        const tokenIds = { };
        const history = result.erc721Tokens[token].history;
        history.forEach((history) => {
            if (history.to === address) {
                tokenIds[history.tokenId] = true;
            } else if (history.from === address) {
                delete tokenIds[history.tokenId];
            }
        });

        const checkTokenIds = Object.keys(tokenIds);
        counts.push(checkTokenIds.length);
        checkTokenIds.forEach((tokenId) => { erc721TokenIds.push(tokenId); });
    });


    // Query our contract
    const accountState = await contract.getInfo(erc20Tokens, erc721Tokens, counts, erc721TokenIds, {
        from: address
    });

    // Fill in balance, transaction count and block number
    result.balance = accountState.balance.toString();
    result.blockNumber = accountState.blockNumber.toNumber();
    waiters.push(provider.getTransactionCount(address).then((transactionCount) => {
        result.transactionCount = transactionCount;
    }, (error) => {
        result.errors.push({
            operation: "getTransactionCount",
            error: error.message
        });
    }));

    // Fill in the ERC-20 data
    erc20Tokens.forEach((token, index) => {
        result.erc20Tokens[token].blockNumber = accountState.blockNumber.toNumber();

        const tokenInfo = accountState.erc20Infos[index];
        result.erc20Tokens[token].name = getString(tokenInfo.name);
        result.erc20Tokens[token].symbol = getString(tokenInfo.symbol);
        result.erc20Tokens[token].decimals = tokenInfo.decimals.toNumber();
        result.erc20Tokens[token].balance = tokenInfo.balance.toString();
    });


    // Fill in the ERC-721 data
    let k = 0;
    accountState.erc721Infos.forEach((info, index) => {
        const token = erc721Tokens[index];

        result.erc721Tokens[token].blockNumber = accountState.blockNumber.toNumber();

        result.erc721Tokens[token].name = getString(info.name);
        result.erc721Tokens[token].symbol = getString(info.symbol);

        // Fill in owned tokens
        for (let j = 0; j < counts[index]; j++) {
            const tokenInfo = accountState.erc721TokenInfos[k];
            if (getAddress(tokenInfo.owner.toHexString()) === address) {
                const info = {
                    tokenId: erc721TokenIds[k],
                    tokenUri: getString(tokenInfo.tokenUri)
                };
                result.erc721Tokens[token].tokens.push(info);
                /*
                waiters.push(getTokenInfo(info.tokenUri).then((details) => {
                    info.tokenImageUrl = details.imageUrl;
                    info.tokenName = details.name;
                    info.tokenDescription = details.description
                }, (error) => {
                    //info.tokenInfoError = error.message;
                }));
                */
            }
            k++;
        }
    });

    await Promise.all(waiters);

    return result;
}

(async function() {
    const address = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
    //const address = "0x06B5955A67D827CDF91823E3bB8F069e6c89c1D6";   // ricmoo.firefly.eth <=>
    //const address = "0xf770358c6F29FAA38186E49c149C87968775B228";  // ricmoo.eth <=>
    const result = await getInfo(provider, address);
    console.dir(result, { depth: null });
})();
