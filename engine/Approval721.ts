import { BigNumber, Contract } from "ethers";
import { isAddress } from "ethers/lib/utils";
import { TransactionRequest } from "@ethersproject/abstract-provider";
import { Base } from "./Base";

// ERC-20 ABI includes the approve method
const ERC721_ABI = [{
  "inputs": [{"internalType": "address", "name": "spender", "type": "address"}, {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
  }],
  "name": "approve",
  "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
  "stateMutability": "nonpayable",
  "type": "function"
}];

export class Approval721 extends Base {
  private _spender: string;
  private _contractAddresses: string[];
  private _amount: BigNumber; // Amount to approve

  constructor(spender: string, contractAddresses: string[], amount: BigNumber) {
    super();
    if (!isAddress(spender)) throw new Error("Bad Address");
    this._spender = spender;
    this._contractAddresses = contractAddresses;
    this._amount = amount;
  }

  async description(): Promise<string> {
    return `Giving ${this._spender} approval for: ${this._contractAddresses.join(", ")} with amount ${this._amount.toString()}`;
  }

  getSponsoredTransactions(): Promise<Array<TransactionRequest>> {
    return Promise.all(this._contractAddresses.map(async (contractAddress) => {
      const erc20Contract = new Contract(contractAddress, ERC721_ABI);
      return {
        ...(await erc20Contract.populateTransaction.approve(this._spender, this._amount)),
        gasPrice: BigNumber.from(0),
      };
    }));
  }
}
