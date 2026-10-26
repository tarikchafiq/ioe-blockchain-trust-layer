const { expect } = require("chai");
const { ethers } = require("hardhat");
describe("Probe validation (control case)", () => {
  it("the same re-entrancy probe DOES drain a deliberately vulnerable contract", async () => {
    const [a, victim] = await ethers.getSigners();
    const bank = await (await ethers.getContractFactory("VulnerableBank")).deploy();
    await bank.connect(victim).deposit({ value: 3n * 10n ** 18n });
    const att = await (await ethers.getContractFactory("BankAttacker")).deploy(await bank.getAddress());
    await att.go({ value: 10n ** 18n });
    expect(await ethers.provider.getBalance(await att.getAddress())).to.equal(4n * 10n ** 18n);
  });
});
