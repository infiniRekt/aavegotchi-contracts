/* global ethers hre */
/* eslint prefer-const: "off" */

import { Signer } from "@ethersproject/abstract-signer";
import { Contract } from "@ethersproject/contracts";
//@ts-ignore
import { ethers, network } from "hardhat";

const { LedgerSigner } = require("@ethersproject/hardware-wallets");

const { sendToMultisig } = require("../libraries/multisig/multisig.js");

function getSelectors(contract: Contract) {
  const signatures = Object.keys(contract.interface.functions);
  const selectors = signatures.reduce((acc: string[], val: string) => {
    if (val !== "init(bytes)") {
      acc.push(contract.interface.getSighash(val));
    }
    return acc;
  }, []);
  return selectors;
}

function getSelector(func: string) {
  const abiInterface = new ethers.utils.Interface([func]);
  return abiInterface.getSighash(ethers.utils.Fragment.from(func));
}

export async function upgradePetOperator() {
  const diamondAddress = "0x86935F11C86623deC8a25696E1C19a8659CbF95d";
  let signer: Signer;
  let owner = await (
    await ethers.getContractAt("OwnershipFacet", diamondAddress)
  ).owner();
  const testing = ["hardhat", "localhost"].includes(network.name);
  if (testing) {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [owner],
    });
    signer = await ethers.getSigner(owner);
  } else if (network.name === "matic") {
    signer = new LedgerSigner(ethers.provider);
  } else {
    throw Error("Incorrect network selected");
  }

  const Facet = await ethers.getContractFactory(
    "contracts/Aavegotchi/facets/AavegotchiFacet.sol:AavegotchiFacet"
  );
  let facet = await Facet.deploy();
  await facet.deployed();
  console.log("Deployed facet:", facet.address);

  const newFuncs = [
    getSelector(
      "function isPetOperatorForAll(address _owner, address _operator) external view returns (bool approved_)"
    ),
    getSelector(
      "function setPetOperatorForAll(address _operator, bool _approved) external"
    ),
  ];
  let existingFuncs = getSelectors(facet);
  for (const selector of newFuncs) {
    if (!existingFuncs.includes(selector)) {
      throw Error(`Selector ${selector} not found`);
    }
  }
  existingFuncs = existingFuncs.filter(
    (selector: string) => !newFuncs.includes(selector)
  );

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

  const cut = [
    {
      facetAddress: facet.address,
      action: FacetCutAction.Add,
      functionSelectors: newFuncs,
    },
    {
      facetAddress: facet.address,
      action: FacetCutAction.Replace,
      functionSelectors: existingFuncs,
    },
  ];

  /*for (const facetName of [
    "contracts/Aavegotchi/facets/AavegotchiFacet.sol:AavegotchiFacet",
    "contracts/Aavegotchi/facets/BridgeFacet.sol:BridgeFacet",
    "ERC721MarketplaceFacet",
  ]) {
    console.log("Deploying", facetName);
    const Facet = await ethers.getContractFactory(facetName);
    let facet = await Facet.deploy();
    await facet.deployed();
    console.log("Deployed facet:", facet.address);
    cut.push({
      facetAddress: facet.address,
      action: FacetCutAction.Replace,
      functionSelectors: getSelectors(facet),
    });
  }
  */
  console.log(cut);
  const diamondCut = await ethers.getContractAt(
    "IDiamondCut",
    diamondAddress,
    signer
  );
  let tx;
  let receipt;

  if (testing) {
    console.log("Diamond cut");
    tx = await diamondCut.diamondCut(cut, ethers.constants.AddressZero, "0x", {
      gasLimit: 8000000,
    });
    console.log("Diamond cut tx:", tx.hash);
    receipt = await tx.wait();
    if (!receipt.status) {
      throw Error(`Diamond upgrade failed: ${tx.hash}`);
    }
    console.log("Completed diamond cut: ", tx.hash);
  } else {
    console.log("Diamond cut");
    tx = await diamondCut.populateTransaction.diamondCut(
      cut,
      ethers.constants.AddressZero,
      "0x",
      { gasLimit: 800000 }
    );
    await sendToMultisig(process.env.DIAMOND_UPGRADER, signer, tx);
  }
  return diamondAddress;
}

if (require.main === module) {
  upgradePetOperator()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

// exports.upgradePetOperator = main;