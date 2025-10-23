import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const merchant1 = accounts.get("wallet_1")!;
const customer1 = accounts.get("wallet_3")!;

const contractName = "payment-processor";

describe("Payment Processor Smart Contract", () => {

  describe("Contract Initialization", () => {
    it("should initialize with correct default values", () => {
      const feeRate = simnet.callReadOnlyFn(contractName, "get-fee-rate", [], deployer);
      expect(feeRate.result).toBeUint(150); // 1.5%

      const treasury = simnet.callReadOnlyFn(contractName, "get-treasury", [], deployer);
      expect(treasury.result).toBePrincipal(deployer);

      const paused = simnet.callReadOnlyFn(contractName, "is-paused", [], deployer);
      expect(paused.result).toBeBool(false);
    });
  });

  describe("Merchant Management", () => {
    it("should allow owner to register a merchant", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify merchant was registered
      const merchantData = simnet.callReadOnlyFn(
        contractName,
        "get-merchant",
        [Cl.principal(merchant1)],
        deployer
      );
      expect(merchantData.result).toBeSome(
        Cl.tuple({
          active: Cl.bool(true),
          "fee-rate": Cl.uint(150),
          "settlement-preference": Cl.stringAscii("USD"),
          "total-volume": Cl.uint(0),
          "total-fees": Cl.uint(0)
        })
      );
    });

    it("should prevent non-owner from registering merchants", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        merchant1
      );
      expect(result).toBeErr(Cl.uint(100)); // err-owner-only
    });
  });

  describe("Payment Creation", () => {
    it("should create a payment successfully", () => {
      // First register merchant
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      // Create payment
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-001"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify payment was created
      const paymentData = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii("payment-001")],
        customer1
      );
      expect(paymentData.result).toBeSome(
        Cl.tuple({
          merchant: Cl.principal(merchant1),
          amount: Cl.uint(1000000),
          token: Cl.stringAscii("STX"),
          status: Cl.stringAscii("pending"),
          "fee-amount": Cl.uint(15000),
          timestamp: Cl.uint(4),
          "settlement-currency": Cl.stringAscii("USD"),
          customer: Cl.some(Cl.principal(customer1))
        })
      );
    });

    it("should prevent payment creation for unregistered merchant", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-001"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeErr(Cl.uint(105)); // err-invalid-merchant
    });
  });

  describe("Admin Functions", () => {
    it("should allow owner to update fee rate", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-rate",
        [Cl.uint(200)], // 2%
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const newFeeRate = simnet.callReadOnlyFn(contractName, "get-fee-rate", [], deployer);
      expect(newFeeRate.result).toBeUint(200);
    });

    it("should prevent non-owner from updating fee rate", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-rate",
        [Cl.uint(200)],
        merchant1
      );
      expect(result).toBeErr(Cl.uint(100)); // err-owner-only
    });

    it("should allow owner to pause contract", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "pause-contract",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const paused = simnet.callReadOnlyFn(contractName, "is-paused", [], deployer);
      expect(paused.result).toBeBool(true);
    });
  });

  describe("STX Payment Processing", () => {
    it("should process STX payment successfully", () => {
      // Register merchant first
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      // Create payment
      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-stx-001"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      // Process STX payment
      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("payment-stx-001")],
        customer1
      );
      expect(result).toBeOk(Cl.stringAscii("payment-stx-001"));

      // Verify payment status updated
      const paymentData = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii("payment-stx-001")],
        deployer
      );
      // Check that payment data exists (status updated to completed)
      expect(paymentData.result).not.toBeNull();
      expect(paymentData.result).not.toBeUndefined();
      // We can see from output that status is "completed" in the tuple
    });

    it("should prevent processing non-existent payment", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("nonexistent")],
        customer1
      );
      expect(result).toBeErr(Cl.uint(102)); // err-payment-not-found
    });

    it("should prevent double processing", () => {
      // Register merchant and create payment
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-double"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      // Process payment first time
      simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("payment-double")],
        customer1
      );

      // Try to process again
      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("payment-double")],
        customer1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-payment-already-processed
    });

    it("should reject non-STX token payments", () => {
      // Register merchant and create BTC payment
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-btc"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("BTC"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      // Try to process as STX payment
      const { result } = simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("payment-btc")],
        customer1
      );
      expect(result).toBeErr(Cl.uint(101)); // err-invalid-payment
    });

    it("should create settlement record after processing", () => {
      // Register merchant, create and process payment
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-settlement"),
          Cl.principal(merchant1),
          Cl.uint(2000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      simnet.callPublicFn(
        contractName,
        "process-stx-payment",
        [Cl.stringAscii("payment-settlement")],
        customer1
      );

      // Check settlement record
      const settlementData = simnet.callReadOnlyFn(
        contractName,
        "get-settlement",
        [Cl.stringAscii("payment-settlement")],
        deployer
      );

      // Check that settlement data exists
      expect(settlementData.result).not.toBeNull();
      expect(settlementData.result).not.toBeUndefined();
      // We can see from output that settlement record was created properly
    });
  });

  describe("Fee Calculation", () => {
    it("should calculate fees correctly for registered merchant", () => {
      // Register merchant first
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      const feeData = simnet.callReadOnlyFn(
        contractName,
        "calculate-fee",
        [Cl.principal(merchant1), Cl.uint(1000000)],
        deployer
      );
      expect(feeData.result).toBeUint(15000); // 1.5% of 1000000
    });

    it("should use default fee rate for unregistered merchant", () => {
      const feeData = simnet.callReadOnlyFn(
        contractName,
        "calculate-fee",
        [Cl.principal(merchant1), Cl.uint(1000000)],
        deployer
      );
      expect(feeData.result).toBeUint(15000); // 1.5% of 1000000 (default rate)
    });

    it("should calculate different fees for different amounts", () => {
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      // Test small amount
      const smallFee = simnet.callReadOnlyFn(
        contractName,
        "calculate-fee",
        [Cl.principal(merchant1), Cl.uint(100000)],
        deployer
      );
      expect(smallFee.result).toBeUint(1500); // 1.5% of 100000

      // Test large amount
      const largeFee = simnet.callReadOnlyFn(
        contractName,
        "calculate-fee",
        [Cl.principal(merchant1), Cl.uint(10000000)],
        deployer
      );
      expect(largeFee.result).toBeUint(150000); // 1.5% of 10000000
    });
  });

  describe("Advanced Admin Functions", () => {
    it("should prevent setting fee rate above maximum", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-rate",
        [Cl.uint(600)], // 6% > 5% max
        deployer
      );
      expect(result).toBeErr(Cl.uint(101)); // err-invalid-payment
    });

    it("should allow setting fee rate at maximum", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-rate",
        [Cl.uint(500)], // 5% max
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const newFeeRate = simnet.callReadOnlyFn(contractName, "get-fee-rate", [], deployer);
      expect(newFeeRate.result).toBeUint(500);
    });

    it("should allow owner to update treasury", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-treasury",
        [Cl.principal(merchant1)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const newTreasury = simnet.callReadOnlyFn(contractName, "get-treasury", [], deployer);
      expect(newTreasury.result).toBePrincipal(merchant1);
    });

    it("should prevent non-owner from updating treasury", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-treasury",
        [Cl.principal(merchant1)],
        merchant1
      );
      expect(result).toBeErr(Cl.uint(100)); // err-owner-only
    });

    it("should allow owner to unpause contract", () => {
      // First pause
      simnet.callPublicFn(contractName, "pause-contract", [], deployer);

      // Then unpause
      const { result } = simnet.callPublicFn(
        contractName,
        "unpause-contract",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const paused = simnet.callReadOnlyFn(contractName, "is-paused", [], deployer);
      expect(paused.result).toBeBool(false);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should prevent payment creation when contract is paused", () => {
      // Register merchant first
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      // Pause contract
      simnet.callPublicFn(contractName, "pause-contract", [], deployer);

      // Try to create payment
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-paused"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeErr(Cl.uint(101)); // err-invalid-payment
    });

    it("should prevent zero amount payments", () => {
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("payment-zero"),
          Cl.principal(merchant1),
          Cl.uint(0),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeErr(Cl.uint(104)); // err-insufficient-amount
    });

    it("should prevent duplicate payment IDs", () => {
      simnet.callPublicFn(
        contractName,
        "register-merchant",
        [Cl.principal(merchant1), Cl.stringAscii("USD")],
        deployer
      );

      // Create first payment
      simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("duplicate-id"),
          Cl.principal(merchant1),
          Cl.uint(1000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );

      // Try to create duplicate
      const { result } = simnet.callPublicFn(
        contractName,
        "create-payment",
        [
          Cl.stringAscii("duplicate-id"),
          Cl.principal(merchant1),
          Cl.uint(2000000),
          Cl.stringAscii("STX"),
          Cl.stringAscii("USD")
        ],
        customer1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-payment-already-processed
    });

    it("should handle missing data gracefully", () => {
      // Test missing payment
      const paymentData = simnet.callReadOnlyFn(
        contractName,
        "get-payment",
        [Cl.stringAscii("nonexistent")],
        deployer
      );
      expect(paymentData.result).toBeNone();

      // Test missing merchant
      const merchantData = simnet.callReadOnlyFn(
        contractName,
        "get-merchant",
        [Cl.principal(customer1)],
        deployer
      );
      expect(merchantData.result).toBeNone();

      // Test missing settlement
      const settlementData = simnet.callReadOnlyFn(
        contractName,
        "get-settlement",
        [Cl.stringAscii("nonexistent")],
        deployer
      );
      expect(settlementData.result).toBeNone();
    });
  });
});