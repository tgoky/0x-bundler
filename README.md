# Ethereum Bundler

automating token lunchies.


- i created a file called config.json, where i passed in certain parameters
-desiredBuyAmounts
-liquidityAmount
-tokenAddress = 0x54cec23B02E7B9EB2901C3307F652450e0810de7 ( the token im testing with )
-desiredTokenAmount
-minTokenAmount
-amountTokenMin
-amountETHMin
-minEthAmount
-recipient
-ethAmount
-fundingAmount
-sniperWallets == array of snipping wallets
- wethAddress  = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9 (sepolia)
- fixedBuyAmount
- sniperBuyAmount

- so probably u declare this params and maybe hide it in .gitignore cause of PK and stuff 

  the main file is in scripts/bundle.ts

  - the bundle should be able to approve uniswap router , add liquidity , disperse funds to various snip wallets, then the wallets buy the token
 
  - running the script would help you identify or learn more about the bundle
 
 



create a file called config.json , below should be/ or is the content of the config.json
