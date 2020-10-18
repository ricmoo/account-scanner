Account Scanner
===============

**Note:** Experimental work-in-progress

This is a simple example of how to create a multi-call contract
to aggregate data into fewer JSON-RPC calls.

This example currently uses:

- two `getLogs` to fetch all tokens from **addr** and **to** addr
- one call to our multicall contract, `getInfos` for metadata and state

From this, it returns:

- Every ERC-20 token transfer history event sent to or received from **addr**
- Every ERC-721 token transfer history event sent to or received from **addr**
- The ERC-20 balance for **addr** of each token
- The list of owned ERC-721 tokens for **addr**
- The number of decimals for ERC-20 token
- The name and symbol for each ERC-20 and ERC-721 token
- The block number this is all consistent to (which can be passed in to future calls; @TODO)

Notes
-----

Since there are external calls to unknown token contracts, additional sanitization is
performed on each call and the gas limit is restricted to prevent malicious tokens
from crashing us.

To do
-----

- Slice up requests and responses in the event the history or list of tokens is too long
- Allow a fromBlock to reduce the cost and effort of backends to maintain an already updated list
- The token URIs returned seem to follow various formats, so some effort is required to normalize the actual dereferenced URL to use for token images
- Wrap this up in a nicer library to make it easy for everyone to use

License
-------

MIT License
